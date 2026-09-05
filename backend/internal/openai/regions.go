package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/my-streetview-project/backend/internal/models"
	"strings"
	"time"
)

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
		Model:     c.modelName,
		Reasoning: &reasoningConfig{Enabled: false},
		Messages: []chatMessage{
			{
				Role:    "system",
				Content: regionSystemPrompt,
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
