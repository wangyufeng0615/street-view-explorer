package openai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/my-streetview-project/backend/internal/atlas"
	"github.com/my-streetview-project/backend/internal/models"
)

const (
	defaultAPIEndpoint     = "https://openrouter.ai/api/v1/chat/completions"
	defaultModel           = "anthropic/claude-haiku-4.5"
	defaultProviderSort    = "latency"
	maxRetries             = 2
	retryBaseDelay         = 500 * time.Millisecond
	timeout                = 15 * time.Second
	geoAIReasoningMaxRunes = 600

	geoGuessSystemPrompt = "You are Atlas in a geography guessing game, but for this task you must act as a strict satellite-image geolocation estimator.\n\n" +
		"Your task is to estimate the geographic coordinates of the exact center pixel of the provided Google Static Maps satellite image. The correct answer is the hidden map center used to render the image.\n\n" +
		"The image includes an AI-only red center reticle. The reticle was drawn by the server after the map image was fetched; it is not part of the satellite imagery. Its center marks the exact target pixel.\n\n" +
		"Critical target rule: return the latitude and longitude of the image center itself. Do not return the coordinates of the most recognizable landmark, city center, road junction, coastline feature, large building, label, or nearby place unless that feature is actually at the exact center pixel.\n\n" +
		"If the center reticle falls on water, farmland, forest, desert, a road segment, or an unremarkable patch beside a landmark, estimate the coordinate under the reticle center. Use surrounding visual clues only to infer where the marked center point is located."
)

var geographerSystemPrompt = atlas.TextSystemPrompt()

type Client interface {
	GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string) (string, []Citation, error)
	GenerateDetailedLocationDescription(latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string) (string, []Citation, error)
	StreamLocationDescription(ctx context.Context, latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string, onDelta func(string) error) (string, []Citation, error)
	StreamDetailedLocationDescription(ctx context.Context, latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string, onDelta func(string) error) (string, []Citation, error)
	GenerateRegionsForInterest(interest string) ([]models.Region, error)
	GuessLocationFromImage(ctx context.Context, imageBase64 string, zoom int, language string) (lat float64, lng float64, reasoning string, err error)
}

type client struct {
	apiKey     string
	modelName  string
	httpClient *http.Client
	endpoint   string
}

type webSearchTool struct {
	Type       string              `json:"type"`
	Parameters webSearchParameters `json:"parameters,omitempty"`
}

type webSearchParameters struct {
	Engine          string `json:"engine,omitempty"`
	MaxResults      int    `json:"max_results,omitempty"`
	MaxTotalResults int    `json:"max_total_results,omitempty"`
	MaxCharacters   int    `json:"max_characters,omitempty"`
}

type providerPreferences struct {
	Sort string `json:"sort,omitempty"`
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
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
	Choices []struct {
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
	Choices []struct {
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
func extractCitations(resp chatResponse) []Citation {
	if len(resp.Choices) == 0 {
		return nil
	}
	seen := make(map[string]bool)
	var citations []Citation
	for _, ann := range resp.Choices[0].Message.Annotations {
		if ann.Type != "url_citation" || ann.URLCitation.URL == "" {
			continue
		}
		if seen[ann.URLCitation.URL] {
			continue
		}
		seen[ann.URLCitation.URL] = true
		citations = append(citations, Citation{
			URL:   ann.URLCitation.URL,
			Title: ann.URLCitation.Title,
		})
	}
	return citations
}

// stripInlineCitations removes citation markers from content using annotation positional data.
// Annotations provide start_index/end_index as character (rune) offsets into the content string.
func stripInlineCitations(content string, annotations []annotation) string {
	if len(annotations) == 0 {
		return content
	}

	runes := []rune(content)
	runeLen := len(runes)

	// Collect valid citation ranges
	type span struct{ start, end int }
	var spans []span
	for _, ann := range annotations {
		if ann.Type != "url_citation" {
			continue
		}
		s, e := ann.URLCitation.StartIndex, ann.URLCitation.EndIndex
		if s < 0 || e > runeLen || s >= e {
			continue
		}
		spans = append(spans, span{s, e})
	}
	if len(spans) == 0 {
		return content
	}

	// Sort descending by start so removals don't shift earlier indices
	sort.Slice(spans, func(i, j int) bool {
		return spans[i].start > spans[j].start
	})

	for _, sp := range spans {
		// Expand to swallow wrapping parentheses: ...。([link]) → ...。
		start, end := sp.start, sp.end
		if start > 0 && runes[start-1] == '(' && end < runeLen && runes[end] == ')' {
			start--
			end++
		}
		// Also trim leading whitespace before the citation
		for start > 0 && (runes[start-1] == ' ' || runes[start-1] == '\t') {
			start--
		}
		runes = append(runes[:start], runes[end:]...)
		runeLen = len(runes)
	}

	return string(runes)
}

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
		apiKey:     apiKey,
		modelName:  selectedModel,
		httpClient: httpClient,
		endpoint:   endpoint,
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

func (c *client) doChatCompletion(ctx context.Context, functionName string, reqJSON []byte, startTime time.Time) ([]byte, error) {
	var lastErr error
	var retryAfter time.Duration

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			delay := retryDelay(attempt, retryAfter)
			log.Printf("[AI_RETRY] function=%s attempt=%d delay=%v previous_error=%v", functionName, attempt+1, delay, lastErr)
			if err := sleepWithContext(ctx, delay); err != nil {
				return nil, fmt.Errorf("OpenRouter 请求超时")
			}
		}
		retryAfter = 0

		req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint, bytes.NewReader(reqJSON))
		if err != nil {
			return nil, fmt.Errorf("创建请求失败: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("HTTP-Referer", "https://earth.wangyufeng.org")
		req.Header.Set("X-OpenRouter-Title", "Street View Explorer")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				log.Printf("[AI_ERROR] action=timeout function=%s duration=%v error=request_timeout", functionName, time.Since(startTime))
				return nil, fmt.Errorf("OpenRouter 请求超时")
			}
			lastErr = fmt.Errorf("发送请求失败: %w", err)
			log.Printf("[AI_ERROR] action=request_failed function=%s attempt=%d duration=%v error=%v", functionName, attempt+1, time.Since(startTime), err)
			if attempt < maxRetries {
				continue
			}
			return nil, lastErr
		}

		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			lastErr = fmt.Errorf("读取响应失败: %w", readErr)
			log.Printf("[AI_ERROR] action=read_response_failed function=%s attempt=%d duration=%v error=%v", functionName, attempt+1, time.Since(startTime), readErr)
			if attempt < maxRetries {
				continue
			}
			return nil, lastErr
		}

		if resp.StatusCode == http.StatusOK {
			return body, nil
		}

		lastErr = fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
		log.Printf("[AI_ERROR] action=api_error function=%s attempt=%d duration=%v status=%d response=%s", functionName, attempt+1, time.Since(startTime), resp.StatusCode, truncateString(string(body), 200))
		if !isRetryableStatus(resp.StatusCode) || attempt >= maxRetries {
			return nil, lastErr
		}
		retryAfter = parseRetryAfter(resp.Header.Get("Retry-After"))
	}

	return nil, lastErr
}

