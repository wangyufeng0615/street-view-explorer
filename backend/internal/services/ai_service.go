package services

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

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
	startTime := time.Now()
	log.Printf("[SERVICE_CALL] action=start service=AIService method=GetDescriptionForLocation pano_id=%s lang=%s coords=(%.6f,%.6f)", loc.PanoID, language, loc.Latitude, loc.Longitude)

	// Get location info
	var locationInfo map[string]string
	var err error

	if ai.config.EnableGoogleAPI() {
		locationInfo, err = ai.maps.GetLocationInfo(context.Background(), loc.Latitude, loc.Longitude, language)
		if err != nil {
			log.Printf("[SERVICE_ERROR] action=maps_failed service=AIService pano_id=%s error=%v", loc.PanoID, err)
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
			log.Printf("[SERVICE_ERROR] action=ai_failed service=AIService pano_id=%s duration=%v error=%v", loc.PanoID, time.Since(startTime), err)
			return "", fmt.Errorf("AI 描述生成失败: %v", err)
		}
		desc = description
	} else {
		desc = getDefaultDescription(locationInfo)
	}

	// 验证生成的描述是否有效
	if desc == "" || strings.TrimSpace(desc) == "" {
		log.Printf("[SERVICE_ERROR] action=empty_description service=AIService pano_id=%s desc_length=%d", loc.PanoID, len(desc))
		return "", fmt.Errorf("生成的AI描述为空或无效")
	}

	totalDuration := time.Since(startTime)
	log.Printf("[SERVICE_SUCCESS] action=completed service=AIService method=GetDescriptionForLocation pano_id=%s duration=%v desc_length=%d", loc.PanoID, totalDuration, len(desc))
	return desc, nil
}

// GetDetailedDescriptionForLocation 获取位置的详细AI描述
func (ai *AIService) GetDetailedDescriptionForLocation(loc models.Location, language string) (string, error) {
	startTime := time.Now()
	log.Printf("[SERVICE_CALL] action=start service=AIService method=GetDetailedDescriptionForLocation pano_id=%s lang=%s coords=(%.6f,%.6f)", loc.PanoID, language, loc.Latitude, loc.Longitude)

	// Get location info
	var locationInfo map[string]string
	var err error

	if ai.config.EnableGoogleAPI() {
		locationInfo, err = ai.maps.GetLocationInfo(context.Background(), loc.Latitude, loc.Longitude, language)
		if err != nil {
			log.Printf("[SERVICE_ERROR] action=maps_failed service=AIService pano_id=%s error=%v", loc.PanoID, err)
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
			log.Printf("[SERVICE_ERROR] action=detailed_ai_failed service=AIService pano_id=%s duration=%v error=%v", loc.PanoID, time.Since(startTime), err)
			return "", fmt.Errorf("AI 详细描述生成失败: %v", err)
		}
	} else {
		desc = getDefaultDetailedDescription(locationInfo)
	}

	// 验证生成的描述是否有效
	if desc == "" || strings.TrimSpace(desc) == "" {
		log.Printf("[SERVICE_ERROR] action=empty_detailed_description service=AIService pano_id=%s desc_length=%d", loc.PanoID, len(desc))
		return "", fmt.Errorf("生成的AI详细描述为空或无效")
	}

	totalDuration := time.Since(startTime)
	log.Printf("[SERVICE_SUCCESS] action=completed service=AIService method=GetDetailedDescriptionForLocation pano_id=%s duration=%v desc_length=%d", loc.PanoID, totalDuration, len(desc))
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

