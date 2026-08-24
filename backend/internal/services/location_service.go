package services

import (
	"context"
	"errors"
	"fmt"
	"math"
	randv2 "math/rand/v2"
	"strings"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/utils"
)

var ErrStreetViewNotFound = errors.New("该坐标附近没有可用街景")

const (
	randomCandidateCount      = 12
	randomSearchRadiusMeters  = 25000
	randomCandidateTimeout    = 4 * time.Second
	randomFallbackGrace       = 300 * time.Millisecond
	randomReservoirMaxWait    = 1500 * time.Millisecond
	randomRecentHistoryLimit  = 100
	randomRecentQueryLimit    = 250
	randomNearbyAvoidanceKm   = 50.0
	randomReservoirQueryLimit = 500
)

type randomCandidateResult struct {
	location models.Location
	penalty  int
	err      error
}

type LocationService struct {
	repo      repositories.Repository
	aiService *AIService
	maps      MapProvider
}

type PlaceResolution struct {
	Query            string  `json:"query"`
	Name             string  `json:"name,omitempty"`
	FormattedAddress string  `json:"formatted_address,omitempty"`
	PlaceID          string  `json:"place_id,omitempty"`
	Latitude         float64 `json:"latitude"`
	Longitude        float64 `json:"longitude"`
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
	return ls.GetRandomLocationWithContext(context.Background(), sessionID, language, countryCodes...)
}

func (ls *LocationService) GetRandomLocationWithContext(ctx context.Context, sessionID string, language string, countryCodes ...string) (models.Location, error) {
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
	return ls.generateRandomLocation(ctx, regions, language, sessionID, countryCode)
}

// generateRandomLocation resolves a fixed-size batch of bounded candidates in
// parallel. Retries remain internal to one request, so they do not multiply
// user-visible latency or leak intermediate failures to the frontend.
func (ls *LocationService) generateRandomLocation(ctx context.Context, regions []models.Region, language string, sessionID string, countryCode string) (models.Location, error) {
	logger := utils.LocationLogger()
	if err := ctx.Err(); err != nil {
		return models.Location{}, fmt.Errorf("生成位置请求已取消: %w", err)
	}

	recent, err := ls.recentRandomVisits(sessionID)
	if err != nil {
		return models.Location{}, fmt.Errorf("读取最近探索记录失败: %w", err)
	}
	var reservoir models.Location
	hasReservoir := false
	// A global verified reservoir is a valid fallback only for unconstrained
	// random Earth exploration. Country and interest requests must preserve
	// their explicit geographic contract.
	if len(regions) == 0 && countryCode == "" {
		reservoir, hasReservoir = ls.verifiedReservoirFallback(recent)
	}

	strategy := utils.ChooseRandomStrategy()
	if len(regions) > 0 {
		strategy = utils.RandomStrategyInterest
	} else if countryCode != "" {
		strategy = utils.RandomStrategyCountry
	}

	candidates, err := utils.GenerateRandomCoordinateCandidates(regions, countryCode, strategy, randomCandidateCount)
	if err != nil {
		return models.Location{}, err
	}

	searchCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make(chan randomCandidateResult, len(candidates))
	geocodeSlots := make(chan struct{}, 4)
	for i, candidate := range candidates {
		go func(attempt int, candidate utils.RandomCoordinateCandidate) {
			candidateCtx, candidateCancel := context.WithTimeout(searchCtx, randomCandidateTimeout)
			defer candidateCancel()
			results <- ls.resolveRandomCandidate(candidateCtx, candidate, attempt, language, recent, geocodeSlots)
		}(i+1, candidate)
	}

	var fallback *models.Location
	fallbackPenalty := 3
	var fallbackTimer *time.Timer
	var fallbackTimerC <-chan time.Time
	var reservoirTimer *time.Timer
	var reservoirTimerC <-chan time.Time
	if hasReservoir {
		reservoirTimer = time.NewTimer(randomReservoirMaxWait)
		reservoirTimerC = reservoirTimer.C
		defer reservoirTimer.Stop()
	}
	var lastErr error
	for completed := 0; completed < len(candidates); completed++ {
		select {
		case <-ctx.Done():
			return models.Location{}, fmt.Errorf("生成位置请求已取消: %w", ctx.Err())
		case <-fallbackTimerC:
			cancel()
			return ls.saveRandomLocation(*fallback, sessionID, language)
		case <-reservoirTimerC:
			cancel()
			logger.Info("random_verified_reservoir_fallback", "Used a previously verified panorama to cap random selection latency", map[string]interface{}{
				"pano_id":    reservoir.PanoID,
				"session_id": sessionID,
			})
			return reservoir, nil
		case result := <-results:
			if result.err != nil {
				lastErr = result.err
				continue
			}
			if result.penalty == 0 {
				cancel()
				if fallbackTimer != nil {
					fallbackTimer.Stop()
				}
				return ls.saveRandomLocation(result.location, sessionID, language)
			}
			if result.penalty < fallbackPenalty {
				locationCopy := result.location
				fallback = &locationCopy
				fallbackPenalty = result.penalty
			}
			if fallbackTimer == nil {
				fallbackTimer = time.NewTimer(randomFallbackGrace)
				fallbackTimerC = fallbackTimer.C
			}
		}
	}
	if fallbackTimer != nil {
		fallbackTimer.Stop()
	}
	if fallback != nil {
		return ls.saveRandomLocation(*fallback, sessionID, language)
	}
	if hasReservoir {
		logger.Info("random_verified_reservoir_fallback", "Used a previously verified panorama after bounded candidates failed", map[string]interface{}{
			"pano_id":    reservoir.PanoID,
			"session_id": sessionID,
		})
		return reservoir, nil
	}
	if lastErr != nil {
		return models.Location{}, fmt.Errorf("无法生成可用位置: %w", lastErr)
	}
	return models.Location{}, fmt.Errorf("无法生成可用位置")
}

