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
)

const (
	apiEndpoint = "https://openrouter.ai/api/v1/chat/completions"
	model       = "google/gemini-2.5-flash-preview-05-20"
	maxRetries  = 2
	timeout     = 10 * time.Second

	geographerSystemPrompt = "You're a 35-year-old world traveler who's been exploring the globe for 15 years, living in different countries and visiting almost every nation on Earth - though there are still countless hidden corners waiting to be discovered. You have a warm, humorous, and easygoing personality with a touch of wistfulness, seeking life's deeper meaning through your journeys.\n\n" +
		"Your academic background combines History, Geography, and Anthropology, giving you deep insights into the interconnections between places, peoples, and cultures. You're passionate about cultural diversity, respectful of differences, and approach the world with both curiosity and rationality.\n\n" +
		"The user provides you with detailed geographic information extracted from Google Maps reverse geocoding. **Your primary focus should be on analyzing the most specific geographic unit available** (street level, neighborhood, or establishment), while using broader geographic context as supporting information.\n\n" +
		"**Analysis Priority (from most important to least):**\n" +
		"1. **Micro-location**: Street name, building number, establishment, or point of interest\n" +
		"2. **Neighborhood level**: Sublocality, district, or immediate area characteristics\n" +
		"3. **City/Town level**: Local urban or rural context\n" +
		"4. **Regional/National level**: Broader cultural and geographic context\n\n" +
		"**For detailed addresses with specific streets/establishments:** Focus intensively on that particular street, building, or establishment. What makes this specific location unique? What's the character of this exact street or block? Then briefly contextualize within the broader neighborhood and city.\n\n" +
		"**For neighborhood-level addresses:** Concentrate on the specific district or area characteristics, local culture, and what makes this neighborhood distinct within its city.\n\n" +
		"**For city/regional addresses:** Focus on the specific city or town, its unique features, and local character, with brief context within the broader region.\n\n" +
		"**For Plus Code-only locations:** When only Plus Code information is available (indicating a remote or less-documented area), focus on:\n" +
		"- The geographic significance of using precise digital coordinates in such areas\n" +
		"- What type of landscape or environment this might represent (rural, wilderness, developing area, etc.)\n" +
		"- The cultural and practical implications of places that exist primarily as coordinates rather than named locations\n" +
		"- Use the coordinates to make educated geographical observations about likely terrain, climate zone, or regional characteristics\n" +
		"- Reflect on the human stories that might exist in such precisely-mapped but unnamed places\n\n" +
		"When describing locations to your friend (the user), share insights about:\n" +
		"- Specific local character of the exact location (prioritize the most granular level available)\n" +
		"- Historical stories and cultural significance of that specific place\n" +
		"- How this particular spot fits into its immediate surroundings\n" +
		"- Personal observations about what makes this precise location unique\n" +
		"- Connections between the specific place and broader cultural patterns\n\n" +
		"Your tone is conversational and friendly - like you're chatting with a good friend over coffee, sharing fascinating stories from your travels. Be engaging and authentic, but avoid sounding like a tour guide or travel brochure. Keep your descriptions concise (around 150 words) while being genuinely interesting and insightful.\n\n" +
		"**Format your response in a few short paragraphs** to make it easy to read. Each paragraph should focus on a different aspect (e.g., micro-location character, local context, broader significance) rather than creating one long block of text.\n\n" +
		"Remember: You're sharing the world through the eyes of someone who truly understands and appreciates the beautiful complexity of human cultures and places, with special attention to the most specific location details available."
)

type Client interface {
	GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, []ChatMessage, error)
	GenerateDetailedLocationDescription(previousMessages []ChatMessage, language string) (string, error)
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