func (c *client) doStreamingChatCompletion(ctx context.Context, functionName string, reqJSON []byte, startTime time.Time, onDelta func(string) error) (chatResponse, error) {
	var lastErr error
	var retryAfter time.Duration

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			delay := retryDelay(attempt, retryAfter)
			log.Printf("[AI_RETRY] function=%s attempt=%d delay=%v previous_error=%v", functionName, attempt+1, delay, lastErr)
			if err := sleepWithContext(ctx, delay); err != nil {
				return chatResponse{}, fmt.Errorf("OpenRouter 请求超时")
			}
		}
		retryAfter = 0

		req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint, bytes.NewReader(reqJSON))
		if err != nil {
			return chatResponse{}, fmt.Errorf("创建请求失败: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("HTTP-Referer", "https://earth.wangyufeng.org")
		req.Header.Set("X-OpenRouter-Title", "Street View Explorer")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				log.Printf("[AI_ERROR] action=timeout function=%s duration=%v error=request_timeout", functionName, time.Since(startTime))
				return chatResponse{}, fmt.Errorf("OpenRouter 请求超时")
			}
			lastErr = fmt.Errorf("发送请求失败: %w", err)
			log.Printf("[AI_ERROR] action=request_failed function=%s attempt=%d duration=%v error=%v", functionName, attempt+1, time.Since(startTime), err)
			if attempt < maxRetries {
				continue
			}
			return chatResponse{}, lastErr
		}

		if resp.StatusCode != http.StatusOK {
			body, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if readErr != nil {
				return chatResponse{}, fmt.Errorf("读取响应失败: %w", readErr)
			}
			lastErr = fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
			log.Printf("[AI_ERROR] action=api_error function=%s attempt=%d duration=%v status=%d response=%s", functionName, attempt+1, time.Since(startTime), resp.StatusCode, truncateString(string(body), 200))
			if !isRetryableStatus(resp.StatusCode) || attempt >= maxRetries {
				return chatResponse{}, lastErr
			}
			retryAfter = parseRetryAfter(resp.Header.Get("Retry-After"))
			continue
		}
		log.Printf("[AI] action=upstream_stream_open function=%s attempt=%d duration=%v", functionName, attempt+1, time.Since(startTime))

		result, streamErr := readChatCompletionStream(resp.Body, onDelta)
		resp.Body.Close()
		if streamErr != nil {
			log.Printf("[AI_ERROR] action=stream_failed function=%s duration=%v error=%v", functionName, time.Since(startTime), streamErr)
			return chatResponse{}, streamErr
		}
		return result, nil
	}

	return chatResponse{}, lastErr
}

func readChatCompletionStream(body io.Reader, onDelta func(string) error) (chatResponse, error) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)

	var content strings.Builder
	var annotations []annotation
	var usage completionUsage

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var chunk chatStreamChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			return chatResponse{}, fmt.Errorf("解析流式响应失败: %w", err)
		}
		if chunk.Error != nil {
			return chatResponse{}, fmt.Errorf("AI API错误: %s", chunk.Error.Message)
		}
		if chunk.Usage.webSearchRequests() > 0 {
			usage = chunk.Usage
		}
		for _, choice := range chunk.Choices {
			delta := choice.Delta.Content
			if delta == "" && choice.Message.Content != "" {
				delta = choice.Message.Content
			}
			if delta != "" {
				content.WriteString(delta)
				if onDelta != nil {
					if err := onDelta(delta); err != nil {
						return chatResponse{}, fmt.Errorf("向客户端发送流式响应失败: %w", err)
					}
				}
			}
			annotations = append(annotations, choice.Delta.Annotations...)
			annotations = append(annotations, choice.Message.Annotations...)
		}
	}
	if err := scanner.Err(); err != nil {
		return chatResponse{}, fmt.Errorf("读取流式响应失败: %w", err)
	}

	var result chatResponse
	result.Choices = append(result.Choices, struct {
		Message struct {
			Content     string       `json:"content"`
			Annotations []annotation `json:"annotations,omitempty"`
		} `json:"message"`
	}{})
	result.Choices[0].Message.Content = content.String()
	result.Choices[0].Message.Annotations = annotations
	result.Usage = usage
	return result, nil
}