func (ls *LocationService) resolveRandomCandidate(ctx context.Context, candidate utils.RandomCoordinateCandidate, attempt int, language string, recent []models.VisitRecord, geocodeSlots chan struct{}) randomCandidateResult {
	hasStreetView, validLat, validLng, panoID := ls.maps.FindRandomStreetView(ctx, candidate.Latitude, candidate.Longitude, randomSearchRadiusMeters)
	if !hasStreetView {
		if err := ctx.Err(); err != nil {
			return randomCandidateResult{err: err}
		}
		return randomCandidateResult{err: ErrStreetViewNotFound}
	}
	snapDistance := utils.CalculateDistance(candidate.Latitude, candidate.Longitude, validLat, validLng)
	if snapDistance > float64(randomSearchRadiusMeters)/1000.0+0.25 {
		return randomCandidateResult{err: fmt.Errorf("街景吸附距离超出限制")}
	}

	select {
	case geocodeSlots <- struct{}{}:
		defer func() { <-geocodeSlots }()
	case <-ctx.Done():
		return randomCandidateResult{err: ctx.Err()}
	}
	locationInfo, err := ls.maps.GetLocationInfo(ctx, validLat, validLng, language)
	if err != nil {
		return randomCandidateResult{err: err}
	}
	actualCountryCode := strings.ToUpper(strings.TrimSpace(locationInfo["country_code"]))
	if candidate.TargetCountryCode != "" && !strings.EqualFold(actualCountryCode, candidate.TargetCountryCode) {
		return randomCandidateResult{err: fmt.Errorf("街景结果不在目标国家内")}
	}
	location := models.Location{
		PanoID:            panoID,
		Latitude:          validLat,
		Longitude:         validLng,
		Country:           locationInfo["country"],
		CountryCode:       actualCountryCode,
		City:              locationInfo["city"],
		FormattedAddress:  locationInfo["formatted_address"],
		SelectionStrategy: candidate.Strategy,
		TargetCountryCode: candidate.TargetCountryCode,
		OriginLatitude:    candidate.Latitude,
		OriginLongitude:   candidate.Longitude,
		SnapDistanceKm:    snapDistance,
		SearchRadiusM:     randomSearchRadiusMeters,
		SelectionAttempt:  attempt,
		CreatedAt:         time.Now(),
		IsMock:            false,
	}
	return randomCandidateResult{location: location, penalty: randomLocationPenalty(location, recent)}
}

