package openai

import (
	"context"
	"github.com/my-streetview-project/backend/internal/models"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	defaultAPIEndpoint     = "https://openrouter.ai/api/v1/chat/completions"
	defaultModel           = "deepseek/deepseek-v4-flash"
	defaultSceneModel      = "deepseek/deepseek-v4-flash-vision-exp"
	defaultVisionModel     = "deepseek/deepseek-v4-flash-vision-exp"
	defaultProviderSort    = "latency"
	maxRetries             = 2
	retryBaseDelay         = 500 * time.Millisecond
	timeout                = 15 * time.Second
	geoAIMaxTokens         = 480
	geoAIReasoningMaxRunes = 600

	geoGuessSystemPrompt = "You are Atlas in a geography guessing game, but for this task you must act as a strict satellite-image geolocation estimator.\n\n" +
		"Your task is to estimate the geographic coordinates of the exact center pixel of the provided Google Static Maps satellite image. The correct answer is the hidden map center used to render the image.\n\n" +
		"The image includes an AI-only red center reticle. The reticle was drawn by the server after the map image was fetched; it is not part of the satellite imagery. Its center marks the exact target pixel.\n\n" +
		"Critical target rule: return the latitude and longitude of the image center itself. Do not return the coordinates of the most recognizable landmark, city center, road junction, coastline feature, large building, label, or nearby place unless that feature is actually at the exact center pixel.\n\n" +
		"If the center reticle falls on water, farmland, forest, desert, a road segment, or an unremarkable patch beside a landmark, estimate the coordinate under the reticle center. Use surrounding visual clues only to infer where the marked center point is located."
)

const regionSystemPrompt = "You are a geography planning service. Convert the user's place or exploration theme into valid geographic bounding boxes. Return exactly one JSON object matching the requested schema. Do not write prose outside JSON, do not use markdown or code fences, and do not adopt a persona or letter format."

type Client interface {
	GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string) (string, []Citation, error)
	GenerateDetailedLocationDescription(latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string) (string, []Citation, error)
	StreamLocationDescription(ctx context.Context, latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string, onDelta func(string) error) (string, []Citation, error)
	StreamDetailedLocationDescription(ctx context.Context, latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string, onDelta func(string) error) (string, []Citation, error)
	GenerateRegionsForInterest(interest string) ([]models.Region, error)
	GuessLocationFromImage(ctx context.Context, imageBase64 string, zoom int, language string) (lat float64, lng float64, reasoning string, err error)
}

type client struct {
	apiKey          string
	modelName       string
	sceneModelName  string
	visionModelName string
	httpClient      *http.Client
	endpoint        string
}

type webSearchTool struct {
	Type       string              `json:"type"`
	Parameters webSearchParameters `json:"parameters,omitempty"`
}

type webSearchParameters struct {
	Engine          string `json:"engine,omitempty"`
	Mode            string `json:"mode,omitempty"`
	MaxResults      int    `json:"max_results,omitempty"`
	MaxTotalResults int    `json:"max_total_results,omitempty"`
	MaxCharacters   int    `json:"max_characters,omitempty"`
}

type providerPreferences struct {
	Sort           string   `json:"sort,omitempty"`
	Order          []string `json:"order,omitempty"`
	AllowFallbacks *bool    `json:"allow_fallbacks,omitempty"`
}

type reasoningConfig struct {
	Enabled bool `json:"enabled"`
}

type chatRequest struct {
	Model     string           `json:"model"`
	Messages  []chatMessage    `json:"messages"`
	Reasoning *reasoningConfig `json:"reasoning,omitempty"`
}

type completionUsage struct {
	ServerToolUse struct {
		WebSearchRequests int `json:"web_search_requests"`
	} `json:"server_tool_use"`
	ServerToolUseDetails struct {
		WebSearchRequests  int `json:"web_search_requests"`
		ToolCallsRequested int `json:"tool_calls_requested"`
		ToolCallsExecuted  int `json:"tool_calls_executed"`
	} `json:"server_tool_use_details"`
}

