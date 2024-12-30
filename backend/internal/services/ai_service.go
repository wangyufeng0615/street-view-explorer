package services

import (
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
	config config.Config
}

func NewAIService(cfg config.Config, repo repositories.Repository) *AIService {
	return &AIService{
		repo:   repo,
		openAI: openai.NewClient(cfg.OpenAIAPIKey()),
		config: cfg,
	}
}

func (ai *AIService) GetDescriptionForLocation(loc models.Location) (string, error) {
	log.Printf("获取位置描述 (ID: %s, 缓存启用: %v)", loc.LocationID, ai.config.EnableLocationDescCache())

	// 如果启用了缓存，先尝试从缓存获取
	if ai.config.EnableLocationDescCache() {
		desc, err := ai.repo.GetAIDescription(loc.LocationID)
		if err == nil && desc != "" {
			log.Printf("从缓存获取到描述: %s", desc)
			return desc, nil
		}
		log.Printf("缓存中无描述或获取失败: %v", err)
	}

	// 调用OpenAI生成描述
	desc, err := ai.openAI.GenerateLocationDescription(loc.Latitude, loc.Longitude)
	if err != nil {
		log.Printf("OpenAI 调用失败: %v", err)
		// 如果OpenAI调用失败，返回一个默认描述
		desc = fmt.Sprintf("这是位于经纬度(%.4f, %.4f)的一个有趣地点。", loc.Latitude, loc.Longitude)
		log.Printf("使用默认描述: %s", desc)
	}

	// 如果启用了缓存，则缓存结果
	if ai.config.EnableLocationDescCache() {
		if err := ai.repo.SetAIDescription(loc.LocationID, desc); err != nil {
			log.Printf("缓存描述失败: %v", err)
		} else {
			log.Printf("成功缓存描述")
		}
	}

	return desc, nil
}
