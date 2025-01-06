package services

import (
	"context"
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
		locationInfo, err = ai.maps.GetLocationInfo(context.Background(), loc.Latitude, loc.Longitude)
		if err != nil {
			log.Printf("Failed to get location info: %v", err)
			return "", fmt.Errorf("获取位置信息失败: %v", err)
		}
	} else {
		log.Printf("Google API disabled, using mock data")
		locationInfo = getDefaultLocationInfo(loc)
	}

	// Generate description using OpenAI
	var desc string
	if ai.config.EnableOpenAI() {
		desc, err = ai.openAI.GenerateLocationDescription(loc.Latitude, loc.Longitude, locationInfo, language)
		if err != nil {
			log.Printf("OpenAI call failed: %v", err)
			return "", fmt.Errorf("AI 描述生成失败: %v", err)
		}
	} else {
		log.Printf("OpenAI disabled, using mock data")
		desc = getDefaultDescription(locationInfo)
	}

	// Save description
	if err := ai.repo.SaveAIDescription(loc.PanoID, desc, language); err != nil {
		log.Printf("Failed to save description: %v", err)
	}

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
	return fmt.Sprintf("[MOCK DATA] This is a location at %s.", locationInfo["formatted_address"])
}