func retryDelay(attempt int, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		return retryAfter
	}
	return retryBaseDelay * time.Duration(1<<(attempt-1))
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := time.ParseDuration(value + "s"); err == nil {
		return seconds
	}
	if retryAt, err := http.ParseTime(value); err == nil {
		if delay := time.Until(retryAt); delay > 0 {
			return delay
		}
	}
	return 0
}

func isRetryableStatus(status int) bool {
	switch status {
	case http.StatusRequestTimeout, http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

// truncateString 截断字符串到指定长度
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

func isChineseLanguage(language string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(language)), "zh")
}

func descriptionLanguageInstruction(language string) string {
	if isChineseLanguage(language) {
		return "Output only Simplified Chinese. The location's country and local language never change this rule. Every visible word, including the opening bracket line and proper-name rendering, must be Chinese."
	}
	return "Output only English. The location's country and local language never change this rule. Every visible word, including the opening bracket line, must be English."
}

func containsResearchNarration(text string) bool {
	lower := strings.ToLower(strings.TrimSpace(text))
	for _, phrase := range []string{
		"i'll search",
		"i will search",
		"i’m going to search",
		"i'm going to search",
		"let me search",
		"i'll look up",
		"i will look up",
		"let me look up",
		"i'll research",
		"i will research",
		"first, i'll search",
		"first i'll search",
		"我先搜索",
		"让我搜索",
		"我会搜索",
		"先查一下",
		"先搜索",
		"検索",
	} {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

func countDescriptionScripts(text string) (han, kana, latin int) {
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Hiragana, unicode.Katakana):
			kana++
		case unicode.In(r, unicode.Han):
			han++
		case unicode.Is(unicode.Latin, r):
			latin++
		}
	}
	return han, kana, latin
}

func stripResearchNarration(text, language string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}

	opening := -1
	for _, marker := range []string{"[", "【"} {
		if index := strings.Index(trimmed, marker); index >= 0 && (opening < 0 || index < opening) {
			opening = index
		}
	}
	if opening > 0 && opening < 400 {
		prefix := strings.TrimSpace(trimmed[:opening])
		han, _, _ := countDescriptionScripts(prefix)
		if containsResearchNarration(prefix) || (isChineseLanguage(language) && han == 0) {
			return strings.TrimSpace(trimmed[opening:])
		}
	}

	if paragraphEnd := strings.Index(trimmed, "\n\n"); paragraphEnd > 0 && paragraphEnd < 400 {
		prefix := strings.TrimSpace(trimmed[:paragraphEnd])
		if containsResearchNarration(prefix) {
			return strings.TrimSpace(trimmed[paragraphEnd+2:])
		}
	}
	return trimmed
}

func validateDescriptionLanguage(text, language string, partial bool) error {
	han, kana, latin := countDescriptionScripts(text)
	if isChineseLanguage(language) {
		minimumHan := 12
		if partial {
			minimumHan = 4
		}
		if kana >= 2 || han < minimumHan {
			return fmt.Errorf("AI 返回的描述语言不符合简体中文要求")
		}
		return nil
	}

	minimumLatin := 20
	if partial {
		minimumLatin = 6
	}
	if latin < minimumLatin && han+kana > latin*2 {
		return fmt.Errorf("AI returned the description in the wrong language")
	}
	return nil
}

type descriptionStreamGate struct {
	language   string
	downstream func(string) error
	pending    strings.Builder
	released   bool
}

func newDescriptionStreamGate(language string, downstream func(string) error) *descriptionStreamGate {
	return &descriptionStreamGate{language: language, downstream: downstream}
}

func (g *descriptionStreamGate) Write(delta string) error {
	if g.downstream == nil || delta == "" {
		return nil
	}
	if g.released {
		if isChineseLanguage(g.language) {
			_, kana, _ := countDescriptionScripts(delta)
			if kana > 0 {
				return fmt.Errorf("AI 返回的描述语言不符合简体中文要求")
			}
		}
		return g.downstream(delta)
	}

	g.pending.WriteString(delta)
	pending := g.pending.String()
	if !strings.Contains(pending, "\n\n") && len([]rune(pending)) < 220 {
		return nil
	}

	visible := stripResearchNarration(pending, g.language)
	if err := validateDescriptionLanguage(visible, g.language, true); err != nil {
		return err
	}
	g.released = true
	return g.downstream(visible)
}

func (g *descriptionStreamGate) Finish(finalText string) error {
	if g.downstream == nil || g.released || finalText == "" {
		return nil
	}
	g.released = true
	return g.downstream(finalText)
}

func (c *client) GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string) (string, []Citation, error) {
	return c.StreamLocationDescription(context.Background(), latitude, longitude, locationInfo, scene, language, nil)
}

