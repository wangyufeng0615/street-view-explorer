package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/my-streetview-project/backend/internal/config"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/openai"
	"github.com/my-streetview-project/backend/internal/repositories"
)

type AIService struct {
	repo   repositories.Repository
	openAI openai.Client
	maps   *MapsService
	config config.Config
}

func NewAIService(cfg config.Config, repo repositories.Repository) (*AIService, error) {
	mapsService, err := NewMapsService(cfg.GoogleMapsAPIKey())
	if err != nil {
		return nil, fmt.Errorf("创建 MapsService 失败: %w", err)
	}

	return &AIService{
		repo:   repo,
		openAI: openai.NewClient(cfg.OpenAIAPIKey()),
		maps:   mapsService,
		config: cfg,
	}, nil
}

func (ai *AIService) GetDescriptionForLocation(loc models.Location, language string) (string, error) {
	log.Printf("Getting location description (PanoID: %s, Language: %s)", loc.PanoID, language)

	// Check if we have a cached description in the requested language
	if loc.AIDescription != "" && loc.DescriptionLanguage == language {
		log.Printf("Using cached description in %s", language)
		return loc.AIDescription, nil
	}

	// Get location info
	var locationInfo map[string]string
	var err error

	if ai.config.EnableGoogleAPI() {
		locationInfo, err = ai.maps.GetLocationInfo(context.Background(), loc.Latitude, loc.Longitude, language)
		if err != nil {
			log.Printf("Failed to get location info: %v", err)
			return "", fmt.Errorf("获取位置信息失败: %v", err)
		}
		// 添加调试日志 - 记录AI服务获取到的locationInfo
		log.Printf("AI服务 - 从Maps服务获取的locationInfo: %+v", locationInfo)
	} else {
		log.Printf("Google API disabled, using mock data")
		locationInfo = getDefaultLocationInfo(loc)
	}

	// Generate description using AI
	var desc string
	var conversationHistoryJSON string
	if ai.config.EnableOpenAI() {
		description, conversationHistory, err := ai.openAI.GenerateLocationDescription(loc.Latitude, loc.Longitude, locationInfo, language)
		if err != nil {
			log.Printf("AI call failed: %v", err)
			return "", fmt.Errorf("AI 描述生成失败: %v", err)
		}
		desc = description

		// 序列化对话历史
		if historyBytes, err := json.Marshal(conversationHistory); err == nil {
			conversationHistoryJSON = string(historyBytes)
		}
	} else {
		log.Printf("AI disabled, using mock data")
		desc = getDefaultDescription(locationInfo)
	}

	// Save description and conversation history
	if err := ai.repo.SaveAIDescriptionWithHistory(loc.PanoID, desc, language, conversationHistoryJSON); err != nil {
		log.Printf("Failed to save description: %v", err)
	}

	return desc, nil
}

// GetDetailedDescriptionForLocation 获取位置的详细AI描述
func (ai *AIService) GetDetailedDescriptionForLocation(loc models.Location, language string) (string, error) {
	log.Printf("Getting detailed location description (PanoID: %s, Language: %s)", loc.PanoID, language)

	// 详细描述需要基于之前的对话历史
	if loc.ConversationHistory == "" {
		return "", fmt.Errorf("没有找到基础对话历史，请先生成基础描述")
	}

	// 解析对话历史
	var conversationHistory []map[string]interface{}
	if err := json.Unmarshal([]byte(loc.ConversationHistory), &conversationHistory); err != nil {
		log.Printf("Failed to parse conversation history: %v", err)
		return "", fmt.Errorf("解析对话历史失败: %v", err)
	}

	// Generate detailed description using AI
	if ai.config.EnableOpenAI() {
		// 将对话历史转换为openai.ChatMessage格式
		var previousMessages []openai.ChatMessage
		for _, msg := range conversationHistory {
			if role, ok := msg["role"].(string); ok {
				if content, ok := msg["content"].(string); ok {
					previousMessages = append(previousMessages, openai.ChatMessage{
						Role:    role,
						Content: content,
					})
				}
			}
		}

		desc, err := ai.openAI.GenerateDetailedLocationDescription(previousMessages, language)
		if err != nil {
			log.Printf("AI detailed description call failed: %v", err)
			return "", fmt.Errorf("AI 详细描述生成失败: %v", err)
		}
		return desc, nil
	} else {
		log.Printf("AI disabled, using mock detailed data")
		return getDefaultDetailedDescription(map[string]string{
			"formatted_address": loc.FormattedAddress,
		}), nil
	}
}

// 生成默认的位置信息
func getDefaultLocationInfo(loc models.Location) map[string]string {
	return map[string]string{
		"formatted_address": fmt.Sprintf("[MOCK DATA] Location at coordinates (%.6f, %.6f)", loc.Latitude, loc.Longitude),
	}
}

// 生成默认的描述
func getDefaultDescription(locationInfo map[string]string) string {
	return fmt.Sprintf("[MOCK DATA] This is a location at %s.", locationInfo["formatted_address"])
}

// 生成默认的详细描述
func getDefaultDetailedDescription(locationInfo map[string]string) string {
	return fmt.Sprintf("[MOCK DATA] This is a detailed analysis of the location at %s. Here you would find comprehensive information about the area's history, culture, architecture, and significance.", locationInfo["formatted_address"])
}