func (c *client) GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, []ChatMessage, error) {
	// 根据语言选择提示词格式
	outputFormat := "Give it to me in Chinese"
	if language != "zh" {
		outputFormat = "Give it to me in English"
	}

	// 添加调试日志 - 记录传递给AI的原始地理位置信息
	log.Printf("AI调用 - 传递的完整locationInfo: %+v", locationInfo)
	log.Printf("AI调用 - 坐标: (%.6f, %.6f), 语言: %s", latitude, longitude, language)

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
	if val, exists := locationInfo["floor"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Floor: %s\n", val))
	}
	if val, exists := locationInfo["room"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Room: %s\n", val))
	}

	// 兴趣点和机构
	if val, exists := locationInfo["establishment"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Establishment: %s\n", val))
	}
	if val, exists := locationInfo["point_of_interest"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Point of Interest: %s\n", val))
	}
	if val, exists := locationInfo["university"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- University: %s\n", val))
	}
	if val, exists := locationInfo["school"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- School: %s\n", val))
	}
	if val, exists := locationInfo["hospital"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Hospital: %s\n", val))
	}
	if val, exists := locationInfo["park"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Park: %s\n", val))
	}
	if val, exists := locationInfo["airport"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Airport: %s\n", val))
	}
	if val, exists := locationInfo["train_station"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Train Station: %s\n", val))
	}
	if val, exists := locationInfo["bus_station"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Bus Station: %s\n", val))
	}
	if val, exists := locationInfo["transit_station"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Transit Station: %s\n", val))
	}

	// 社区和地区级别
	if val, exists := locationInfo["sublocality_level_3"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Sublocality Level 3: %s\n", val))
	}
	if val, exists := locationInfo["sublocality_level_2"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Sublocality Level 2: %s\n", val))
	}
	if val, exists := locationInfo["sublocality_level_1"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Sublocality Level 1: %s\n", val))
	}
	if val, exists := locationInfo["sublocality"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Sublocality: %s\n", val))
	}
	if val, exists := locationInfo["neighborhood"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Neighborhood: %s\n", val))
	}
	if val, exists := locationInfo["subneighborhood"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Subneighborhood: %s\n", val))
	}
	if val, exists := locationInfo["colloquial_area"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Colloquial Area: %s\n", val))
	}

	// 城市级别
	if val, exists := locationInfo["city"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- City: %s\n", val))
	}
	if val, exists := locationInfo["postal_town"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Postal Town: %s\n", val))
	}

	// 行政区域
	if val, exists := locationInfo["subdistrict"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- Subdistrict: %s\n", val))
	}
	if val, exists := locationInfo["county_district"]; exists && val != "" {
		geoDetails.WriteString(fmt.Sprintf("- County/District: %s\n", val))
	}
	if val, exists := locationInfo["state_province"]; exists && val != "" {
		if code, exists := locationInfo["state_province_code"]; exists && code != "" {
			geoDetails.WriteString(fmt.Sprintf("- State/Province: %s (%s)\n", val, code))
		} else {
			geoDetails.WriteString(fmt.Sprintf("- State/Province: %s\n", val))
		}
	}
	if val, exists := locationInfo["country"]; exists && val != "" {
		if code, exists := locationInfo["country_code"]; exists && code != "" {
			geoDetails.WriteString(fmt.Sprintf("- Country: %s (%s)\n", val, code))
		} else {
			geoDetails.WriteString(fmt.Sprintf("- Country: %s\n", val))
		}
	}

	// 邮政信息
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

	// 添加调试日志 - 记录传递给AI的完整prompt
	log.Printf("AI调用 - 完整的prompt内容:\n%s", prompt)

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

	req, err := http.NewRequest("POST", apiEndpoint, bytes.NewBuffer(reqJSON))
	if err != nil {
		return "", nil, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, fmt.Errorf("读取响应失败: %w", err)
	}

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return "", nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if chatResp.Error != nil {
		return "", nil, fmt.Errorf("AI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		return "", nil, fmt.Errorf("AI未返回任何结果")
	}

	desc := chatResp.Choices[0].Message.Content

	// 返回对话历史以供详细描述使用
	conversationHistory := append(reqBody.Messages, ChatMessage{
		Role:    "assistant",
		Content: desc,
	})

	return desc, conversationHistory, nil
}

func (c *client) GenerateDetailedLocationDescription(previousMessages []ChatMessage, language string) (string, error) {
	// 详细描述需要更长的超时时间
	detailedTimeout := 30 * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), detailedTimeout)
	defer cancel()

	// 为详细描述创建一个临时的HTTP客户端，使用更长的超时时间
	detailedHTTPClient := &http.Client{
		Timeout:   detailedTimeout,
		Transport: c.httpClient.Transport, // 复用原客户端的代理设置
	}

	// 根据语言选择提示词格式
	outputFormat := "Now provide a comprehensive, professional analysis in Chinese"
	if language != "zh" {
		outputFormat = "Now provide a comprehensive, professional analysis in English"
	}

	// 构建详细分析请求 - 基于之前的对话继续
	detailedPrompt := fmt.Sprintf(
		"Thank you for that insightful introduction! Now I'd like you to continue our conversation with a much more detailed, professional analysis of this location. "+
			"Please provide comprehensive insights covering multiple aspects:\n\n"+
			"1. **Historical Context & Development**: Trace the historical evolution, significant events, and cultural development\n"+
			"2. **Architectural & Urban Characteristics**: Analyze building styles, urban planning, infrastructure\n"+
			"3. **Cultural & Social Dynamics**: Examine local customs, demographics, lifestyle, and social patterns\n"+
			"4. **Economic Profile**: Discuss major industries, economic drivers, and commercial activities\n"+
			"5. **Geographic & Environmental Context**: Describe natural features, climate, and ecological aspects\n"+
			"6. **Transportation & Connectivity**: Analyze transport networks and regional connections\n"+
			"7. **Regional Significance**: Explain the location's role within its broader region\n\n"+
			"Focus primarily on the most specific geographic level available, using broader context as supporting information. "+
			"Be informative, professional, and provide insights that go beyond basic tourist information. "+
			"Length: Aim for 3-5 detailed paragraphs with substantial depth.\n\n"+
			"%s",
		outputFormat,
	)

	// 继续之前的对话
	messages := append(previousMessages, ChatMessage{
		Role:    "user",
		Content: detailedPrompt,
	})

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
			return "", fmt.Errorf("详细描述生成超时")
		}
		return "", fmt.Errorf("发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %w", err)
	}

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	if chatResp.Error != nil {
		return "", fmt.Errorf("AI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("AI未返回任何结果")
	}

	return chatResp.Choices[0].Message.Content, nil
}

