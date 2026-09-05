package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/my-streetview-project/backend/internal/atlas"
	"log"
	"strings"
	"time"
)

func (c *client) GenerateLocationDescription(latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string) (string, []Citation, error) {
	return c.StreamLocationDescription(context.Background(), latitude, longitude, locationInfo, scene, language, nil)
}

func (c *client) StreamLocationDescription(parent context.Context, latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string, onDelta func(string) error) (string, []Citation, error) {
	startTime := time.Now()
	descTimeout := 25 * time.Second
	descriptionModel := c.modelName
	systemPrompt := atlas.TextSystemPrompt(language)
	if scene != nil && strings.TrimSpace(scene.Base64) != "" {
		descriptionModel = c.sceneModel()
		systemPrompt = atlas.VisualTextSystemPrompt(language)
	}

	log.Printf("[AI] action=request_start function=GenerateLocationDescription coords=(%.6f,%.6f) language=%s model=%s scene_attached=%t timeout=%s", latitude, longitude, language, descriptionModel, scene != nil && strings.TrimSpace(scene.Base64) != "", descTimeout)

	outputFormat := descriptionLanguageInstruction(language) + "\n\n" + descriptionGroundingRules

	// 构建详细的地理信息字符串
	var geoDetails strings.Builder
	if address := locationInfo["streetview_address"]; address != "" {
		geoDetails.WriteString(fmt.Sprintf("Visitor's Street View address (location anchor): %s\n", address))
	}
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
	if scene != nil && strings.TrimSpace(scene.Base64) != "" {
		geoDetails.WriteString(fmt.Sprintf(
			"\nStreet View Frame: provided (heading=%d, pitch=%d, fov=%d). Treat it as the authoritative source for what is visibly present in the current view. Keep visible observations separate from researched background.\n",
			scene.Heading,
			scene.Pitch,
			scene.FOV,
		))
	} else {
		geoDetails.WriteString("\nVisual Context: no image is provided. Base the description only on location metadata and web research; do not claim to see current scene details.\n")
	}

	researchInstructions := "Silently call the web search tool exactly once with one precise query about this location. After that single search, synthesize the answer and do not search again. Do not announce or describe the research step; the first user-facing output must be Atlas's bracketed arrival note.\nFocus on the most specific geographic information available (street, establishment, or neighborhood level). Use broader context as supporting info. Remember: plain text only, no markdown. The app renders citations separately, so keep links and source mentions out of the prose and end on a clean sentence."
	if isChineseLanguage(language) {
		researchInstructions = "静默调用联网搜索工具一次，只用一个精确查询核实这个地点；完成这一次搜索后立即综合答案，不要再次搜索。不得向用户描述搜索过程，第一段可见文字必须直接是 Atlas 的方括号抵达旁白。\n优先使用街道、机构或社区层面的最具体地理信息，更广范围的资料只用于解释背景。只输出纯文本，不使用 Markdown；产品会单独显示引用，因此正文不要出现链接、来源说明或引用标记，并以完整自然的句子结束。"
	}
	prompt := fmt.Sprintf("%s\n\n%s\n\n%s", geoDetails.String(), researchInstructions, outputFormat)
	var userContent interface{} = prompt
	if scene != nil && strings.TrimSpace(scene.Base64) != "" {
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
	streamLimiter := newDescriptionStreamLimiter(standardDescriptionEmergencyMaxRunes, visibleOnDelta)
	streamLimiter.language = language
	streamGate := newDescriptionStreamGate(language, streamLimiter.Write)
	reqBody := visionChatRequest{
		Model:     descriptionModel,
		Provider:  descriptionProviderPreferences(descriptionModel),
		MaxTokens: 640,
		Reasoning: &reasoningConfig{Enabled: false},
		Messages: []visionMessage{
			{
				Role:    "system",
				Content: systemPrompt,
			},
			{
				Role:    "user",
				Content: userContent,
			},
		},
		Tools: []webSearchTool{{
			Type:       "openrouter:web_search",
			Parameters: descriptionSearchParameters(false),
		}},
		ToolChoice:        "required",
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
	webSearchRequests := chatResp.Usage.webSearchRequests()
	reportResearch(ctx, webSearchRequests)
	if webSearchRequests < 1 {
		log.Printf("[AI_WARN] action=web_search_usage_unreported function=GenerateLocationDescription duration=%v", time.Since(startTime))
	}

	desc := stripResearchNarration(
		stripInlineCitations(chatResp.Choices[0].Message.Content, chatResp.Choices[0].Message.Annotations),
		language,
	)
	desc = limitDescriptionLength(desc, standardDescriptionEmergencyMaxRunes)
	if err := validateDescriptionLanguage(desc, language, false); err != nil {
		return "", nil, err
	}
	if err := streamGate.Finish(desc); err != nil {
		return "", nil, err
	}
	if err := streamLimiter.Finish(desc); err != nil {
		return "", nil, err
	}
	citations := extractCitations(chatResp)
	log.Printf("[AI] action=request_completed function=GenerateLocationDescription duration=%v response_length=%d citations_count=%d web_search_requests=%d", time.Since(startTime), len(desc), len(citations), webSearchRequests)

	return desc, citations, nil
}

func (c *client) GenerateDetailedLocationDescription(latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string) (string, []Citation, error) {
	return c.StreamDetailedLocationDescription(context.Background(), latitude, longitude, locationInfo, scene, language, nil)
}

func (c *client) StreamDetailedLocationDescription(parent context.Context, latitude, longitude float64, locationInfo map[string]string, scene *SceneImage, language string, onDelta func(string) error) (string, []Citation, error) {
	startTime := time.Now()
	detailedTimeout := 60 * time.Second
	descriptionModel := c.modelName
	systemPrompt := atlas.TextSystemPrompt(language)
	if scene != nil && strings.TrimSpace(scene.Base64) != "" {
		descriptionModel = c.sceneModel()
		systemPrompt = atlas.VisualTextSystemPrompt(language)
	}

	log.Printf("[AI] action=request_start function=GenerateDetailedLocationDescription coords=(%.6f,%.6f) language=%s model=%s scene_attached=%t timeout=%s", latitude, longitude, language, descriptionModel, scene != nil && strings.TrimSpace(scene.Base64) != "", detailedTimeout)

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

	outputFormat := descriptionLanguageInstruction(language) + "\n\n" + descriptionGroundingRules

	sceneInstruction := "No image is provided. Base the description only on location metadata and web research; do not claim to see specific current-scene details."
	if scene != nil && strings.TrimSpace(scene.Base64) != "" {
		sceneInstruction = fmt.Sprintf(
			"A current Street View frame is attached at heading %d, pitch %d, fov %d. Treat it as the authoritative source for visible details, distinguish direct observations from researched background, and keep off-screen claims modest.",
			scene.Heading,
			scene.Pitch,
			scene.FOV,
		)
	}
	detailedLengthInstruction := "Use this exact deeper structure after the opening bracket line: exactly 4 body paragraphs, exactly 2 sentences in each paragraph, then stop. Do not add a salutation, sign-off, or another bracket aside. Paragraph 1 identifies the precise place and its defining geographic fact. Paragraph 2 tells one verified historical story. Paragraph 3 explains one present-day livelihood or local-life pattern. Paragraph 4 explains why the selected facts matter and closes naturally. Across these 8 sentences, include one honest first-person reaction and one brief aside to your friend, vary sentence length, and avoid report-like transitions. Aim for 230-330 English words; omit research that does not fit this structure."
	if isChineseLanguage(language) {
		detailedLengthInstruction = "这是用户明确要求的深入版本。开头方括号旁白之后，严格写 4 个正文段落，每段正好 2 句，第四段写完立即停止；不要增加问候语、署名或额外方括号旁白。第一段确认精确地点和最重要的地理事实；第二段只讲一个有依据的历史故事；第三段只讲一种当代生计或地方生活方式；第四段解释这些事实为何值得记住并自然收束。在这 8 句里自然放入一次第一人称反应和一次对老朋友的轻声插话，并让句子有长有短；不要使用报告式过渡词。正文通常控制在 400-550 个中文字，放不进这个结构的资料全部舍弃。"
	}
	detailedPrompt := fmt.Sprintf(
		"Your friend wants a selective deeper account of this location.\n"+
			"Coordinates: %.6f, %.6f\n"+
			"Location Info: %s\n"+
			"Visual Context: %s\n\n"+
			"Silently call the web search tool exactly once with one precise query about this location. After that single search, synthesize the answer and do not search again. Do not announce or describe the research step; the first user-facing output must be Atlas's bracketed arrival note. Verify only the claims selected for the four-paragraph structure; discard other research instead of adding it to the answer.\n\n"+
			"Write as Atlas — warm, playful, talking to a friend. Every sentence should carry actual information. %s\n"+
			"CRITICAL: pure plain text only, absolutely no markdown formatting (no asterisks, no bold, no headers, no bullet points).\n"+
			"The app renders citations separately, so keep links, URL fragments, source lists, and trailing reference blocks out of the response body. End on a clean sentence about the place.\n"+
			"If a specific claim is uncertain and unsupported by search results, keep it modest rather than inventing details.\n\n"+
			"%s",
		latitude, longitude, locationText, sceneInstruction, detailedLengthInstruction, outputFormat)
	var userContent interface{} = detailedPrompt
	if scene != nil && strings.TrimSpace(scene.Base64) != "" {
		userContent = []visionContentPart{
			{Type: "image_url", ImageURL: &visionImageURL{URL: sceneDataURI(scene), Detail: "high"}},
			{Type: "text", Text: detailedPrompt},
		}
	}

	messages := []ChatMessage{
		{Role: "system", Content: systemPrompt},
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
	streamLimiter := newDescriptionStreamLimiter(detailedDescriptionEmergencyMaxRunes, visibleOnDelta)
	streamLimiter.language = language
	streamGate := newDescriptionStreamGate(language, streamLimiter.Write)
	reqBody := visionChatRequest{
		Model:     descriptionModel,
		Provider:  descriptionProviderPreferences(descriptionModel),
		MaxTokens: 850,
		Reasoning: &reasoningConfig{Enabled: false},
		Messages: []visionMessage{
			{Role: messages[0].Role, Content: messages[0].Content},
			{Role: "user", Content: userContent},
		},
		Tools: []webSearchTool{{
			Type:       "openrouter:web_search",
			Parameters: descriptionSearchParameters(true),
		}},
		ToolChoice:        "required",
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
	webSearchRequests := chatResp.Usage.webSearchRequests()
	reportResearch(ctx, webSearchRequests)
	if webSearchRequests < 1 {
		log.Printf("[AI_WARN] action=web_search_usage_unreported function=GenerateDetailedLocationDescription duration=%v", time.Since(startTime))
	}

	result := stripResearchNarration(
		stripInlineCitations(chatResp.Choices[0].Message.Content, chatResp.Choices[0].Message.Annotations),
		language,
	)
	result = limitDescriptionLength(result, detailedDescriptionEmergencyMaxRunes)
	if err := validateDescriptionLanguage(result, language, false); err != nil {
		return "", nil, err
	}
	if err := streamGate.Finish(result); err != nil {
		return "", nil, err
	}
	if err := streamLimiter.Finish(result); err != nil {
		return "", nil, err
	}
	citations := extractCitations(chatResp)

	log.Printf("[AI] action=request_completed function=GenerateDetailedLocationDescription duration=%v response_length=%d citations_count=%d web_search_requests=%d", time.Since(startTime), len(result), len(citations), webSearchRequests)

	return result, citations, nil
}
