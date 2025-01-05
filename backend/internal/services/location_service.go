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

func (ls *LocationService) GetRandomLocation() (models.Location, error) {
	ctx := context.Background()
	// 生成随机有效坐标
	lat, lng, err := ls.maps.GenerateValidLocation(ctx)
	if err != nil {
		return models.Location{}, fmt.Errorf("生成有效坐标失败: %w", err)
	}

	// 获取位置信息
	locationInfo, err := ls.maps.GetLocationInfo(ctx, lat, lng)
	if err != nil {
		return models.Location{}, fmt.Errorf("获取位置信息失败: %w", err)
	}

	// 创建新的位置记录
	loc := models.Location{
		OriginalLatitude:  lat,
		OriginalLongitude: lng,
		Latitude:          lat,
		Longitude:         lng,
		FormattedAddress:  locationInfo["formatted_address"],
		CreatedAt:         time.Now(),
		IsMock:            false,
	}

	// 保存位置信息
	if err := ls.repo.SaveLocation(loc); err != nil {
		return models.Location{}, fmt.Errorf("保存位置信息失败: %w", err)
	}

	return loc, nil
}

func (ls *LocationService) LikeLocation(panoID string) (int, error) {
	return ls.repo.IncrementLike(panoID)
}

func (ls *LocationService) GetLeaderboard(page, pageSize int) ([]models.Location, error) {
	return ls.repo.GetLeaderboard(page, pageSize)
}

// 按国家获取位置列表
func (ls *LocationService) GetLocationsByCountry(country string) ([]models.Location, error) {
	return ls.repo.GetLocationsByCountry(country)
}

// 按城市获取位置列表
func (ls *LocationService) GetLocationsByCity(city string) ([]models.Location, error) {
	return ls.repo.GetLocationsByCity(city)
}

// GetRandomLocationWithPreference 根据用户的探索偏好获取随机位置
func (ls *LocationService) GetRandomLocationWithPreference(sessionID string) (models.Location, error) {
	ctx := context.Background()

	// 获取用户的探索偏好
	pref, err := ls.repo.GetExplorationPreference(sessionID)
	if err != nil {
		return models.Location{}, fmt.Errorf("获取探索偏好失败: %w", err)
	}

	// 如果没有探索偏好，使用默认的随机生成
	if pref == nil {
		return ls.GetRandomLocation()
	}

	// 从偏好区域生成随机坐标
	lat, lng := utils.GenerateRandomCoordinateFromRegions(pref.Regions)

	// 验证坐标是否有街景
	hasStreetView, validLat, validLng := ls.maps.HasStreetView(ctx, lat, lng, true)
	if !hasStreetView {
		// 如果没有街景，递归重试
		return ls.GetRandomLocationWithPreference(sessionID)
	}

	// 获取位置信息
	locationInfo, err := ls.maps.GetLocationInfo(ctx, validLat, validLng)
	if err != nil {
		return models.Location{}, fmt.Errorf("获取位置信息失败: %w", err)
	}

	// 更新最后使用时间
	pref.LastUsedAt = time.Now()
	if err := ls.repo.SaveExplorationPreference(sessionID, *pref); err != nil {
		log.Printf("更新探索偏好使用时间失败: %v", err)
	}

	// 创建位置记录
	location := models.Location{
		PanoID:    locationInfo["pano_id"],
		Latitude:  validLat,
		Longitude: validLng,
		Country:   locationInfo["country"],
		City:      locationInfo["city"],
		CreatedAt: time.Now(),
	}

	// 保存位置记录
	if err := ls.repo.SaveLocation(location); err != nil {
		return models.Location{}, fmt.Errorf("保存位置记录失败: %w", err)
	}

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
	if existingPref, err := ls.repo.GetExplorationPreference(sessionID); err == nil && existingPref != nil {
		// 如果距离上次更新时间不足 10 秒，拒绝请求
		if time.Since(existingPref.LastUsedAt) < 10*time.Second {
			return fmt.Errorf("请求过于频繁，请稍后再试")
		}
	}

	// 通过 OpenAI 获取相关区域
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
	log.Printf("开始验证区域数据，共 %d 个区域", len(regions))

	if len(regions) == 0 {
		log.Printf("验证失败：区域列表为空")
		return fmt.Errorf("区域列表为空")
	}

	if len(regions) > 10 {
		log.Printf("验证失败：区域数量超出限制（%d > 10）", len(regions))
		return fmt.Errorf("区域数量超出限制")
	}

	validCount := 0
	for i, region := range regions {
		log.Printf("验证区域 %d:\n"+
			"  描述: %s\n"+
			"  坐标: 北纬=%.3f, 南纬=%.3f, 东经=%.3f, 西经=%.3f",
			i+1,
			region.RegionInfo,
			region.Coordinates.North,
			region.Coordinates.South,
			region.Coordinates.East,
			region.Coordinates.West,
		)

		// 检查坐标范围
		if region.Coordinates.North < -90 || region.Coordinates.North > 90 ||
			region.Coordinates.South < -90 || region.Coordinates.South > 90 {
			log.Printf("区域 %d 验证失败：纬度超出范围", i+1)
			continue
		}

		if region.Coordinates.East < -180 || region.Coordinates.East > 180 ||
			region.Coordinates.West < -180 || region.Coordinates.West > 180 {
			log.Printf("区域 %d 验证失败：经度超出范围", i+1)
			continue
		}

		// 确保南北纬度关系正确
		if region.Coordinates.South > region.Coordinates.North {
			log.Printf("区域 %d 验证失败：南北纬度关系错误", i+1)
			continue
		}

		// 检查区域大小
		latDiff := region.Coordinates.North - region.Coordinates.South
		lonDiff := math.Abs(region.Coordinates.East - region.Coordinates.West)

		if latDiff > 89 {
			log.Printf("区域 %d 验证失败：纬度范围过大 (%.3f)", i+1, latDiff)
			continue
		}

		if lonDiff > 179 {
			log.Printf("区域 %d 验证失败：经度范围过大 (%.3f)", i+1, lonDiff)
			continue
		}

		// 检查区域描述
		if len(region.RegionInfo) == 0 {
			log.Printf("区域 %d 验证失败：缺少描述信息", i+1)
			continue
		}

		if len(region.RegionInfo) > 500 { // 放宽描述长度限制
			log.Printf("区域 %d 验证失败：描述过长 (%d 字符)", i+1, len(region.RegionInfo))
			continue
		}

		log.Printf("区域 %d 验证通过", i+1)
		validCount++
	}

	// 只要有至少一个有效区域就通过验证
	if validCount == 0 {
		log.Printf("验证失败：没有任何有效区域")
		return fmt.Errorf("没有有效的区域数据")
	}

	log.Printf("区域验证完成：共 %d 个区域，%d 个有效", len(regions), validCount)
	return nil
}

// DeleteExplorationPreference 删除用户的探索偏好
func (ls *LocationService) DeleteExplorationPreference(sessionID string) error {
	return ls.repo.DeleteExplorationPreference(sessionID)
}