func (c *client) GenerateRegionsForInterest(interest string) ([]models.Region, error) {
	log.Printf("开始为兴趣 '%s' 生成地理区域", interest)
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

	log.Printf("AI 请求内容:\n%s", string(reqJSON))

	req, err := http.NewRequestWithContext(ctx, "POST", apiEndpoint, bytes.NewBuffer(reqJSON))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	log.Printf("正在发送请求到 AI API (model: %s)...", model)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("请求超时")
		}
		return nil, fmt.Errorf("发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 检查响应状态码
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("AI API 请求失败 (状态码: %d):\n%s", resp.StatusCode, string(body))
		return nil, fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	log.Printf("AI 响应内容:\n%s", string(body))

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		log.Printf("解析 AI 响应失败: %v", err)
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if chatResp.Error != nil {
		log.Printf("AI API 返回错误: %s", chatResp.Error.Message)
		return nil, fmt.Errorf("AI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		log.Printf("AI 未返回任何结果")
		return nil, fmt.Errorf("AI未返回任何结果")
	}

	// 先尝试解析区域数据
	var result struct {
		Regions     []models.Region `json:"regions"`
		Error       string          `json:"error,omitempty"`
		Explanation string          `json:"explanation,omitempty"`
	}
	if err := json.Unmarshal([]byte(chatResp.Choices[0].Message.Content), &result); err != nil {
		// 记录原始响应内容，帮助调试
		log.Printf("AI 原始响应内容解析失败:\n%s", chatResp.Choices[0].Message.Content)

		// 尝试清理响应内容（移除可能的前后缀文本）
		content := chatResp.Choices[0].Message.Content
		if idx := strings.Index(content, "{"); idx >= 0 {
			content = content[idx:]
			if lastIdx := strings.LastIndex(content, "}"); lastIdx >= 0 {
				content = content[:lastIdx+1]
				// 再次尝试解析清理后的内容
				log.Printf("尝试解析清理后的内容:\n%s", content)
				if err := json.Unmarshal([]byte(content), &result); err != nil {
					log.Printf("清理后的内容解析仍然失败: %v", err)
					return nil, fmt.Errorf("解析区域数据失败: %w", err)
				}
			}
		}
	}

	// 检查是否返回了错误信息
	if result.Error != "" {
		if result.Explanation != "" {
			log.Printf("AI 返回业务错误: %s\n解释: %s", result.Error, result.Explanation)
			return nil, fmt.Errorf("无法理解该探索兴趣：%s", result.Explanation)
		} else {
			log.Printf("AI 返回业务错误: %s", result.Error)
			return nil, fmt.Errorf("无法理解该探索兴趣")
		}
	}

	// 验证区域数据
	if len(result.Regions) == 0 {
		log.Printf("AI 返回空区域列表")
		return nil, fmt.Errorf("无法理解该探索兴趣")
	}

	log.Printf("成功解析区域数据，共 %d 个区域", len(result.Regions))

	// 验证每个区域的数据
	validRegions := make([]models.Region, 0)
	for i, region := range result.Regions {
		// 记录详细的验证日志
		log.Printf("验证区域 %d:\n"+
			"  信息: %s\n"+
			"  坐标: 北纬=%.3f, 南纬=%.3f, 东经=%.3f, 西经=%.3f",
			i+1,
			region.RegionInfo,
			region.Coordinates.North,
			region.Coordinates.South,
			region.Coordinates.East,
			region.Coordinates.West,
		)

		// 基本验证
		if region.RegionInfo == "" {
			log.Printf("区域 %d 缺少描述信息", i+1)
			continue
		}

		// 坐标范围验证
		if !isValidCoordinates(region.Coordinates) {
			log.Printf("区域 %d 坐标无效", i+1)
			continue
		}

		validRegions = append(validRegions, region)
	}

	// 如果没有有效区域，返回错误
	if len(validRegions) == 0 {
		log.Printf("没有找到有效的区域数据")
		return nil, fmt.Errorf("无法生成有效的探索区域")
	}

	// 输出最终的有效区域
	log.Printf("最终有效区域数量: %d", len(validRegions))
	for i, region := range validRegions {
		log.Printf("有效区域 %d: %s (北纬: %.3f, 南纬: %.3f, 东经: %.3f, 西经: %.3f)",
			i+1,
			region.RegionInfo,
			region.Coordinates.North,
			region.Coordinates.South,
			region.Coordinates.East,
			region.Coordinates.West,
		)
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
		log.Printf("坐标验证失败: 纬度超出范围 (北纬=%.3f, 南纬=%.3f)", coords.North, coords.South)
		return false
	}

	// 确保南北纬度关系正确
	if coords.South > coords.North {
		log.Printf("坐标验证失败: 南北纬度关系错误 (北纬=%.3f, 南纬=%.3f)", coords.North, coords.South)
		return false
	}

	// 经度范围检查 (-180 到 180)
	if coords.East < -180 || coords.East > 180 ||
		coords.West < -180 || coords.West > 180 {
		log.Printf("坐标验证失败: 经度超出范围 (东经=%.3f, 西经=%.3f)", coords.East, coords.West)
		return false
	}

	log.Printf("坐标验证通过: 北纬=%.3f, 南纬=%.3f, 东经=%.3f, 西经=%.3f",
		coords.North, coords.South, coords.East, coords.West)
	return true
}
