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
	maps   MapProvider
	config config.Config
}

func NewAIService(cfg config.Config, repo repositories.Repository, maps MapProvider, aiClient openai.Client) *AIService {
	return &AIService{
		repo:   repo,
		openAI: aiClient,
		maps:   maps,
		config: cfg,
	}
}

func (ai *AIService) GetDescriptionForLocation(loc models.Location, language string, view StreetViewView) (string, []openai.Citation, error) {
	return ai.GetDescriptionForLocationContext(context.Background(), loc, language, view)
}

func (ai *AIService) GetDescriptionForLocationContext(ctx context.Context, loc models.Location, language string, view StreetViewView) (string, []openai.Citation, error) {
	return ai.generateDescription(ctx, loc, language, view, false, nil)
}

// GetDetailedDescriptionForLocation 获取位置的详细AI描述
func (ai *AIService) GetDetailedDescriptionForLocation(loc models.Location, language string, view StreetViewView) (string, []openai.Citation, error) {
	return ai.GetDetailedDescriptionForLocationContext(context.Background(), loc, language, view)
}

func (ai *AIService) GetDetailedDescriptionForLocationContext(ctx context.Context, loc models.Location, language string, view StreetViewView) (string, []openai.Citation, error) {
	return ai.generateDescription(ctx, loc, language, view, true, nil)
}

func (ai *AIService) StreamDescriptionForLocation(ctx context.Context, loc models.Location, language string, view StreetViewView, onDelta func(string) error) (string, []openai.Citation, error) {
	return ai.generateDescription(ctx, loc, language, view, false, onDelta)
}

func (ai *AIService) StreamDetailedDescriptionForLocation(ctx context.Context, loc models.Location, language string, view StreetViewView, onDelta func(string) error) (string, []openai.Citation, error) {
	return ai.generateDescription(ctx, loc, language, view, true, onDelta)
}

func (ai *AIService) generateDescription(ctx context.Context, loc models.Location, language string, _ StreetViewView, detailed bool, onDelta func(string) error) (string, []openai.Citation, error) {
	startTime := time.Now()
	logger := utils.AILogger()

	locationInfo, err := ai.prepareDescriptionContext(ctx, loc, language)
	if err != nil {
		logger.Error("description_context_failed", "Failed to prepare AI description context", err, map[string]interface{}{
			"pano_id":  loc.PanoID,
			"language": language,
			"detailed": detailed,
		})
		return "", nil, err
	}
	logger.Info("description_context_ready", "Prepared Atlas text-only location context", map[string]interface{}{
		"pano_id":  loc.PanoID,
		"language": language,
		"detailed": detailed,
		"duration": time.Since(startTime).String(),
	})

	var desc string
	var citations []openai.Citation
	if ai.config.EnableOpenAI() {
		if detailed {
			desc, citations, err = ai.openAI.StreamDetailedLocationDescription(ctx, loc.Latitude, loc.Longitude, locationInfo, language, onDelta)
		} else {
			desc, citations, err = ai.openAI.StreamLocationDescription(ctx, loc.Latitude, loc.Longitude, locationInfo, language, onDelta)
		}
		if err != nil {
			logger.Error("ai_generation_failed", "Failed to generate AI description", err, map[string]interface{}{
				"pano_id":  loc.PanoID,
				"language": language,
				"detailed": detailed,
				"duration": time.Since(startTime).String(),
			})
			message := "AI 描述生成失败"
			if detailed {
				message = "AI 详细描述生成失败"
			}
			return "", nil, utils.SafeError(utils.ErrorTypeExternal, message, err)
		}
	} else if detailed {
		desc = getDefaultDetailedDescription(locationInfo)
	} else {
		desc = getDefaultDescription(locationInfo)
	}

	if desc == "" || strings.TrimSpace(desc) == "" {
		logger.Error("empty_description", "Generated empty AI description", nil, map[string]interface{}{
			"pano_id":     loc.PanoID,
			"language":    language,
			"detailed":    detailed,
			"desc_length": len(desc),
		})
		if detailed {
			return "", nil, fmt.Errorf("生成的AI详细描述为空或无效")
		}
		return "", nil, fmt.Errorf("生成的AI描述为空或无效")
	}

	return desc, citations, nil
}

func (ai *AIService) prepareDescriptionContext(ctx context.Context, loc models.Location, language string) (map[string]string, error) {
	if !ai.config.EnableGoogleAPI() {
		return getDefaultLocationInfo(loc), nil
	}

	info, err := ai.maps.GetLocationInfo(ctx, loc.Latitude, loc.Longitude, language)
	if err != nil {
		return nil, utils.SafeError(utils.ErrorTypeExternal, "获取位置信息失败", err)
	}
	return info, nil
}

func (ai *AIService) GetStreetViewFrame(ctx context.Context, panoID string, view StreetViewView) (*StreetViewFrame, error) {
	return ai.maps.GetStreetViewFrame(ctx, panoID, view)
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