func (ls *LocationService) recentRandomVisits(sessionID string) ([]models.VisitRecord, error) {
	if sessionID == "" || ls.repo == nil {
		return nil, nil
	}
	visits, _, _, err := ls.repo.GetVisitHistory(sessionID, randomRecentQueryLimit, 0)
	if err != nil {
		return nil, err
	}
	recent := make([]models.VisitRecord, 0, randomRecentHistoryLimit)
	for _, visit := range visits {
		if visit.Source == models.VisitSourceRandom {
			recent = append(recent, visit)
			if len(recent) == randomRecentHistoryLimit {
				break
			}
		}
	}
	return recent, nil
}

func randomLocationPenalty(location models.Location, recent []models.VisitRecord) int {
	nearby := false
	for _, visit := range recent {
		if visit.PanoID == location.PanoID {
			return 2
		}
		if utils.CalculateDistance(location.Latitude, location.Longitude, visit.Latitude, visit.Longitude) < randomNearbyAvoidanceKm {
			nearby = true
		}
	}
	if nearby {
		return 1
	}
	return 0
}

func (ls *LocationService) verifiedReservoirFallback(recent []models.VisitRecord) (models.Location, bool) {
	if ls.repo == nil {
		return models.Location{}, false
	}
	visits, _, _, err := ls.repo.GetGlobalVisitHistory(randomReservoirQueryLimit, 0, models.VisitSourceRandom)
	if err != nil {
		return models.Location{}, false
	}
	buckets := [3][]models.Location{}
	seen := make(map[string]struct{})
	for _, visit := range visits {
		if _, exists := seen[visit.PanoID]; exists {
			continue
		}
		seen[visit.PanoID] = struct{}{}
		location := models.Location{
			PanoID:            visit.PanoID,
			Latitude:          visit.Latitude,
			Longitude:         visit.Longitude,
			Country:           visit.Country,
			CountryCode:       visit.CountryCode,
			City:              visit.City,
			FormattedAddress:  visit.FormattedAddress,
			SelectionStrategy: "verified_reservoir",
			CreatedAt:         time.Now(),
		}
		penalty := randomLocationPenalty(location, recent)
		if penalty >= 0 && penalty < len(buckets) {
			buckets[penalty] = append(buckets[penalty], location)
		}
	}
	for _, bucket := range buckets {
		if len(bucket) > 0 {
			return bucket[randv2.IntN(len(bucket))], true
		}
	}
	return models.Location{}, false
}

func (ls *LocationService) saveRandomLocation(location models.Location, sessionID, language string) (models.Location, error) {
	if err := ls.repo.SaveLocation(location); err != nil {
		return models.Location{}, fmt.Errorf("保存位置记录失败: %w", err)
	}
	utils.LocationLogger().Info("location_generated", "Successfully generated bounded random location", map[string]interface{}{
		"original_coords":     fmt.Sprintf("(%.6f,%.6f)", location.OriginLatitude, location.OriginLongitude),
		"final_coords":        fmt.Sprintf("(%.6f,%.6f)", location.Latitude, location.Longitude),
		"snap_distance_km":    location.SnapDistanceKm,
		"search_radius_m":     location.SearchRadiusM,
		"strategy":            location.SelectionStrategy,
		"target_country_code": location.TargetCountryCode,
		"actual_country_code": location.CountryCode,
		"attempt":             location.SelectionAttempt,
		"pano_id":             location.PanoID,
		"session_id":          sessionID,
		"language":            language,
	})
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
	return ls.LookupLocationWithContext(context.Background(), lat, lng, language)
}

