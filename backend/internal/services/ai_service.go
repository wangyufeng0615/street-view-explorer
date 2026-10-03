package services

import (
	"context"
	"encoding/base64"
	"errors"
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

type locationInfoResult struct {
	info map[string]string
	err  error
}

const (
	sceneImageTimeout         = 6 * time.Second
	descriptionAddressTimeout = 1500 * time.Millisecond
)

// ErrCanceledBeforeUpstream marks a description the visitor abandoned while
// the scene image and address were still being fetched, before any paid AI
// call started. Its budget can be returned.
var ErrCanceledBeforeUpstream = errors.New("description canceled before the AI request started")

type sceneImageResult struct {
	scene *openai.SceneImage
	err   error
}

func (ai *AIService) generateDescription(ctx context.Context, loc models.Location, language string, view StreetViewView, detailed bool, onDelta func(string) error) (string, []openai.Citation, error) {
	startTime := time.Now()
	logger := utils.AILogger()

	locationInfo, scene, err := ai.prepareDescriptionContext(ctx, loc, language, view)
	if err == nil {
		// 画面已就绪（比如命中缓存）但访客在 AI 请求发出前离开：同样还没花上游的钱
		err = ctx.Err()
	}
	if err != nil {
		if ctx.Err() != nil {
			// 访客已经切走：不是故障，不按错误记日志
			return "", nil, fmt.Errorf("%w: %w", ErrCanceledBeforeUpstream, err)
		}
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
			if errors.Is(ctx.Err(), context.Canceled) {
				// 访客中途切走，上游已经开始计费，额度不退；只记一条普通日志
				logger.Info("ai_generation_canceled", "Visitor left before the AI description finished", map[string]interface{}{
					"pano_id":  loc.PanoID,
					"language": language,
					"detailed": detailed,
					"duration": time.Since(startTime).String(),
				})
				return "", nil, err
			}
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
		// 地址只是补充信息，查不到有已保存地址兜底，所以单独限时
		lookupCtx, cancel := context.WithTimeout(ctx, descriptionAddressTimeout)
		defer cancel()
		info, err := ai.maps.GetLocationInfo(lookupCtx, loc.Latitude, loc.Longitude, language)
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
	if err := ctx.Err(); err != nil {
		// 访客已经切走：这里的失败都是取消带来的，不记 ERROR，由调用方退额度
		return nil, nil, err
	}
	if sceneResult.err != nil {
		return nil, nil, utils.SafeError(utils.ErrorTypeExternal, "获取街景画面失败", sceneResult.err)
	}
	info := cloneLocationInfo(locationResult.info)
	if locationResult.err != nil {
		// Reverse geocoding only enriches the prompt; the panorama already
		// carries its saved address, so a flaky lookup should not cost the
		// visitor the whole narration.
		utils.AILogger().Error("location_info_fallback", "Reverse geocoding failed; using the saved panorama address", locationResult.err, map[string]interface{}{
			"pano_id":  loc.PanoID,
			"language": language,
		})
		info = savedLocationInfo(loc)
	}
	// Preserve the address the visitor actually sees, even for an older saved
	// panorama whose newly geocoded locality has changed.
	info["streetview_address"] = loc.FormattedAddress
	return info, sceneResult.scene, nil
}

func (ai *AIService) GetStreetViewFrame(ctx context.Context, panoID string, view StreetViewView) (*StreetViewFrame, error) {
	return ai.maps.GetStreetViewFrame(ctx, panoID, view)
}

func (ai *AIService) getSceneImageWithContext(parent context.Context, panoID string, view StreetViewView) (*openai.SceneImage, error) {
	if !ai.config.EnableGoogleAPI() {
		return nil, nil
	}

	// 静态街景图通常 1 秒内返回；卡住时尽早报错，不让访客干等十几秒
	ctx, cancel := context.WithTimeout(parent, sceneImageTimeout)
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
func savedLocationInfo(loc models.Location) map[string]string {
	info := map[string]string{}
	for key, value := range map[string]string{
		"formatted_address": loc.FormattedAddress,
		"country":           loc.Country,
		"country_code":      loc.CountryCode,
		"city":              loc.City,
	} {
		if strings.TrimSpace(value) != "" {
			info[key] = value
		}
	}
	return info
}

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
