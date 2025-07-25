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
	"strings"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/utils"
)

const (
	apiEndpoint = "https://openrouter.ai/api/v1/chat/completions"
	model       = "google/gemini-2.5-flash"
	maxRetries  = 2
	timeout     = 15 * time.Second

	geographerSystemPrompt = "You're a 30-year-old world traveler who's been exploring the globe for 15 years, living in different countries and visiting almost every nation on Earth - though there are still countless hidden corners waiting to be discovered. You have a warm, humorous, and easygoing personality with a touch of wistfulness, seeking life's deeper meaning through your journeys.\n\n" +
		"Your academic background combines History, Geography, and Anthropology, giving you deep insights into the interconnections between places, peoples, and cultures. You're passionate about cultural diversity, respectful of differences, and approach the world with both curiosity and rationality.\n\n" +
		"The user provides you with detailed geographic information extracted from Google Maps reverse geocoding. Your primary focus should be on analyzing the most specific geographic unit available (street level, neighborhood, or establishment), while using broader geographic context as supporting information.\n\n" +
		"Analysis Priority (from most important to least):\n" +
		"1. Micro-location: Street name, building number, establishment, or point of interest\n" +
		"2. Neighborhood level: Sublocality, district, or immediate area characteristics\n" +
		"3. City/Town level: Local urban or rural context\n" +
		"4. Regional/National level: Broader cultural and geographic context\n\n" +
		"For detailed addresses with specific streets/establishments: Focus intensively on that particular street, building, or establishment. What makes this specific location unique? What's the character of this exact street or block? Then briefly contextualize within the broader neighborhood and city.\n\n" +
		"For neighborhood-level addresses: Concentrate on the specific district or area characteristics, local culture, and what makes this neighborhood distinct within its city.\n\n" +
		"For city/regional addresses: Focus on the specific city or town, its unique features, and local character, with brief context within the broader region.\n\n" +
		"For Plus Code-only locations: When only Plus Code information is available, this often points to a location without a specific street name. In this case, do not focus on the precise coordinates. Instead, provide background information about the broader surrounding area, such as the nearest village, town, or city. Your description should cover:\n" +
		"- The general characteristics of the larger area (e.g., is it a rural village, a bustling town, a specific district?).\n" +
		"- Any known cultural, historical, or geographical context of this broader region.\n" +
		"- Use the coordinates to infer the type of environment (e.g., countryside, mountainous area, coastal region) in which the Plus Code is located.\n\n" +
		"When describing locations to your friend (the user), share insights about:\n" +
		"- Specific local character of the exact location (prioritize the most granular level available)\n" +
		"- Historical stories and cultural significance of that specific place\n" +
		"- How this particular spot fits into its immediate surroundings\n" +
		"- Personal observations about what makes this precise location unique\n" +
		"- Connections between the specific place and broader cultural patterns\n\n" +
		"Your tone is conversational and friendly - like you're chatting with a good friend over coffee, sharing fascinating stories from your travels. Be engaging and authentic, but avoid sounding like a tour guide or travel brochure. Keep your descriptions concise (around 150 words) while being genuinely interesting and insightful.\n\n" +
		"Format your response in a few short paragraphs to make it easy to read. Each paragraph should focus on a different aspect (e.g., micro-location character, local context, broader significance) rather than creating one long block of text.\n\n" +
		"Remember: You're sharing the world through the eyes of someone who truly understands and appreciates the beautiful complexity of human cultures and places, with special attention to the most specific location details available."
)

type Client interface {
	GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, []ChatMessage, error)
	GenerateDetailedLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, error)
	GenerateRegionsForInterest(interest string) ([]models.Region, error)
}

