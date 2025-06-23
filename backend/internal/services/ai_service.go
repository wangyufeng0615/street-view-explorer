package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/my-streetview-project/backend/internal/config"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/openai"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/utils"
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
	startTime := time.Now()
	logger := utils.AILogger()

	// Get location info
	var locationInfo map[string]string
	var err error

	if ai.config.EnableGoogleAPI() {
		locationInfo, err = ai.maps.GetLocationInfo(context.Background(), loc.Latitude, loc.Longitude, language)
		if err != nil {
			logger.Error("maps_failed", "Failed to get location info from Google Maps", err, map[string]interface{}{
				"pano_id":   loc.PanoID,
				"language":  language,
				"latitude":  loc.Latitude,
				"longitude": loc.Longitude,
			})
			return "", fmt.Errorf("获取位置信息失败: %v", err)
		}
	} else {
		locationInfo = getDefaultLocationInfo(loc)
	}

	// Generate description using AI
	var desc string
	if ai.config.EnableOpenAI() {
		description, _, err := ai.openAI.GenerateLocationDescription(loc.Latitude, loc.Longitude, locationInfo, language)
		if err != nil {
			logger.Error("ai_generation_failed", "Failed to generate AI description", err, map[string]interface{}{
				"pano_id":  loc.PanoID,
				"language": language,
				"duration": time.Since(startTime).String(),
			})
			return "", fmt.Errorf("AI 描述生成失败: %v", err)
		}
		desc = description
	} else {
		desc = getDefaultDescription(locationInfo)
	}

	// 验证生成的描述是否有效
	if desc == "" || strings.TrimSpace(desc) == "" {
		logger.Warn("empty_description", "Generated empty AI description", map[string]interface{}{
			"pano_id":     loc.PanoID,
			"language":    language,
			"desc_length": len(desc),
		})
		return "", fmt.Errorf("生成的AI描述为空或无效")
	}

	logger.LogRequest("description_generated", time.Since(startTime), map[string]interface{}{
		"pano_id":     loc.PanoID,
		"language":    language,
		"desc_length": len(desc),
	})
	return desc, nil
}

// GetDetailedDescriptionForLocation 获取位置的详细AI描述
func (ai *AIService) GetDetailedDescriptionForLocation(loc models.Location, language string) (string, error) {
	startTime := time.Now()
	logger := utils.AILogger()

	// Get location info
	var locationInfo map[string]string
	var err error

	if ai.config.EnableGoogleAPI() {
		locationInfo, err = ai.maps.GetLocationInfo(context.Background(), loc.Latitude, loc.Longitude, language)
		if err != nil {
			logger.Error("maps_failed", "Failed to get location info for detailed description", err, map[string]interface{}{
				"pano_id": loc.PanoID,
				"language": language,
			})
			return "", fmt.Errorf("获取位置信息失败: %v", err)
		}
	} else {
		locationInfo = getDefaultLocationInfo(loc)
	}

	// Generate detailed description using AI
	var desc string
	if ai.config.EnableOpenAI() {
		desc, err = ai.openAI.GenerateDetailedLocationDescription(loc.Latitude, loc.Longitude, locationInfo, language)
		if err != nil {
			logger.Error("detailed_ai_failed", "Failed to generate detailed AI description", err, map[string]interface{}{
				"pano_id": loc.PanoID,
				"language": language,
				"duration": time.Since(startTime).String(),
			})
			return "", fmt.Errorf("AI 详细描述生成失败: %v", err)
		}
	} else {
		desc = getDefaultDetailedDescription(locationInfo)
	}

	// 验证生成的描述是否有效
	if desc == "" || strings.TrimSpace(desc) == "" {
		logger.Warn("empty_detailed_description", "Generated empty detailed AI description", map[string]interface{}{
			"pano_id": loc.PanoID,
			"language": language,
			"desc_length": len(desc),
		})
		return "", fmt.Errorf("生成的AI详细描述为空或无效")
	}

	logger.LogRequest("detailed_description_generated", time.Since(startTime), map[string]interface{}{
		"pano_id": loc.PanoID,
		"language": language,
		"desc_length": len(desc),
	})
	return desc, nil
}

// 生成默认的位置信息
func getDefaultLocationInfo(loc models.Location) map[string]string {
	return map[string]string{
		"formatted_address": fmt.Sprintf("[MOCK DATA] Location at coordinates (%.6f, %.6f)", loc.Latitude, loc.Longitude),
	}
}

// 生成默认的描述
func getDefaultDescription(locationInfo map[string]string) string {
	address := locationInfo["formatted_address"]
	if address == "" || strings.TrimSpace(address) == "" {
		address = "an unknown location"
	}
	return fmt.Sprintf("[MOCK DATA] This is a location at %s.", address)
}

// 生成默认的详细描述
func getDefaultDetailedDescription(locationInfo map[string]string) string {
	address := locationInfo["formatted_address"]
	if address == "" || strings.TrimSpace(address) == "" {
		address = "an unknown location"
	}
	return fmt.Sprintf("[MOCK DATA] This is a detailed analysis of the location at %s. Here you would find comprehensive information about the area's history, culture, architecture, and significance.", address)
}

