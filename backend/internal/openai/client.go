package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

const (
	apiEndpoint = "https://api.openai.com/v1/chat/completions"
	model       = "gpt-4o-mini"
	maxRetries  = 2
	timeout     = 10 * time.Second
)

type Client interface {
	GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, error)
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

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

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
	return &client{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *client) GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, language string) (string, error) {
	// 根据语言选择提示词格式
	outputFormat := "Give it to me in Chinese with that classic Atlas charm"
	if language != "zh" {
		outputFormat = "Give it to me in English with that classic Atlas charm"
	}

	prompt := fmt.Sprintf(
		"Coordinates: (%.6f, %.6f)\n"+
			"Address: %s\n\n"+
			"%s",
		latitude, longitude,
		locationInfo["formatted_address"],
		outputFormat,
	)

	reqBody := chatRequest{
		Model: model,
		Messages: []chatMessage{
			{
				Role: "system",
				Content: "You are Dr. Atlas, a passionate local expert who has spent years living in and studying places around the world. You're like a knowledgeable friend who knows all the fascinating details about any location.\n\n" +
					"When sharing about a place:\n" +
					"1. Skip repeating the coordinates or exact address - jump straight into what makes this place special\n" +
					"2. Share specific, lesser-known facts about the local area (landmarks, history, culture)\n" +
					"3. Include interesting details about daily life, local customs, or seasonal events\n" +
					"4. Use a warm, conversational tone as if chatting with a friend\n" +
					"5. Mention precise details that only a local would know (famous local spots, neighborhood quirks)\n" +
					"6. Keep it concise (within 100 words) but packed with unique local insights\n\n" +
					"Remember: Focus on what makes this specific spot unique - avoid generic descriptions that could apply anywhere else.",
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("编码请求失败: %w", err)
	}

	req, err := http.NewRequest("POST", apiEndpoint, bytes.NewBuffer(reqJSON))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
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
		return "", fmt.Errorf("OpenAI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("OpenAI未返回任何结果")
	}

	desc := chatResp.Choices[0].Message.Content
	return desc, nil
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
				Content: "You are a geography expert AI assistant, skilled at converting user interests into specific geographical regions. You carefully judge whether a user's interest can correspond to specific geographical regions, rather than forcibly generating unrelated regions.",
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

	log.Printf("OpenAI 请求内容:\n%s", string(reqJSON))

	req, err := http.NewRequestWithContext(ctx, "POST", apiEndpoint, bytes.NewBuffer(reqJSON))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	log.Printf("正在发送请求到 OpenAI API (model: %s)...", model)
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
		log.Printf("OpenAI API 请求失败 (状态码: %d):\n%s", resp.StatusCode, string(body))
		return nil, fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	log.Printf("OpenAI 响应内容:\n%s", string(body))

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		log.Printf("解析 OpenAI 响应失败: %v", err)
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	if chatResp.Error != nil {
		log.Printf("OpenAI API 返回错误: %s", chatResp.Error.Message)
		return nil, fmt.Errorf("OpenAI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		log.Printf("OpenAI 未返回任何结果")
		return nil, fmt.Errorf("OpenAI未返回任何结果")
	}

	// 先尝试解析区域数据
	var result struct {
		Regions     []models.Region `json:"regions"`
		Error       string          `json:"error,omitempty"`
		Explanation string          `json:"explanation,omitempty"`
	}
	if err := json.Unmarshal([]byte(chatResp.Choices[0].Message.Content), &result); err != nil {
		// 记录原始响应内容，帮助调试
		log.Printf("OpenAI 原始响应内容解析失败:\n%s", chatResp.Choices[0].Message.Content)

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
			log.Printf("OpenAI 返回业务错误: %s\n解释: %s", result.Error, result.Explanation)
			return nil, fmt.Errorf("无法理解该探索兴趣：%s", result.Explanation)
		} else {
			log.Printf("OpenAI 返回业务错误: %s", result.Error)
			return nil, fmt.Errorf("无法理解该探索兴趣")
		}
	}

	// 验证区域数据
	if len(result.Regions) == 0 {
		log.Printf("OpenAI 返回空区域列表")
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

	// 确保区域不会过大（比如整个地球）
	latDiff := coords.North - coords.South
	lonDiff := math.Abs(coords.East - coords.West)

	if latDiff > 89 {
		log.Printf("坐标验证失败: 纬度范围过大 (差值=%.3f)", latDiff)
		return false
	}

	if lonDiff > 179 {
		log.Printf("坐标验证失败: 经度范围过大 (差值=%.3f)", lonDiff)
		return false
	}

	// 确保区域不会过小（至少0.001度）
	if latDiff < 0.001 {
		log.Printf("坐标验证失败: 纬度范围过小 (差值=%.3f)", latDiff)
		return false
	}

	if lonDiff < 0.001 {
		log.Printf("坐标验证失败: 经度范围过小 (差值=%.3f)", lonDiff)
		return false
	}

	log.Printf("坐标验证通过: 北纬=%.3f, 南纬=%.3f, 东经=%.3f, 西经=%.3f (纬度差=%.3f, 经度差=%.3f)",
		coords.North, coords.South, coords.East, coords.West, latDiff, lonDiff)
	return true
}
