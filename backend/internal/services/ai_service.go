package services

import (
	"context"
	"encoding/base64"
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
	return ai.generateDescription(context.Background(), loc, language, view, false, nil)
}

// GetDetailedDescriptionForLocation 获取位置的详细AI描述
func (ai *AIService) GetDetailedDescriptionForLocation(loc models.Location, language string, view StreetViewView) (string, []openai.Citation, error) {
	return ai.generateDescription(context.Background(), loc, language, view, true, nil)
}

func (ai *AIService) StreamDescriptionForLocation(ctx context.Context, loc models.Location, language string, view StreetViewView, onDelta func(string) error) (string, []openai.Citation, error) {
	return ai.generateDescription(ctx, loc, language, view, false, onDelta)
}

func (ai *AIService) StreamDetailedDescriptionForLocation(ctx context.Context, loc models.Location, language string, view StreetViewView, onDelta func(string) error) (string, []openai.Citation, error) {
	return ai.generateDescription(ctx, loc, language, view, true, onDelta)
}

type locationInfoResult struct {
	info map[string]string
	err  error
}

type sceneImageResult struct {
	scene *openai.SceneImage
	err   error
}

func (ai *AIService) generateDescription(ctx context.Context, loc models.Location, language string, view StreetViewView, detailed bool, onDelta func(string) error) (string, []openai.Citation, error) {
	startTime := time.Now()
	logger := utils.AILogger()

	locationInfo, scene, err := ai.prepareDescriptionContext(ctx, loc, language, view)
	if err != nil {
		logger.Error("description_context_failed", "Failed to prepare AI description context", err, map[string]interface{}{
			"pano_id":  loc.PanoID,
			"language": language,
			"detailed": detailed,
		})
		return "", nil, err
	}
	logger.Info("description_context_ready", "Prepared Atlas location and scene context", map[string]interface{}{
		"pano_id":  loc.PanoID,
		"language": language,
		"detailed": detailed,
		"duration": time.Since(startTime).String(),
	})

	var desc string
	var citations []openai.Citation
	if ai.config.EnableOpenAI() {
		if detailed {
			desc, citations, err = ai.openAI.StreamDetailedLocationDescription(ctx, loc.Latitude, loc.Longitude, locationInfo, scene, language, onDelta)
		} else {
			desc, citations, err = ai.openAI.StreamLocationDescription(ctx, loc.Latitude, loc.Longitude, locationInfo, scene, language, onDelta)
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

func (ai *AIService) prepareDescriptionContext(ctx context.Context, loc models.Location, language string, view StreetViewView) (map[string]string, *openai.SceneImage, error) {
	if !ai.config.EnableGoogleAPI() {
		return getDefaultLocationInfo(loc), nil, nil
	}

	locationCh := make(chan locationInfoResult, 1)
	sceneCh := make(chan sceneImageResult, 1)

	go func() {
		info, err := ai.maps.GetLocationInfo(ctx, loc.Latitude, loc.Longitude, language)
		locationCh <- locationInfoResult{info: info, err: err}
	}()

	if ai.config.EnableOpenAI() {
		scenePanoID := strings.TrimSpace(view.PanoID)
		if scenePanoID == "" {
			scenePanoID = loc.PanoID
		}
		go func() {
			scene, err := ai.getSceneImageWithContext(ctx, scenePanoID, view)
			sceneCh <- sceneImageResult{scene: scene, err: err}
		}()
	} else {
		sceneCh <- sceneImageResult{}
	}

	locationResult := <-locationCh
	sceneResult := <-sceneCh
	if locationResult.err != nil {
		return nil, nil, utils.SafeError(utils.ErrorTypeExternal, "获取位置信息失败", locationResult.err)
	}
	if sceneResult.err != nil {
		return nil, nil, utils.SafeError(utils.ErrorTypeExternal, "获取街景画面失败", sceneResult.err)
	}
	return locationResult.info, sceneResult.scene, nil
}

func (ai *AIService) GetStreetViewFrame(ctx context.Context, panoID string, view StreetViewView) (*StreetViewFrame, error) {
	return ai.maps.GetStreetViewFrame(ctx, panoID, view)
}

func (ai *AIService) getSceneImageWithContext(parent context.Context, panoID string, view StreetViewView) (*openai.SceneImage, error) {
	if !ai.config.EnableGoogleAPI() {
		return nil, nil
	}

	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()

	frame, err := ai.maps.GetStreetViewFrame(ctx, panoID, view)
	if err != nil {
		return nil, err
	}

	return &openai.SceneImage{
		Base64:      base64.StdEncoding.EncodeToString(frame.Data),
		ContentType: frame.ContentType,
		Heading:     frame.View.Heading,
		Pitch:       frame.View.Pitch,
		FOV:         frame.View.FOV,
	}, nil
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
