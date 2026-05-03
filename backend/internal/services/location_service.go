package services

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/utils"
)

type LocationService struct {
	repo      repositories.Repository
	aiService *AIService
	maps      MapProvider
}

func NewLocationService(repo repositories.Repository, ai *AIService, maps MapProvider) *LocationService {
	return &LocationService{
		repo:      repo,
		aiService: ai,
		maps:      maps,
	}
}

func (ls *LocationService) GetLocation(panoID string) (*models.Location, error) {
	return ls.repo.GetLocationByPanoID(panoID)
}

// GetRandomLocation 获取随机位置，支持用户偏好
// 如果 sessionID 为空，则使用默认的全球随机生成
func (ls *LocationService) GetRandomLocation(sessionID string, language string, countryCodes ...string) (models.Location, error) {
	var regions []models.Region
	countryCode := ""
	if len(countryCodes) > 0 && countryCodes[0] != "" {
		normalizedCountryCode, ok := utils.NormalizeISOAlpha2CountryCode(countryCodes[0])
		if !ok {
			return models.Location{}, fmt.Errorf("无效的国家代码: %s", countryCodes[0])
		}
		countryCode = normalizedCountryCode
	}

	// 如果提供了 sessionID，尝试获取用户的探索偏好。
	// 国家限定是 Geo Game 的显式规则，优先级高于探索偏好。
	if sessionID != "" && countryCode == "" {
		pref, err := ls.repo.GetExplorationPreference(sessionID)
		if err != nil {
			return models.Location{}, fmt.Errorf("获取探索偏好失败: %w", err)
		}

		// 如果有探索偏好，使用用户偏好区域
		if pref != nil {
			regions = pref.Regions

			// 更新最后使用时间
			pref.LastUsedAt = time.Now()
			if err := ls.repo.SaveExplorationPreference(sessionID, *pref); err != nil {
				return models.Location{}, fmt.Errorf("更新探索偏好使用时间失败: %w", err)
			}
		}
	}

	// 生成随机位置（regions 为 nil 时使用默认全球区域）
	return ls.generateRandomLocation(regions, language, sessionID, countryCode)
}

// generateRandomLocation 统一的随机位置生成逻辑
// regions 为 nil 时使用默认大陆区域，否则使用用户偏好区域
// 使用带兜底机制的街景搜索，确保总是能找到可用位置
func (ls *LocationService) generateRandomLocation(regions []models.Region, language string, sessionID string, countryCode string) (models.Location, error) {
	ctx := context.Background()
	logger := utils.LocationLogger()
	attempts := 1
	if countryCode != "" {
		attempts = 8
	}

	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		// 生成随机坐标
		var lat, lng float64
		if countryCode != "" {
			var err error
			lat, lng, err = utils.GenerateRandomCoordinateInCountry(countryCode)
			if err != nil {
				return models.Location{}, err
			}
		} else {
			lat, lng = utils.GenerateRandomCoordinate(regions)
		}

		// 使用带兜底机制的街景搜索，总是能找到可用街景
		hasStreetView, validLat, validLng, panoId := ls.maps.HasStreetView(ctx, lat, lng, regions != nil || countryCode != "")

		// 由于有兜底机制，这里应该总是成功，但保留检查以防万一
		if !hasStreetView {
			lastErr = fmt.Errorf("严重错误：即使使用兜底机制也无法找到街景")
			logger.Error("streetview_fallback_failed", "Critical error: fallback mechanism failed", nil, map[string]interface{}{
				"original_lat": lat,
				"original_lng": lng,
				"session_id":   sessionID,
				"country_code": countryCode,
			})
			if countryCode != "" {
				continue
			}
			return models.Location{}, lastErr
		}

		// 获取位置信息
		locationInfo, err := ls.maps.GetLocationInfo(ctx, validLat, validLng, language)
		if err != nil {
			lastErr = err
			logger.Error("geocoding_failed", "Failed to get location info", err, map[string]interface{}{
				"latitude":     validLat,
				"longitude":    validLng,
				"language":     language,
				"session_id":   sessionID,
				"country_code": countryCode,
			})
			if countryCode != "" {
				continue
			}
			return models.Location{}, fmt.Errorf("获取位置信息失败: %w", err)
		}

		if countryCode != "" && !strings.EqualFold(locationInfo["country_code"], countryCode) {
			lastErr = fmt.Errorf("街景结果不在指定国家内")
			logger.Info("country_filter_mismatch", "Discarded location outside requested country", map[string]interface{}{
				"requested_country_code": countryCode,
				"actual_country_code":    locationInfo["country_code"],
				"original_coords":        fmt.Sprintf("(%.6f,%.6f)", lat, lng),
				"final_coords":           fmt.Sprintf("(%.6f,%.6f)", validLat, validLng),
				"attempt":                attempt,
			})
			continue
		}

		// 创建位置记录
		location := models.Location{
			PanoID:           panoId,
			Latitude:         validLat,
			Longitude:        validLng,
			Country:          locationInfo["country"],
			City:             locationInfo["city"],
			FormattedAddress: locationInfo["formatted_address"],
			CreatedAt:        time.Now(),
			IsMock:           false,
		}

		// 保存位置记录
		if err := ls.repo.SaveLocation(location); err != nil {
			logger.Error("save_location_failed", "Failed to save location record", err, map[string]interface{}{
				"pano_id":      panoId,
				"session_id":   sessionID,
				"country_code": countryCode,
			})
			return models.Location{}, fmt.Errorf("保存位置记录失败: %w", err)
		}

		logger.Info("location_generated", "Successfully generated random location", map[string]interface{}{
			"original_coords": fmt.Sprintf("(%.6f,%.6f)", lat, lng),
			"final_coords":    fmt.Sprintf("(%.6f,%.6f)", location.Latitude, location.Longitude),
			"pano_id":         location.PanoID,
			"country":         location.Country,
			"country_code":    countryCode,
			"address":         location.FormattedAddress,
			"session_id":      sessionID,
			"language":        language,
		})
		return location, nil
	}

	if lastErr != nil {
		return models.Location{}, fmt.Errorf("无法在国家 %s 内生成可用位置: %w", countryCode, lastErr)
	}
	return models.Location{}, fmt.Errorf("无法在国家 %s 内生成可用位置", countryCode)
}

