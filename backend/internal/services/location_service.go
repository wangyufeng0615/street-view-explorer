package services

import (
	"context"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/utils"
)

type LocationService struct {
	repo      repositories.Repository
	aiService *AIService
	maps      *MapsService
}

func NewLocationService(repo repositories.Repository, ai *AIService, maps *MapsService) *LocationService {
	return &LocationService{
		repo:      repo,
		aiService: ai,
		maps:      maps,
	}
}

func (ls *LocationService) GetLocation(panoID string) (models.Location, error) {
	return ls.repo.GetLocationByPanoID(panoID)
}

// GetRandomLocation 获取随机位置，支持用户偏好
// 如果 sessionID 为空，则使用默认的全球随机生成
func (ls *LocationService) GetRandomLocation(sessionID string, language string) (models.Location, error) {
	var regions []models.Region

	// 如果提供了 sessionID，尝试获取用户的探索偏好
	if sessionID != "" {
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
	return ls.generateRandomLocation(regions, language)
}

// generateRandomLocation 统一的随机位置生成逻辑
// regions 为 nil 时使用默认大陆区域，否则使用用户偏好区域
// 使用带兜底机制的街景搜索，确保总是能找到可用位置
func (ls *LocationService) generateRandomLocation(regions []models.Region, language string) (models.Location, error) {
	ctx := context.Background()

	// 生成随机坐标
	lat, lng := utils.GenerateRandomCoordinate(regions)
	log.Printf("[COORD_GENERATED] action=random_coordinate coords=(%.6f,%.6f) has_preference=%t", lat, lng, regions != nil)

	// 使用带兜底机制的街景搜索，总是能找到可用街景
	hasStreetView, validLat, validLng, panoId := ls.maps.HasStreetView(ctx, lat, lng, regions != nil)
	
	// 由于有兜底机制，这里应该总是成功，但保留检查以防万一
	if !hasStreetView {
		log.Printf("[STREETVIEW_CRITICAL_ERROR] action=fallback_failed coords=(%.6f,%.6f)", lat, lng)
		return models.Location{}, fmt.Errorf("严重错误：即使使用兜底机制也无法找到街景")
	}

	// 获取位置信息
	locationInfo, err := ls.maps.GetLocationInfo(ctx, validLat, validLng, language)
	if err != nil {
		log.Printf("[GEOCODING_ERROR] action=get_location_info coords=(%.6f,%.6f) error=%v", validLat, validLng, err)
		return models.Location{}, fmt.Errorf("获取位置信息失败: %w", err)
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
		log.Printf("[STORAGE_ERROR] action=save_location pano_id=%s error=%v", panoId, err)
		return models.Location{}, fmt.Errorf("保存位置记录失败: %w", err)
	}

	log.Printf("[LOCATION_SUCCESS] action=generated coords=(%.6f,%.6f) address=%s country=%s pano_id=%s", 
		location.Latitude, location.Longitude, location.FormattedAddress, location.Country, location.PanoID)
	return location, nil
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

	// 获取用户当前的偏好设置，检查更新频率
	existingPref, err := ls.repo.GetExplorationPreference(sessionID)
	if err == nil && existingPref != nil {
		// 只有在已存在偏好设置的情况下才检查更新频率
		if time.Since(existingPref.LastUsedAt) < 100*time.Millisecond {
			return fmt.Errorf("请求过于频繁，请稍后再试")
		}
	}

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

	// 保存到 Redis
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

// DeleteExplorationPreference 删除用户的探索偏好
func (ls *LocationService) DeleteExplorationPreference(sessionID string) error {
	return ls.repo.DeleteExplorationPreference(sessionID)
}