func (ls *LocationService) LookupLocationWithContext(ctx context.Context, lat, lng float64, language string) (*models.Location, error) {

	// URL lookup 只接受附近街景，不做全局兜底跳转。
	hasStreetView, validLat, validLng, panoId := ls.maps.FindNearbyStreetView(ctx, lat, lng)
	if !hasStreetView {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return nil, ErrStreetViewNotFound
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
	location.CountryCode = strings.ToUpper(strings.TrimSpace(locationInfo["country_code"]))
	location.City = locationInfo["city"]
	location.FormattedAddress = locationInfo["formatted_address"]

	if err := ls.repo.SaveLocation(location); err != nil {
		return nil, fmt.Errorf("保存位置记录失败: %w", err)
	}

	return &location, nil
}

// LookupNearestLocation 根据坐标查找最近的可用街景并创建位置记录。
func (ls *LocationService) LookupNearestLocation(lat, lng float64, language string) (*models.Location, error) {
	return ls.LookupNearestLocationWithContext(context.Background(), lat, lng, language)
}

func (ls *LocationService) LookupNearestLocationWithContext(ctx context.Context, lat, lng float64, language string) (*models.Location, error) {

	hasStreetView, validLat, validLng, panoId := ls.maps.FindNearestStreetView(ctx, lat, lng)
	if !hasStreetView {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return nil, ErrStreetViewNotFound
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
	location.CountryCode = strings.ToUpper(strings.TrimSpace(locationInfo["country_code"]))
	location.City = locationInfo["city"]
	location.FormattedAddress = locationInfo["formatted_address"]

	if err := ls.repo.SaveLocation(location); err != nil {
		return nil, fmt.Errorf("保存位置记录失败: %w", err)
	}

	return &location, nil
}

// SearchLocation resolves a concrete place/landmark query and loads nearby Street View.
func (ls *LocationService) SearchLocation(query, language string) (*models.Location, *PlaceResolution, error) {
	return ls.SearchLocationWithContext(context.Background(), query, language)
}

func (ls *LocationService) SearchLocationWithContext(ctx context.Context, query, language string) (*models.Location, *PlaceResolution, error) {
	trimmedQuery := strings.TrimSpace(query)
	if trimmedQuery == "" {
		return nil, nil, fmt.Errorf("缺少地点关键词")
	}

	candidate, err := ls.maps.SearchPlace(ctx, trimmedQuery, language)
	if err != nil {
		return nil, nil, err
	}
	if candidate == nil || math.IsNaN(candidate.Latitude) || math.IsNaN(candidate.Longitude) {
		return nil, nil, fmt.Errorf("地点解析结果无效")
	}

	hasStreetView, validLat, validLng, panoId := ls.maps.FindNearbyStreetView(ctx, candidate.Latitude, candidate.Longitude)
	if !hasStreetView {
		return nil, &PlaceResolution{
			Query:            trimmedQuery,
			Name:             candidate.Name,
			FormattedAddress: candidate.FormattedAddress,
			PlaceID:          candidate.PlaceID,
			Latitude:         candidate.Latitude,
			Longitude:        candidate.Longitude,
		}, fmt.Errorf("找到了地点，但附近没有可用街景")
	}

	locationInfo, err := ls.maps.GetLocationInfo(ctx, validLat, validLng, language)
	if err != nil {
		return nil, nil, fmt.Errorf("获取位置信息失败: %w", err)
	}

	location := models.Location{
		PanoID:    panoId,
		CreatedAt: time.Now(),
		IsMock:    false,
	}
	location.Latitude = validLat
	location.Longitude = validLng
	location.Country = locationInfo["country"]
	location.CountryCode = strings.ToUpper(strings.TrimSpace(locationInfo["country_code"]))
	location.City = locationInfo["city"]
	location.FormattedAddress = locationInfo["formatted_address"]

	if err := ls.repo.SaveLocation(location); err != nil {
		return nil, nil, fmt.Errorf("保存位置记录失败: %w", err)
	}

	return &location, &PlaceResolution{
		Query:            trimmedQuery,
		Name:             candidate.Name,
		FormattedAddress: candidate.FormattedAddress,
		PlaceID:          candidate.PlaceID,
		Latitude:         candidate.Latitude,
		Longitude:        candidate.Longitude,
	}, nil
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
func (ls *LocationService) GetGlobalVisitHistory(limit, offset int, sources ...string) ([]models.VisitRecord, int64, int64, error) {
	return ls.repo.GetGlobalVisitHistory(limit, offset, sources...)
}

// DeleteExplorationPreference 删除用户的探索偏好
func (ls *LocationService) DeleteExplorationPreference(sessionID string) error {
	return ls.repo.DeleteExplorationPreference(sessionID)
}