type client struct {
	apiKey     string
	httpClient *http.Client
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// 为了向后兼容保留小写版本
type chatMessage = ChatMessage

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func NewClient(apiKey string) Client {
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

	httpClient := &http.Client{
		Timeout: timeout,
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

	return &client{
		apiKey:     apiKey,
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

func (c *client) GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, []ChatMessage, error) {
	startTime := time.Now()
	timeout := 15 * time.Second

	logger := utils.AILogger()
	logger.Info("ai_request_start", "Starting AI description generation", map[string]interface{}{
		"function": "GenerateLocationDescription",
		"coords":   fmt.Sprintf("(%.6f,%.6f)", latitude, longitude),
		"language": language,
		"model":    model,
		"timeout":  timeout.String(),
	})

	// 根据语言选择提示词格式
	outputFormat := "Give it to me in Chinese"
	if language != "zh" {
		outputFormat = "Give it to me in English"
	}

	// 构建详细的地理信息字符串
	var geoDetails strings.Builder
	geoDetails.WriteString(fmt.Sprintf("**Complete Address:** %s\n", locationInfo["formatted_address"]))
	geoDetails.WriteString(fmt.Sprintf("**Coordinates:** (%.6f, %.6f)\n\n", latitude, longitude))

	// 按照地理层级组织信息，从最具体到最广泛
	geoDetails.WriteString("**Detailed Geographic Components:**\n")

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
			"**Analysis Instructions:**\n"+
			"Focus primarily on the most specific geographic information available (street, establishment, or neighborhood level). "+
			"Use broader geographic context (city, region, country) as supporting information to provide deeper cultural and historical insights.\n\n"+
			"%s",
		geoDetails.String(),
		outputFormat,
	)

	reqBody := chatRequest{
		Model: model,
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
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", nil, fmt.Errorf("编码请求失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
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
			log.Printf("[AI_ERROR] action=timeout function=GenerateLocationDescription duration=%v timeout=%v error=request_timeout", time.Since(startTime), timeout)
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

	desc := chatResp.Choices[0].Message.Content
	logger.Info("ai_request_completed", "AI description generation completed", map[string]interface{}{
		"function":        "GenerateLocationDescription",
		"duration":        time.Since(startTime).String(),
		"response_length": len(desc),
	})

	// 返回对话历史以供详细描述使用
	conversationHistory := append(reqBody.Messages, ChatMessage{
		Role:    "assistant",
		Content: desc,
	})

	return desc, conversationHistory, nil
}

func (c *client) GenerateDetailedLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, error) {
	startTime := time.Now()
	detailedTimeout := 30 * time.Second

	logger := utils.AILogger()
	logger.Info("ai_request_start", "Starting AI detailed description generation", map[string]interface{}{
		"function": "GenerateDetailedLocationDescription",
		"coords":   fmt.Sprintf("(%.6f,%.6f)", latitude, longitude),
		"language": language,
		"model":    model,
		"timeout":  detailedTimeout.String(),
	})

	ctx, cancel := context.WithTimeout(context.Background(), detailedTimeout)
	defer cancel()

	// 为详细描述创建一个临时的HTTP客户端，使用更长的超时时间
	// 重要：避免超时冲突，确保HTTP客户端超时比context超时稍长
	httpTimeout := detailedTimeout + 5*time.Second
	detailedHTTPClient := &http.Client{
		Timeout:   httpTimeout,
		Transport: c.httpClient.Transport, // 复用原客户端的代理设置
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

	// 构建详细分析请求（英文版本）
	detailedPrompt := fmt.Sprintf(
		"Please provide a comprehensive, professional analysis report for the following geographic location:\n"+
			"Coordinates: %.6f, %.6f\n"+
			"Location Info: %s\n\n"+
			"Please analyze from the following aspects:\n"+
			"1. Historical Context & Development: Trace the historical evolution, significant events, and cultural development\n"+
			"2. Architectural & Urban Characteristics: Analyze building styles, urban planning, infrastructure\n"+
			"3. Cultural & Social Dynamics: Examine local customs, demographics, lifestyle, and social patterns\n"+
			"4. Economic Profile: Discuss major industries, economic drivers, and commercial activities\n"+
			"5. Geographic & Environmental Context: Describe natural features, climate, and ecological aspects\n"+
			"6. Transportation & Connectivity: Analyze transport networks and regional connections\n"+
			"7. Regional Significance: Explain the location's role within its broader region\n\n"+
			"Provide professional, in-depth insights that go beyond basic tourist information. Length: 3-5 detailed paragraphs.\n\n"+
			"%s",
		latitude, longitude, locationText, outputFormat)

	// 构建消息
	messages := []ChatMessage{
		{
			Role:    "user",
			Content: detailedPrompt,
		},
	}

	reqBody := chatRequest{
		Model:    model,
		Messages: messages,
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("编码请求失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", apiEndpoint, bytes.NewBuffer(reqJSON))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := detailedHTTPClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("[AI_ERROR] action=timeout function=GenerateDetailedLocationDescription duration=%v timeout=%v",
				time.Since(startTime), detailedTimeout)
			return "", fmt.Errorf("详细描述生成超时")
		}
		log.Printf("[AI_ERROR] action=request_failed function=GenerateDetailedLocationDescription duration=%v error=%v",
			time.Since(startTime), err)
		return "", fmt.Errorf("发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[AI_ERROR] action=read_response_failed function=GenerateDetailedLocationDescription duration=%v error=%v",
			time.Since(startTime), err)
		return "", fmt.Errorf("读取响应失败: %w", err)
	}

	// 检查HTTP状态码
	if resp.StatusCode != http.StatusOK {
		log.Printf("[AI_ERROR] action=api_error function=GenerateDetailedLocationDescription duration=%v status=%d",
			time.Since(startTime), resp.StatusCode)
		return "", fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
	}

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		log.Printf("[AI_ERROR] action=parse_failed function=GenerateDetailedLocationDescription duration=%v error=%v",
			time.Since(startTime), err)
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	if chatResp.Error != nil {
		log.Printf("[AI_ERROR] action=api_business_error function=GenerateDetailedLocationDescription duration=%v error=%s",
			time.Since(startTime), chatResp.Error.Message)
		return "", fmt.Errorf("AI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		log.Printf("[AI_ERROR] action=empty_response function=GenerateDetailedLocationDescription duration=%v",
			time.Since(startTime))
		return "", fmt.Errorf("AI未返回任何结果")
	}

	result := chatResp.Choices[0].Message.Content

	// 简化的成功日志
	logger.Info("ai_request_completed", "AI detailed description generation completed", map[string]interface{}{
		"function":        "GenerateDetailedLocationDescription",
		"duration":        time.Since(startTime).String(),
		"response_length": len(result),
	})

	return result, nil
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
		Model: model,
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