func (c *client) StreamLocationDescription(parent context.Context, latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string, onDelta func(string) error) (string, []Citation, error) {
	startTime := time.Now()
	descTimeout := 25 * time.Second

	log.Printf("[AI] action=request_start function=GenerateLocationDescription coords=(%.6f,%.6f) language=%s model=%s timeout=%s", latitude, longitude, language, c.modelName, descTimeout)

	outputFormat := descriptionLanguageInstruction(language)

	// 构建详细的地理信息字符串
	var geoDetails strings.Builder
	geoDetails.WriteString(fmt.Sprintf("Complete Address: %s\n", locationInfo["formatted_address"]))
	geoDetails.WriteString(fmt.Sprintf("Coordinates: (%.6f, %.6f)\n\n", latitude, longitude))

	// 按照地理层级组织信息，从最具体到最广泛
	geoDetails.WriteString("Geographic Components:\n")

	// 最具体层级 - 街道和建筑信息
	if val, exists := locationInfo["street_number"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Street Number: %s\n", val))
	}
	if val, exists := locationInfo["route"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Street/Route: %s\n", val))
	}
	if val, exists := locationInfo["intersection"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Intersection: %s\n", val))
	}
	if val, exists := locationInfo["premise"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Building/Premise: %s\n", val))
	}
	if val, exists := locationInfo["subpremise"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Unit/Subpremise: %s\n", val))
	}
	if val, exists := locationInfo["establishment"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Establishment: %s\n", val))
	}
	if val, exists := locationInfo["point_of_interest"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Point of Interest: %s\n", val))
	}

	// 地区层级
	if val, exists := locationInfo["sublocality"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Neighborhood/Sublocality: %s\n", val))
	}
	if val, exists := locationInfo["sublocality_level_1"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Sublocality Level 1: %s\n", val))
	}
	if val, exists := locationInfo["sublocality_level_2"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Sublocality Level 2: %s\n", val))
	}

	// 城市和行政区域
	if val, exists := locationInfo["locality"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- City/Locality: %s\n", val))
	}
	if val, exists := locationInfo["administrative_area_level_3"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Administrative Area Level 3: %s\n", val))
	}
	if val, exists := locationInfo["administrative_area_level_2"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Administrative Area Level 2: %s\n", val))
	}
	if val, exists := locationInfo["administrative_area_level_1"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Administrative Area Level 1: %s\n", val))
	}

	// 国家和邮政编码
	if val, exists := locationInfo["country"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Country: %s\n", val))
	}
	if val, exists := locationInfo["postal_code"]; exists && val != "" {
		if suffix, exists := locationInfo["postal_code_suffix"]; exists && suffix != "" {
			geoDetails.WriteString(fmt.Sprintf("- Postal Code: %s-%s\n", val, suffix))
		} else {
			geoDetails.WriteString(fmt.Sprintf("- Postal Code: %s\n", val))
		}
	}

	// 自然特征
	if val, exists := locationInfo["natural_feature"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Natural Feature: %s\n", val))
	}
	if scene != nil && scene.Base64 != "" {
		geoDetails.WriteString(fmt.Sprintf(
			"\nStreet View Frame: provided (heading=%d, pitch=%d, fov=%d). Treat it as the authoritative source for what is visibly present in the current view.\n",
			scene.Heading,
			scene.Pitch,
			scene.FOV,
		))
	} else {
		geoDetails.WriteString("\nStreet View Frame: unavailable. Do not claim to see scene details.\n")
	}

	prompt := fmt.Sprintf(
		"%s\n\n"+
			"Silently call the web search tool exactly once with one precise query about this location. After that single search, synthesize the answer and do not search again. Do not announce or describe the research step; the first visible output must be Atlas's bracketed scene note.\n"+
			"Focus on the most specific geographic information available (street, establishment, or neighborhood level). "+
			"Use broader context as supporting info. Remember: plain text only, no markdown. The app renders citations separately, so keep links and source mentions out of the prose and end on a clean sentence.\n\n"+
			"%s",
		geoDetails.String(),
		outputFormat,
	)

	var userContent interface{} = prompt
	if scene != nil && scene.Base64 != "" {
		userContent = []visionContentPart{
			{Type: "image_url", ImageURL: &visionImageURL{URL: sceneDataURI(scene), Detail: "high"}},
			{Type: "text", Text: prompt},
		}
	}

	parallelToolCalls := false
	visibleDeltaLogged := false
	visibleOnDelta := onDelta
	if onDelta != nil {
		visibleOnDelta = func(delta string) error {
			if !visibleDeltaLogged {
				visibleDeltaLogged = true
				log.Printf("[AI] action=visible_first_delta function=GenerateLocationDescription duration=%v", time.Since(startTime))
			}
			return onDelta(delta)
		}
	}
	streamGate := newDescriptionStreamGate(language, visibleOnDelta)
	reqBody := visionChatRequest{
		Model:    c.modelName,
		Provider: selectProviderPreferences(),
		Messages: []visionMessage{
			{
				Role:    "system",
				Content: atlas.TextSystemPrompt(language),
			},
			{
				Role:    "user",
				Content: userContent,
			},
		},
		Tools: []webSearchTool{{
			Type: "openrouter:web_search",
			Parameters: webSearchParameters{
				Engine:          "auto",
				MaxResults:      4,
				MaxTotalResults: 4,
				MaxCharacters:   3000,
			},
		}},
		ToolChoice:        "auto",
		ParallelToolCalls: &parallelToolCalls,
		Stream:            true,
		MaxToolCalls:      1,
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", nil, fmt.Errorf("编码请求失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(parent, descTimeout)
	defer cancel()

	rawDeltaLogged := false
	chatResp, err := c.doStreamingChatCompletion(ctx, "GenerateLocationDescription", reqJSON, startTime, func(delta string) error {
		if !rawDeltaLogged {
			rawDeltaLogged = true
			log.Printf("[AI] action=upstream_first_delta function=GenerateLocationDescription duration=%v", time.Since(startTime))
		}
		return streamGate.Write(delta)
	})
	if err != nil {
		return "", nil, err
	}

	if chatResp.Error != nil {
		log.Printf("[AI_ERROR] action=api_business_error function=GenerateLocationDescription duration=%v error=%s", time.Since(startTime), chatResp.Error.Message)
		return "", nil, fmt.Errorf("AI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		log.Printf("[AI_ERROR] action=empty_response function=GenerateLocationDescription duration=%v error=no_choices_returned", time.Since(startTime))
		return "", nil, fmt.Errorf("AI未返回任何结果")
	}
	if chatResp.Usage.webSearchRequests() < 1 {
		log.Printf("[AI_ERROR] action=web_search_missing function=GenerateLocationDescription duration=%v", time.Since(startTime))
		return "", nil, fmt.Errorf("AI 未执行要求的资料搜索")
	}

	desc := stripResearchNarration(
		stripInlineCitations(chatResp.Choices[0].Message.Content, chatResp.Choices[0].Message.Annotations),
		language,
	)
	if err := validateDescriptionLanguage(desc, language, false); err != nil {
		log.Printf("[AI_ERROR] action=language_mismatch function=GenerateLocationDescription duration=%v", time.Since(startTime))
		return "", nil, err
	}
	if err := streamGate.Finish(desc); err != nil {
		return "", nil, err
	}
	citations := extractCitations(chatResp)
	log.Printf("[AI] action=request_completed function=GenerateLocationDescription duration=%v response_length=%d citations_count=%d web_search_requests=%d", time.Since(startTime), len(desc), len(citations), chatResp.Usage.webSearchRequests())

	return desc, citations, nil
}

func (c *client) GenerateDetailedLocationDescription(latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string) (string, []Citation, error) {
	return c.StreamDetailedLocationDescription(context.Background(), latitude, longitude, locationInfo, scene, language, nil)
}

func (c *client) StreamDetailedLocationDescription(parent context.Context, latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string, onDelta func(string) error) (string, []Citation, error) {
	startTime := time.Now()
	detailedTimeout := 35 * time.Second

	log.Printf("[AI] action=request_start function=GenerateDetailedLocationDescription coords=(%.6f,%.6f) language=%s model=%s timeout=%s", latitude, longitude, language, c.modelName, detailedTimeout)

	ctx, cancel := context.WithTimeout(parent, detailedTimeout)
	defer cancel()

	// 构建位置信息字符串
	var locationStrings []string
	for key, value := range locationInfo {
		if value != "" && !strings.HasPrefix(key, "plus_code") {
			locationStrings = append(locationStrings, fmt.Sprintf("%s: %s", key, value))
		}
	}
	locationText := strings.Join(locationStrings, ", ")
	if locationText == "" {
		locationText = fmt.Sprintf("Coordinates: %.6f, %.6f", latitude, longitude)
	}

	outputFormat := descriptionLanguageInstruction(language)

	// 构建详细分析请求
	sceneInstruction := "No Street View frame is available. Do not claim to see specific visual details."
	if scene != nil && scene.Base64 != "" {
		sceneInstruction = fmt.Sprintf(
			"A current Street View frame is attached at heading %d, pitch %d, fov %d. Use it as the authoritative source for visible details and keep off-screen claims separate.",
			scene.Heading,
			scene.Pitch,
			scene.FOV,
		)
	}
	detailedPrompt := fmt.Sprintf(
		"Your friend wants you to dig deeper into this location. Take your time and think carefully.\n"+
			"Coordinates: %.6f, %.6f\n"+
			"Location Info: %s\n"+
			"Visual Context: %s\n\n"+
			"Cover these angles with real substance:\n"+
			"- History: what happened here, how did this place evolve, key turning points\n"+
			"- Built environment: architecture styles, urban planning, infrastructure quality\n"+
			"- People and culture: who lives here, local customs, demographics, daily life\n"+
			"- Economy: what drives the local economy, major industries, employment\n"+
			"- Geography and environment: terrain, climate, natural features\n"+
			"- How this place connects to and matters within its broader region\n\n"+
			"Silently call the web search tool exactly once with one precise query about this location. After that single search, synthesize the answer and do not search again. Do not announce or describe the research step; the first visible output must be Atlas's bracketed scene note. Cross-reference the returned sources for historical dates, demographic data, economic figures, and recent local developments. Go deeper than surface-level knowledge.\n\n"+
			"Write as Atlas — warm, playful, talking to a friend. Every sentence should carry actual information. This is the explicitly requested deeper version: write 6-8 substantive body paragraphs, 2-4 sentences each. The opening bracket line and at most one later bracket aside do not count as body paragraphs.\n"+
			"CRITICAL: pure plain text only, absolutely no markdown formatting (no asterisks, no bold, no headers, no bullet points).\n"+
			"The app renders citations separately, so keep links, URL fragments, source lists, and trailing reference blocks out of the response body. End on a clean sentence about the place.\n"+
			"If a specific claim is uncertain and unsupported by search results, keep it modest rather than inventing details.\n\n"+
			"%s",
		latitude, longitude, locationText, sceneInstruction, outputFormat)

	// 构建消息
	var userContent interface{} = detailedPrompt
	if scene != nil && scene.Base64 != "" {
		userContent = []visionContentPart{
			{Type: "image_url", ImageURL: &visionImageURL{URL: sceneDataURI(scene), Detail: "high"}},
			{Type: "text", Text: detailedPrompt},
		}
	}
	messages := []ChatMessage{
		{Role: "system", Content: atlas.TextSystemPrompt(language)},
	}

	parallelToolCalls := false
	visibleDeltaLogged := false
	visibleOnDelta := onDelta
	if onDelta != nil {
		visibleOnDelta = func(delta string) error {
			if !visibleDeltaLogged {
				visibleDeltaLogged = true
				log.Printf("[AI] action=visible_first_delta function=GenerateDetailedLocationDescription duration=%v", time.Since(startTime))
			}
			return onDelta(delta)
		}
	}
	streamGate := newDescriptionStreamGate(language, visibleOnDelta)
	reqBody := visionChatRequest{
		Model:    c.modelName,
		Provider: selectProviderPreferences(),
		Messages: []visionMessage{
			{Role: messages[0].Role, Content: messages[0].Content},
			{Role: "user", Content: userContent},
		},
		Tools: []webSearchTool{{
			Type: "openrouter:web_search",
			Parameters: webSearchParameters{
				Engine:          "auto",
				MaxResults:      6,
				MaxTotalResults: 6,
				MaxCharacters:   2500,
			},
		}},
		ToolChoice:        "auto",
		ParallelToolCalls: &parallelToolCalls,
		Stream:            true,
		MaxToolCalls:      1,
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", nil, fmt.Errorf("编码请求失败: %w", err)
	}

	rawDeltaLogged := false
	chatResp, err := c.doStreamingChatCompletion(ctx, "GenerateDetailedLocationDescription", reqJSON, startTime, func(delta string) error {
		if !rawDeltaLogged {
			rawDeltaLogged = true
			log.Printf("[AI] action=upstream_first_delta function=GenerateDetailedLocationDescription duration=%v", time.Since(startTime))
		}
		return streamGate.Write(delta)
	})
	if err != nil {
		return "", nil, err
	}

	if chatResp.Error != nil {
		log.Printf("[AI_ERROR] action=api_business_error function=GenerateDetailedLocationDescription duration=%v error=%s",
			time.Since(startTime), chatResp.Error.Message)
		return "", nil, fmt.Errorf("AI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		log.Printf("[AI_ERROR] action=empty_response function=GenerateDetailedLocationDescription duration=%v",
			time.Since(startTime))
		return "", nil, fmt.Errorf("AI未返回任何结果")
	}
	if chatResp.Usage.webSearchRequests() < 1 {
		log.Printf("[AI_ERROR] action=web_search_missing function=GenerateDetailedLocationDescription duration=%v", time.Since(startTime))
		return "", nil, fmt.Errorf("AI 未执行要求的资料搜索")
	}

	result := stripResearchNarration(
		stripInlineCitations(chatResp.Choices[0].Message.Content, chatResp.Choices[0].Message.Annotations),
		language,
	)
	if err := validateDescriptionLanguage(result, language, false); err != nil {
		log.Printf("[AI_ERROR] action=language_mismatch function=GenerateDetailedLocationDescription duration=%v", time.Since(startTime))
		return "", nil, err
	}
	if err := streamGate.Finish(result); err != nil {
		return "", nil, err
	}
	citations := extractCitations(chatResp)

	log.Printf("[AI] action=request_completed function=GenerateDetailedLocationDescription duration=%v response_length=%d citations_count=%d web_search_requests=%d", time.Since(startTime), len(result), len(citations), chatResp.Usage.webSearchRequests())

	return result, citations, nil
}

func (c *client) GenerateRegionsForInterest(interest string) ([]models.Region, error) {
	return c.tryGenerateRegions(interest)
}

func (c *client) tryGenerateRegions(interest string) ([]models.Region, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	prompt := fmt.Sprintf(
		"You are a geography expert who needs to generate a list of geographical regions based on the user's exploration theme. "+
			"Your goal is to interpret ANY input that could possibly be related to geographical locations and convert it into explorable regions.\n\n"+
			"The exploration theme can be:\n"+
			"1. Any location name (cities, towns, villages, regions, countries)\n"+
			"2. Any type of place (castles, temples, parks, beaches)\n"+
			"3. Any geographical feature (mountains, lakes, deserts)\n"+
			"4. Any cultural or historical theme (ancient ruins, modern architecture)\n"+
			"5. Any activity location (skiing, surfing, hiking)\n"+
			"6. Any building type (museums, libraries, universities)\n\n"+
			"Important rules:\n"+
			"1. If the input contains ANY location name (even small towns or villages), ALWAYS return coordinates for that location\n"+
			"2. For location names, include the location itself plus relevant surrounding areas\n"+
			"3. For themes or features, select 3-5 representative regions worldwide\n"+
			"4. Be extremely generous in interpretation - if there's ANY way to connect the input to physical locations, do so\n"+
			"5. Only return error for inputs that are COMPLETELY impossible to connect to any physical location\n\n"+
			"Examples:\n"+
			"1. For 'Paris' -> Return coordinates covering Paris and surrounding areas\n"+
			"2. For 'Avrig' -> Return coordinates for the town in Romania and surrounding region\n"+
			"3. For 'skiing' -> Include regions like the Alps, Aspen, Hokkaido\n"+
			"4. For 'cafes' -> Include regions like Vienna, Paris, Melbourne\n"+
			"5. For 'sunset views' -> Include regions like Santorini, Maldives, Hawaii\n\n"+
			"Return format for valid themes (which should be 99%% of inputs):\n"+
			"{\n"+
			"  \"regions\": [\n"+
			"    {\n"+
			"      \"coordinates\": {\n"+
			"        \"north\": float,\n"+
			"        \"south\": float,\n"+
			"        \"east\": float,\n"+
			"        \"west\": float\n"+
			"      },\n"+
			"      \"region_info\": \"string\"\n"+
			"    }\n"+
			"  ]\n"+
			"}\n\n"+
			"Return format for completely non-geographical themes (should be very rare):\n"+
			"{\n"+
			"  \"error\": \"Cannot generate regions for this interest\",\n"+
			"  \"explanation\": \"Detailed explanation of why this theme cannot be converted to geographical regions, and suggestion for a more location-specific alternative\"\n"+
			"}\n\n"+
			"Error response examples (these should be EXTREMELY rare):\n"+
			"1. For 'abstract algebra': { \"error\": \"Cannot generate regions for this interest\", \"explanation\": \"Abstract algebra is a purely mathematical concept with no physical locations. Consider exploring 'famous universities' or 'mathematics museums' instead.\" }\n"+
			"2. For 'philosophy': { \"error\": \"Cannot generate regions for this interest\", \"explanation\": \"While philosophy originated in various places, the concept itself isn't location-specific. Consider exploring 'ancient Greek philosophical sites' or 'famous philosophy universities' instead.\" }\n\n"+
			"User's exploration theme: '%s'\n\n"+
			"Notes:\n"+
			"1. Be EXTREMELY generous in interpretation - if there's ANY way to connect it to locations, do so\n"+
			"2. For locations, include surrounding areas to increase chances of finding street views\n"+
			"3. Region descriptions should explain why this area is relevant\n"+
			"4. Coordinates should be precise to 3 decimal places\n"+
			"5. Ensure coordinates are valid (latitude: -90 to 90, longitude: -180 to 180)\n"+
			"6. Prioritize areas with road access and likely street view coverage\n"+
			"7. For cities/landmarks, use appropriate coordinate ranges to cover the area",
		interest,
	)

	reqBody := chatRequest{
		Model: c.modelName,
		Messages: []chatMessage{
			{
				Role:    "system",
				Content: geographerSystemPrompt, // 复用随机探索的system prompt
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("编码请求失败: %w", err)
	}

	body, err := c.doChatCompletion(ctx, "GenerateRegionsForInterest", reqJSON, time.Now())
	if err != nil {
		return nil, err
	}

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if chatResp.Error != nil {
		return nil, fmt.Errorf("AI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		return nil, fmt.Errorf("AI未返回任何结果")
	}

	responseContent := chatResp.Choices[0].Message.Content

	// 先尝试解析区域数据
	var result struct {
		Regions     []models.Region `json:"regions"`
		Error       string          `json:"error,omitempty"`
		Explanation string          `json:"explanation,omitempty"`
	}
	if err := json.Unmarshal([]byte(responseContent), &result); err != nil {
		// 尝试清理响应内容（移除可能的前后缀文本）
		content := responseContent
		if idx := strings.Index(content, "{"); idx >= 0 {
			content = content[idx:]
			if lastIdx := strings.LastIndex(content, "}"); lastIdx >= 0 {
				content = content[:lastIdx+1]
				// 再次尝试解析清理后的内容
				if err := json.Unmarshal([]byte(content), &result); err != nil {
					// 直接返回AI的原始回复内容，让前端展示
					return nil, fmt.Errorf("%s", responseContent)
				}
			} else {
				// 没有找到完整的JSON结构，直接返回AI的回复
				return nil, fmt.Errorf("%s", responseContent)
			}
		} else {
			// 没有找到JSON开始标记，直接返回AI的回复
			return nil, fmt.Errorf("%s", responseContent)
		}
	}

	// 检查是否返回了错误信息
	if result.Error != "" {
		if result.Explanation != "" {
			return nil, fmt.Errorf("%s", result.Explanation)
		} else {
			return nil, fmt.Errorf("%s", result.Error)
		}
	}

	// 验证区域数据
	if len(result.Regions) == 0 {
		return nil, fmt.Errorf("无法理解该探索兴趣")
	}

	// 验证每个区域的数据
	validRegions := make([]models.Region, 0)
	for _, region := range result.Regions {
		// 基本验证
		if region.RegionInfo == "" {
			continue
		}

		// 坐标范围验证
		if !isValidCoordinates(region.Coordinates) {
			continue
		}

		validRegions = append(validRegions, region)
	}

	// 如果没有有效区域，返回错误
	if len(validRegions) == 0 {
		return nil, fmt.Errorf("无法生成有效的探索区域")
	}

	return validRegions, nil
}

// ─── Vision: Geo Game AI Guess ──────────────────────────────

// visionContentPart represents one part of a multimodal message content array.
type visionContentPart struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	ImageURL *visionImageURL `json:"image_url,omitempty"`
}

type visionImageURL struct {
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"`
}

// visionMessage is a chat message with multimodal content.
type visionMessage struct {
	Role    interface{} `json:"role"`
	Content interface{} `json:"content"` // string or []visionContentPart
}

type visionChatRequest struct {
	Model             string               `json:"model"`
	Messages          []visionMessage      `json:"messages"`
	Provider          *providerPreferences `json:"provider,omitempty"`
	Tools             []webSearchTool      `json:"tools,omitempty"`
	ToolChoice        string               `json:"tool_choice,omitempty"`
	ParallelToolCalls *bool                `json:"parallel_tool_calls,omitempty"`
	Stream            bool                 `json:"stream,omitempty"`
	MaxToolCalls      int                  `json:"max_tool_calls,omitempty"`
}

func sceneDataURI(scene *SceneImage) string {
	contentType := strings.ToLower(strings.TrimSpace(scene.ContentType))
	if contentType != "image/png" && contentType != "image/jpeg" {
		contentType = "image/jpeg"
	}
	return "data:" + contentType + ";base64," + scene.Base64
}

func geoGuessUserPrompt(zoom int, language string) string {
	reasoningLanguage := "English"
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(language)), "zh") {
		reasoningLanguage = "Simplified Chinese"
	}

	return fmt.Sprintf(
		"This is a Google Static Maps satellite image rendered at zoom level %d. A red crosshair/reticle has been added only for this AI request. The true target is the exact center of that red reticle, which corresponds to the exact center pixel of the raster image and the hidden map center.\n\n"+
			"Estimate the latitude and longitude of the ground/water point directly under the center of the red reticle using only visual clues in the image: terrain, vegetation, road patterns, building layouts, coastlines, urban density, agricultural patterns, water bodies, shadows, and landforms.\n\n"+
			"Important: many clues may be off-center. Use them as context, but do not shift your final lat/lng to the most distinctive visible object. If a recognizable feature is near the edge and the center is plain farmland, water, forest, or suburbia, answer for the plain center point.\n\n"+
			"The returned lat/lng must describe the point under the red reticle center, not the center of a city, the nearest town, a landmark, or a visually prominent feature.\n\n"+
			"Write the reasoning value in %s. Keep the JSON field names exactly as lat, lng, and reasoning.\n\n"+
			"Respond with ONLY a JSON object, no markdown, no code fence, no extra text:\n"+
			"{\"lat\": <number>, \"lng\": <number>, \"reasoning\": \"<brief explanation of the visual clues and why they locate the red reticle center>\"}",
		zoom,
		reasoningLanguage,
	)
}

func (c *client) GuessLocationFromImage(parentCtx context.Context, imageBase64 string, zoom int, language string) (float64, float64, string, error) {
	startTime := time.Now()
	ctx, cancel := context.WithTimeout(parentCtx, 30*time.Second)
	defer cancel()

	prompt := geoGuessUserPrompt(zoom, language)

	dataURI := "data:image/png;base64," + imageBase64

	reqBody := visionChatRequest{
		Model:    c.modelName,
		Provider: selectProviderPreferences(),
		Messages: []visionMessage{
			{
				Role:    "system",
				Content: geoGuessSystemPrompt,
			},
			{
				Role: "user",
				Content: []visionContentPart{
					{Type: "image_url", ImageURL: &visionImageURL{URL: dataURI, Detail: "high"}},
					{Type: "text", Text: prompt},
				},
			},
		},
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return 0, 0, "", fmt.Errorf("encode request: %w", err)
	}

	body, err := c.doChatCompletion(ctx, "GuessLocationFromImage", reqJSON, startTime)
	if err != nil {
		return 0, 0, "", err
	}

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return 0, 0, "", fmt.Errorf("parse response: %w", err)
	}
	if chatResp.Error != nil {
		return 0, 0, "", fmt.Errorf("AI error: %s", chatResp.Error.Message)
	}
	if len(chatResp.Choices) == 0 {
		return 0, 0, "", fmt.Errorf("no response from AI")
	}

	content := chatResp.Choices[0].Message.Content

	// Parse JSON from response (may be wrapped in markdown code block)
	jsonStr := content
	if idx := strings.Index(jsonStr, "{"); idx >= 0 {
		jsonStr = jsonStr[idx:]
		if end := strings.LastIndex(jsonStr, "}"); end >= 0 {
			jsonStr = jsonStr[:end+1]
		}
	}

	var result struct {
		Lat       *float64 `json:"lat"`
		Lng       *float64 `json:"lng"`
		Reasoning string   `json:"reasoning"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		log.Printf("[GEO_AI] failed to parse AI guess JSON: %v, raw=%s", err, truncateString(content, 200))
		return 0, 0, "", fmt.Errorf("failed to parse AI guess")
	}
	if result.Lat == nil || result.Lng == nil {
		log.Printf("[GEO_AI] missing coordinates in AI guess JSON: raw=%s", truncateString(content, 200))
		return 0, 0, "", fmt.Errorf("missing coordinates in AI guess")
	}

	// Clamp coordinates to valid range
	lat, lng := *result.Lat, *result.Lng
	if lat < -90 {
		lat = -90
	} else if lat > 90 {
		lat = 90
	}
	if lng < -180 {
		lng = -180
	} else if lng > 180 {
		lng = 180
	}
	reasoning := truncateRunes(result.Reasoning, geoAIReasoningMaxRunes)

	log.Printf("[GEO_AI] guess=(%.4f,%.4f) zoom=%d duration=%v", lat, lng, zoom, time.Since(startTime))
	return lat, lng, reasoning, nil
}

// 验证坐标是否有效
func isValidCoordinates(coords struct {
	North float64 `json:"north"`
	South float64 `json:"south"`
	East  float64 `json:"east"`
	West  float64 `json:"west"`
}) bool {
	// 纬度范围检查 (-90 到 90)
	if coords.North < -90 || coords.North > 90 ||
		coords.South < -90 || coords.South > 90 {
		return false
	}

	// 确保南北纬度关系正确
	if coords.South > coords.North {
		return false
	}

	// 经度范围检查 (-180 到 180)
	if coords.East < -180 || coords.East > 180 ||
		coords.West < -180 || coords.West > 180 {
		return false
	}

	return true
}