// SetExplorationPreference 设置用户的探索偏好
func (ls *LocationService) SetExplorationPreference(sessionID, interest string) error {
	// 输入验证
	if len(interest) < 2 {
		return fmt.Errorf("探索兴趣太短")
	}
	if len(interest) > 50 {
		return fmt.Errorf("探索兴趣太长")
	}

	// 检查是否包含敏感字符
	if containsSensitiveChars(interest) {
		return fmt.Errorf("探索兴趣包含无效字符")
	}

	// 移除了过于严格的100ms检查，现在由中间件处理速率限制

	// 通过 AI 获取相关区域
	regions, err := ls.aiService.openAI.GenerateRegionsForInterest(interest)
	if err != nil {
		return fmt.Errorf("无法理解该探索兴趣")
	}

	// 验证返回的区域数据
	if err := validateRegions(regions); err != nil {
		return fmt.Errorf("无法理解该探索兴趣")
	}

	// 创建探索偏好
	pref := models.ExplorationPreference{
		Interest:   interest,
		Regions:    regions,
		CreatedAt:  time.Now(),
		LastUsedAt: time.Now(),
	}

	// 保存到数据库
	if err := ls.repo.SaveExplorationPreference(sessionID, pref); err != nil {
		return fmt.Errorf("保存探索偏好失败: %w", err)
	}

	return nil
}

// containsSensitiveChars 检查是否包含敏感字符
func containsSensitiveChars(s string) bool {
	sensitiveChars := []rune{'<', '>', '\\', '/', '{', '}', '[', ']', '`', '$', '#', '@', '!', '|', '='}
	for _, ch := range s {
		for _, sensitive := range sensitiveChars {
			if ch == sensitive {
				return true
			}
		}
	}
	return false
}

// validateRegions 验证区域数据的合法性
func validateRegions(regions []models.Region) error {
	if len(regions) == 0 {
		return fmt.Errorf("区域列表为空")
	}

	if len(regions) > 10 {
		return fmt.Errorf("区域数量超出限制")
	}

	validCount := 0
	for _, region := range regions {
		// 检查坐标范围
		if region.Coordinates.North < -90 || region.Coordinates.North > 90 ||
			region.Coordinates.South < -90 || region.Coordinates.South > 90 {
			continue
		}

		if region.Coordinates.East < -180 || region.Coordinates.East > 180 ||
			region.Coordinates.West < -180 || region.Coordinates.West > 180 {
			continue
		}

		// 确保南北纬度关系正确
		if region.Coordinates.South > region.Coordinates.North {
			continue
		}

		// 检查区域大小
		latDiff := region.Coordinates.North - region.Coordinates.South
		lonDiff := math.Abs(region.Coordinates.East - region.Coordinates.West)

		if latDiff > 89 {
			continue
		}

		if lonDiff > 179 {
			continue
		}

		validCount++
	}

	// 只要有至少一个有效区域就通过验证
	if validCount == 0 {
		return fmt.Errorf("没有有效的区域数据")
	}

	return nil
}

// LookupLocation 根据坐标查找或创建位置
func (ls *LocationService) LookupLocation(lat, lng float64, language string) (*models.Location, error) {
	ctx := context.Background()

	// URL lookup 只接受附近街景，不做全局兜底跳转。
	hasStreetView, validLat, validLng, panoId := ls.maps.FindNearbyStreetView(ctx, lat, lng)
	if !hasStreetView {
		return nil, fmt.Errorf("该坐标附近没有可用街景")
	}

	locationInfo, err := ls.maps.GetLocationInfo(ctx, validLat, validLng, language)
	if err != nil {
		return nil, fmt.Errorf("获取位置信息失败: %w", err)
	}

	location := models.Location{
		PanoID:    panoId,
		CreatedAt: time.Now(),
		IsMock:    false,
	}
	location.Latitude = validLat
	location.Longitude = validLng
	location.Country = locationInfo["country"]
	location.City = locationInfo["city"]
	location.FormattedAddress = locationInfo["formatted_address"]

	if err := ls.repo.SaveLocation(location); err != nil {
		return nil, fmt.Errorf("保存位置记录失败: %w", err)
	}

	return &location, nil
}

// RecordVisit 记录用户访问
func (ls *LocationService) RecordVisit(sessionID string, loc models.Location, source string) error {
	return ls.repo.RecordVisit(sessionID, loc, source)
}

// GetVisitHistory 获取用户的访问历史
func (ls *LocationService) GetVisitHistory(sessionID string, limit, offset int) ([]models.VisitRecord, int64, int64, error) {
	return ls.repo.GetVisitHistory(sessionID, limit, offset)
}

// GetGlobalVisitHistory 获取所有用户共享的访问历史
func (ls *LocationService) GetGlobalVisitHistory(limit, offset int) ([]models.VisitRecord, int64, int64, error) {
	return ls.repo.GetGlobalVisitHistory(limit, offset)
}

// DeleteExplorationPreference 删除用户的探索偏好
func (ls *LocationService) DeleteExplorationPreference(sessionID string) error {
	return ls.repo.DeleteExplorationPreference(sessionID)
}
