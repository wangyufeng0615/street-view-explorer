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

func (ai *AIService) GetDescriptionForLocation(loc models.Location) (string, error) {
	log.Printf("获取位置描述 (PanoID: %s)", loc.PanoID)

	// 获取地理信息
	var locationInfo map[string]string
	var err error

	if ai.config.EnableGoogleAPI() {
		locationInfo, err = ai.maps.GetLocationInfo(context.Background(), loc.Latitude, loc.Longitude)
		if err != nil {
			log.Printf("获取地理信息失败: %v", err)
			locationInfo = getDefaultLocationInfo(loc)
		}
	} else {
		log.Printf("Google API 已禁用，使用模拟数据")
		locationInfo = getDefaultLocationInfo(loc)
	}

	// 调用OpenAI生成描述
	var desc string
	if ai.config.EnableOpenAI() {
		desc, err = ai.openAI.GenerateLocationDescription(loc.Latitude, loc.Longitude, locationInfo)
		if err != nil {
			log.Printf("OpenAI 调用失败: %v", err)
			desc = getDefaultDescription(locationInfo)
		}
	} else {
		log.Printf("OpenAI 已禁用，使用模拟数据")
		desc = getDefaultDescription(locationInfo)
	}

	// 保存描述
	if err := ai.repo.SaveAIDescription(loc.PanoID, desc, "zh-CN"); err != nil {
		log.Printf("保存描述失败: %v", err)
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
