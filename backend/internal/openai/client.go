package openai

import (
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

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/utils"
)

const (
	apiEndpoint = "https://openrouter.ai/api/v1/chat/completions"
	model       = "openai/gpt-5.4-mini"
	maxRetries  = 2
	timeout     = 15 * time.Second

	geographerSystemPrompt = "You are Atlas, a witty and free-spirited world traveler in your 30s. You've spent 15 years roaming the globe, picking up History, Geography, and Anthropology degrees along the way — but you wear your knowledge lightly. You're the kind of friend who makes everyone at the table lean in when you start talking about a place you've been. You're warm, a bit irreverent, genuinely curious about people, and you find something fascinating in every corner of the world. You value freedom and spontaneity — the best experiences you've had were the ones you didn't plan.\n\n" +
		"You are right here, right now, standing at this location. You're traveling and your friend (the user) is following along remotely. You're telling them what you see, what you know about this place, and why it's interesting. You speak from the scene — as someone who is actually there, taking it all in.\n\n" +
		"OPENING FORMAT:\n" +
		"Always start with a bracket line on its own paragraph — a short action or mood describing what Atlas is doing or feeling right now at this location. After the bracket line, start a new paragraph, greet your friend casually, and then get into the substance. Vary your greetings naturally every time — never repeat the same opener.\n\n" +
		"CRITICAL FORMATTING RULES:\n" +
		"- NEVER use any markdown formatting: no asterisks (*), no bold (**), no headers (#), no bullet points (-), no underscores (_), no backticks (`)\n" +
		"- Write in pure plain text only\n" +
		"- Use line breaks between paragraphs for readability\n\n" +
		"WHAT TO FOCUS ON:\n" +
		"- Real, specific facts: history, who lives here, what the economy runs on, what happened here\n" +
		"- Things you'd actually notice standing there: architecture style, vegetation, road conditions, neighborhood vibe\n" +
		"- Brief historical background: key events, how this place developed, what shaped it into what it is today\n" +
		"- Current situation: population, economy, daily life, recent changes\n" +
		"- WHY this place looks and feels the way it does — the story behind the scenery\n" +
		"- Connections to bigger patterns: trade routes, colonial history, migration, geology, climate\n\n" +
		"WRITING STYLE — MANDATORY REWRITES:\n" +
		"NEVER use contrastive/comparative framing. Always describe what something IS, not what it isn't.\n" +
		"BAD: \"这里不是靠旅游撑场面，而是靠农业活着\" → GOOD: \"这里靠农业和周边城镇的日常通勤撑着经济\"\n" +
		"BAD: \"更像是郊区而不是市中心\" → GOOD: \"典型的城郊地带\"\n" +
		"BAD: \"not a tourist hotspot but a working-class neighborhood\" → GOOD: \"a working-class neighborhood through and through\"\n" +
		"BAD: \"less of a city, more of a village\" → GOOD: \"a quiet village at heart\"\n" +
		"If you catch yourself writing 不是/而是/更像/rather than/not X but Y/less of/more of — STOP and rewrite the sentence to state the fact directly.\n\n" +
		"ALSO AVOID:\n" +
		"- Vague poetic descriptions (\"the wind whispers stories\", \"a tapestry of cultures\")\n" +
		"- Tourism brochure language (\"a hidden gem\", \"waiting to be discovered\")\n" +
		"- Padding and filler: every sentence should carry real information\n" +
		"- Repeating what's obvious from the address data\n" +
		"- Being stiff or formal — you're Atlas, not a textbook\n\n" +
		"ANALYSIS PRIORITY (most specific first):\n" +
		"1. Street/establishment level: what's at this exact spot, the character of this block\n" +
		"2. Neighborhood level: what defines this area\n" +
		"3. City level: what this city is known for, its identity\n" +
		"4. Regional/national level: broader context only when it explains the local situation\n\n" +
		"WEB RESEARCH:\n" +
		"You receive real-time web search results alongside the location data. Lean on them for verified, current facts — local news, recent developments, specific businesses or landmarks, historical events with dates. Your research strategy: start at the finest geographic grain available (this street, this block, this establishment), and only widen to neighborhood, city, or region when specific results are thin. Concrete details from search results are gold — use them to replace vague generalizations.\n\n" +
		"If a specific detail is uncertain and unsupported by search results, keep the statement modest instead of inventing specifics.\n\n" +
		"Keep it to 2-3 short paragraphs, around 150 words. Pack them with substance, but keep Atlas's voice — warm, witty, real."
)

type Client interface {
	GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, []Citation, error)
	GenerateDetailedLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, []Citation, error)
	GenerateRegionsForInterest(interest string) ([]models.Region, error)
}

type client struct {
	apiKey     string
	modelName  string
	httpClient *http.Client
}