func (u completionUsage) webSearchRequests() int {
	if u.ServerToolUseDetails.WebSearchRequests > u.ServerToolUse.WebSearchRequests {
		return u.ServerToolUseDetails.WebSearchRequests
	}
	return u.ServerToolUse.WebSearchRequests
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Citation represents a web search result used by the AI
type Citation struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

type SceneImage struct {
	Base64      string
	ContentType string
	Heading     int
	Pitch       int
	FOV         int
}

// 为了向后兼容保留小写版本
type chatMessage = ChatMessage

type annotation struct {
	Type        string `json:"type"`
	URLCitation struct {
		URL        string `json:"url"`
		Title      string `json:"title"`
		StartIndex int    `json:"start_index"`
		EndIndex   int    `json:"end_index"`
	} `json:"url_citation"`
}

type chatResponse struct {
	ID       string `json:"id,omitempty"`
	Provider string `json:"provider,omitempty"`
	Choices  []struct {
		Message struct {
			Content     string       `json:"content"`
			Annotations []annotation `json:"annotations,omitempty"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Code    any    `json:"code,omitempty"`
	} `json:"error,omitempty"`
	Usage completionUsage `json:"usage,omitempty"`
}

type chatStreamChunk struct {
	ID       string `json:"id,omitempty"`
	Provider string `json:"provider,omitempty"`
	Choices  []struct {
		Delta struct {
			Content     string       `json:"content"`
			Annotations []annotation `json:"annotations,omitempty"`
		} `json:"delta"`
		Message struct {
			Content     string       `json:"content"`
			Annotations []annotation `json:"annotations,omitempty"`
		} `json:"message,omitempty"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Code    any    `json:"code,omitempty"`
	} `json:"error,omitempty"`
	Usage completionUsage `json:"usage,omitempty"`
}

// extractCitations deduplicates url_citation annotations into a Citation slice.
func NewClient(apiKey string, modelName ...string) Client {
	// 从环境变量获取代理URL
	proxyURLStr := os.Getenv("AI_PROXY_URL")
	if proxyURLStr == "" {
		proxyURLStr = os.Getenv("PROXY_URL")
	}

	proxyType := os.Getenv("PROXY_TYPE")
	if proxyType == "" {
		proxyType = "http"
	}

	proxyUser := os.Getenv("PROXY_USER")
	proxyPass := os.Getenv("PROXY_PASS")

	// 不设置 HTTP 客户端超时，完全依赖 context 超时控制
	// 这样避免了 HTTP 超时和 context 超时的冲突
	httpClient := &http.Client{
		// Timeout 不设置，使用 context 控制超时
	}

	// 如果设置了代理，配置HTTP客户端使用代理
	if proxyURLStr != "" {
		var transport *http.Transport

		// 根据代理类型创建不同的代理URL
		var proxyFunc func(*http.Request) (*url.URL, error)

		if proxyType == "socks5" {
			// 对于SOCKS5代理，我们需要使用golang.org/x/net/proxy包
			// 这里简化处理，仅构建代理URL
			proxyURLWithAuth := proxyURLStr
			if proxyUser != "" && proxyPass != "" {
				// 从URL中解析出协议、主机和端口
				parsedURL, err := url.Parse(proxyURLStr)
				if err == nil {
					// 重建带认证的URL
					parsedURL.User = url.UserPassword(proxyUser, proxyPass)
					proxyURLWithAuth = parsedURL.String()
				}
			}

			log.Printf("AI客户端使用SOCKS5代理: %s", proxyURLWithAuth)

			// 注意：这里需要额外的库支持SOCKS5
			// 简化起见，我们仍然使用http.ProxyURL，但实际使用时需要使用SOCKS5专用的库
			proxyURL, err := url.Parse(proxyURLWithAuth)
			if err != nil {
				log.Printf("解析代理URL失败: %v，将不使用代理", err)
				proxyFunc = nil
			} else {
				proxyFunc = http.ProxyURL(proxyURL)
			}
		} else {
			// 默认HTTP代理
			proxyURL, err := url.Parse(proxyURLStr)
			if err != nil {
				log.Printf("解析代理URL失败: %v，将不使用代理", err)
				proxyFunc = nil
			} else {
				// 如果提供了用户名和密码，添加到代理URL
				if proxyUser != "" && proxyPass != "" {
					proxyURL.User = url.UserPassword(proxyUser, proxyPass)
				}
				proxyFunc = http.ProxyURL(proxyURL)
				log.Printf("AI客户端使用HTTP代理: %s", proxyURL.String())
			}
		}

		// 创建带有代理的Transport
		if proxyFunc != nil {
			transport = &http.Transport{
				Proxy: proxyFunc,
			}
			httpClient.Transport = transport
		}
	}

	selectedModel := selectModel(proxyURLStr)
	if len(modelName) > 0 && modelName[0] != "" {
		selectedModel = modelName[0]
	}
	endpoint := strings.TrimSpace(os.Getenv("OPENROUTER_API_ENDPOINT"))
	if endpoint == "" {
		endpoint = defaultAPIEndpoint
	}

	return &client{
		apiKey:          apiKey,
		modelName:       selectedModel,
		sceneModelName:  selectSceneModel(),
		visionModelName: selectVisionModel(),
		httpClient:      httpClient,
		endpoint:        endpoint,
	}
}

func selectModel(proxyURLStr string) string {
	if configured := strings.TrimSpace(os.Getenv("OPENROUTER_MODEL")); configured != "" {
		return configured
	}
	if configured := strings.TrimSpace(os.Getenv("AI_MODEL")); configured != "" {
		return configured
	}
	if proxyURLStr == "" {
		if configured := strings.TrimSpace(os.Getenv("CN_AI_MODEL")); configured != "" {
			return configured
		}
	}
	return defaultModel
}

func selectSceneModel() string {
	if configured := strings.TrimSpace(os.Getenv("OPENROUTER_SCENE_MODEL")); configured != "" {
		return configured
	}
	return defaultSceneModel
}

func (c *client) sceneModel() string {
	if strings.TrimSpace(c.sceneModelName) != "" {
		return c.sceneModelName
	}
	return defaultSceneModel
}

func selectVisionModel() string {
	if configured := strings.TrimSpace(os.Getenv("OPENROUTER_VISION_MODEL")); configured != "" {
		return configured
	}
	return defaultVisionModel
}

func (c *client) visionModel() string {
	if strings.TrimSpace(c.visionModelName) != "" {
		return c.visionModelName
	}
	return defaultVisionModel
}

func selectProviderPreferences() *providerPreferences {
	sortBy := strings.ToLower(strings.TrimSpace(os.Getenv("OPENROUTER_PROVIDER_SORT")))
	if sortBy == "none" || sortBy == "off" || sortBy == "disabled" {
		return nil
	}
	if sortBy != "price" && sortBy != "throughput" && sortBy != "latency" {
		sortBy = defaultProviderSort
	}
	return &providerPreferences{
		Sort: sortBy,
	}
}

func truncateString(s string, maxLength int) string {
	if len(s) <= maxLength {
		return s
	}
	return s[:maxLength] + "..."
}

func truncateRunes(s string, maxRunes int) string {
	runes := []rune(strings.TrimSpace(s))
	if len(runes) <= maxRunes {
		return string(runes)
	}
	return string(runes[:maxRunes])
}
