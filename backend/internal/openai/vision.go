package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

type visionContentPart struct {
	Type     string          `json:"type"`
	Text     string          `json:"text,omitempty"`
	ImageURL *visionImageURL `json:"image_url,omitempty"`
}

type visionImageURL struct {
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"`
}

func sceneDataURI(scene *SceneImage) string {
	contentType := strings.ToLower(strings.TrimSpace(scene.ContentType))
	if contentType != "image/png" && contentType != "image/jpeg" {
		contentType = "image/jpeg"
	}
	return "data:" + contentType + ";base64," + scene.Base64
}

// visionMessage is a chat message with multimodal content.
type visionMessage struct {
	Role    interface{} `json:"role"`
	Content interface{} `json:"content"` // string or []visionContentPart
}

type visionChatRequest struct {
	Model             string               `json:"model"`
	MaxTokens         int                  `json:"max_tokens,omitempty"`
	Messages          []visionMessage      `json:"messages"`
	Provider          *providerPreferences `json:"provider,omitempty"`
	Reasoning         *reasoningConfig     `json:"reasoning,omitempty"`
	Tools             []webSearchTool      `json:"tools,omitempty"`
	ToolChoice        string               `json:"tool_choice,omitempty"`
	ParallelToolCalls *bool                `json:"parallel_tool_calls,omitempty"`
	Stream            bool                 `json:"stream,omitempty"`
	MaxToolCalls      int                  `json:"max_tool_calls,omitempty"`
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
		Model:     c.visionModel(),
		MaxTokens: geoAIMaxTokens,
		Provider:  selectProviderPreferences(),
		Reasoning: &reasoningConfig{Enabled: false},
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