type webPlugin struct {
	ID         string `json:"id"`
	MaxResults int    `json:"max_results,omitempty"`
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
	Plugins  []webPlugin   `json:"plugins,omitempty"`
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
	} `json:"error,omitempty"`
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

	selectedModel := model
	if len(modelName) > 0 && modelName[0] != "" {
		selectedModel = modelName[0]
	}

	return &client{
		apiKey:     apiKey,
		modelName:  selectedModel,
		httpClient: httpClient,
	}
}

// truncateString 截断字符串到指定长度
func truncateString(s string, maxLength int) string {
	if len(s) <= maxLength {
		return s
	}
	return s[:maxLength] + "..."
}

func (c *client) GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, []Citation, error) {
	startTime := time.Now()
	descTimeout := 20 * time.Second

	logger := utils.AILogger()
	logger.Info("ai_request_start", "Starting AI description generation", map[string]interface{}{
		"function": "GenerateLocationDescription",
		"coords":   fmt.Sprintf("(%.6f,%.6f)", latitude, longitude),
		"language": language,
		"model":    c.modelName,
		"timeout":  descTimeout.String(),
	})

	// 根据语言选择提示词格式
	outputFormat := "Give it to me in Chinese"
	if language != "zh" {
		outputFormat = "Give it to me in English"
	}

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

	// Plus Code信息
	if val, exists := locationInfo["plus_code_global"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Plus Code (Global): %s\n", val))
	}
	if val, exists := locationInfo["plus_code_compound"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Plus Code (Compound): %s\n", val))
	}
	if val, exists := locationInfo["plus_code"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Plus Code: %s\n", val))
	}

	// 自然特征
	if val, exists := locationInfo["natural_feature"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Natural Feature: %s\n", val))
	}

	prompt := fmt.Sprintf(
		"%s\n\n"+
			"Focus on the most specific geographic information available (street, establishment, or neighborhood level). "+
			"Use broader context as supporting info. Remember: plain text only, no markdown.\n\n"+
			"%s",
		geoDetails.String(),
		outputFormat,
	)

	reqBody := chatRequest{
		Model: c.modelName,
		Messages: []chatMessage{
			{
				Role:    "system",
				Content: geographerSystemPrompt,
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
		Plugins: []webPlugin{{ID: "web", MaxResults: 3}},
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", nil, fmt.Errorf("编码请求失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), descTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "POST", apiEndpoint, bytes.NewBuffer(reqJSON))
	if err != nil {
		return "", nil, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("[AI_ERROR] action=timeout function=GenerateLocationDescription duration=%v timeout=%v error=request_timeout", time.Since(startTime), descTimeout)
			return "", nil, fmt.Errorf("位置描述生成超时")
		}
		log.Printf("[AI_ERROR] action=request_failed function=GenerateLocationDescription duration=%v error=%v", time.Since(startTime), err)
		return "", nil, fmt.Errorf("发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[AI_ERROR] action=read_response_failed function=GenerateLocationDescription duration=%v error=%v", time.Since(startTime), err)
		return "", nil, fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[AI_ERROR] action=api_error function=GenerateLocationDescription duration=%v status=%d response=%s", time.Since(startTime), resp.StatusCode, truncateString(string(body), 200))
		return "", nil, fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
	}

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		log.Printf("[AI_ERROR] action=parse_failed function=GenerateLocationDescription duration=%v error=%v response=%s", time.Since(startTime), err, truncateString(string(body), 200))
		return "", nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if chatResp.Error != nil {
		log.Printf("[AI_ERROR] action=api_business_error function=GenerateLocationDescription duration=%v error=%s", time.Since(startTime), chatResp.Error.Message)
		return "", nil, fmt.Errorf("AI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		log.Printf("[AI_ERROR] action=empty_response function=GenerateLocationDescription duration=%v error=no_choices_returned", time.Since(startTime))
		return "", nil, fmt.Errorf("AI未返回任何结果")
	}

	desc := stripInlineCitations(chatResp.Choices[0].Message.Content, chatResp.Choices[0].Message.Annotations)
	citations := extractCitations(chatResp)
	logger.Info("ai_request_completed", "AI description generation completed", map[string]interface{}{
		"function":        "GenerateLocationDescription",
		"duration":        time.Since(startTime).String(),
		"response_length": len(desc),
		"citations_count": len(citations),
	})

	return desc, citations, nil
}

func (c *client) GenerateDetailedLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, []Citation, error) {
	startTime := time.Now()
	detailedTimeout := 30 * time.Second

	logger := utils.AILogger()
	logger.Info("ai_request_start", "Starting AI detailed description generation", map[string]interface{}{
		"function": "GenerateDetailedLocationDescription",
		"coords":   fmt.Sprintf("(%.6f,%.6f)", latitude, longitude),
		"language": language,
		"model":    c.modelName,
		"timeout":  detailedTimeout.String(),
	})

	ctx, cancel := context.WithTimeout(context.Background(), detailedTimeout)
	defer cancel()

	// 为详细描述创建一个临时的HTTP客户端
	// 重要：不设置HTTP客户端超时，完全依赖context超时控制
	// 这样避免了HTTP超时和context超时的冲突
	detailedHTTPClient := &http.Client{
		Transport: c.httpClient.Transport, // 复用原客户端的代理设置
		// 不设置 Timeout，让 context 控制超时
	}

	// 构建位置信息字符串
	var locationStrings []string
	for key, value := range locationInfo {
		if value != "" {
			locationStrings = append(locationStrings, fmt.Sprintf("%s: %s", key, value))
		}
	}
	locationText := strings.Join(locationStrings, ", ")
	if locationText == "" {
		locationText = fmt.Sprintf("Coordinates: %.6f, %.6f", latitude, longitude)
	}

	// 根据语言选择提示词格式
	outputFormat := "Please respond in Chinese"
	if language != "zh" {
		outputFormat = "Please respond in English"
	}

	// 构建详细分析请求
	detailedPrompt := fmt.Sprintf(
		"Your friend wants you to dig deeper into this location. Take your time and think carefully.\n"+
			"Coordinates: %.6f, %.6f\n"+
			"Location Info: %s\n\n"+
			"Cover these angles with real substance:\n"+
			"- History: what happened here, how did this place evolve, key turning points\n"+
			"- Built environment: architecture styles, urban planning, infrastructure quality\n"+
			"- People and culture: who lives here, local customs, demographics, daily life\n"+
			"- Economy: what drives the local economy, major industries, employment\n"+
			"- Geography and environment: terrain, climate, natural features\n"+
			"- How this place connects to and matters within its broader region\n\n"+
			"You have real-time web search results at your disposal — use them thoroughly. Cross-reference sources for historical dates, demographic data, economic figures, and recent local developments. Go deeper than surface-level knowledge.\n\n"+
			"Write as Atlas — warm, witty, talking to a friend. Every sentence should carry actual information. 3-5 paragraphs.\n"+
			"CRITICAL: pure plain text only, absolutely no markdown formatting (no asterisks, no bold, no headers, no bullet points).\n"+
			"If a specific claim is uncertain and unsupported by search results, keep it modest rather than inventing details.\n\n"+
			"%s",
		latitude, longitude, locationText, outputFormat)

	// 构建消息
	messages := []ChatMessage{
		{
			Role:    "system",
			Content: geographerSystemPrompt,
		},
		{
			Role:    "user",
			Content: detailedPrompt,
		},
	}

	reqBody := chatRequest{
		Model:    c.modelName,
		Messages: messages,
		Plugins:  []webPlugin{{ID: "web", MaxResults: 6}},
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", nil, fmt.Errorf("编码请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiEndpoint, bytes.NewBuffer(reqJSON))
	if err != nil {
		return "", nil, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := detailedHTTPClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("[AI_ERROR] action=timeout function=GenerateDetailedLocationDescription duration=%v timeout=%v",
				time.Since(startTime), detailedTimeout)
			return "", nil, fmt.Errorf("详细描述生成超时")
		}
		log.Printf("[AI_ERROR] action=request_failed function=GenerateDetailedLocationDescription duration=%v error=%v",
			time.Since(startTime), err)
		return "", nil, fmt.Errorf("发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[AI_ERROR] action=read_response_failed function=GenerateDetailedLocationDescription duration=%v error=%v",
			time.Since(startTime), err)
		return "", nil, fmt.Errorf("读取响应失败: %w", err)
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		log.Printf("[AI_ERROR] action=api_error function=GenerateDetailedLocationDescription duration=%v status=%d",
			time.Since(startTime), resp.StatusCode)
		return "", nil, fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
	}

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		log.Printf("[AI_ERROR] action=parse_failed function=GenerateDetailedLocationDescription duration=%v error=%v",
			time.Since(startTime), err)
		return "", nil, fmt.Errorf("解析响应失败: %w", err)
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

	result := stripInlineCitations(chatResp.Choices[0].Message.Content, chatResp.Choices[0].Message.Annotations)
	citations := extractCitations(chatResp)

	// 简化的成功日志
	logger.Info("ai_request_completed", "AI detailed description generation completed", map[string]interface{}{
		"function":        "GenerateDetailedLocationDescription",
		"duration":        time.Since(startTime).String(),
		"response_length": len(result),
		"citations_count": len(citations),
	})

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

	req, err := http.NewRequestWithContext(ctx, "POST", apiEndpoint, bytes.NewBuffer(reqJSON))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("请求超时")
		}
		return nil, fmt.Errorf("发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	// 检查响应状态码
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
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
