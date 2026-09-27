package utils

import (
	"fmt"
	"math"
	"sync"
	"testing"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/paulmach/orb"
)

var (
	geoTestSetupOnce sync.Once
	geoTestSetupErr  error
)

func requireGeoTestData(tb testing.TB) {
	tb.Helper()

	geoTestSetupOnce.Do(func() {
		if err := EnsureMapDataReady(); err != nil {
			geoTestSetupErr = fmt.Errorf("确保地图数据就绪失败: %w", err)
			return
		}
		if err := InitializeGeoData(); err != nil {
			geoTestSetupErr = fmt.Errorf("初始化地理数据失败: %w", err)
		}
	})

	if geoTestSetupErr != nil {
		tb.Fatal(geoTestSetupErr)
	}
}

func coordinateInAnyPolygon(lat, lng float64, regions []Region) bool {
	for _, region := range regions {
		for _, polygon := range region.Polygons {
			if pointInPolygon(lat, lng, polygon) {
				return true
			}
		}
	}
	return false
}

// TestGetLandMassRegions 测试获取陆地区域
func TestGetLandMassRegions(t *testing.T) {
	requireGeoTestData(t)

	// 获取陆地区域
	regions, err := getLandMassRegions()
	if err != nil {
		t.Fatalf("获取陆地区域失败: %v", err)
	}

	// 验证基本属性
	if len(regions) == 0 {
		t.Fatal("应该至少有一个陆地区域")
	}

	t.Logf("从Natural Earth高精度数据集获取到 %d 个陆地区域", len(regions))

	// 验证每个区域都是有效的
	for i, region := range regions {
		if !isValidBounds(region) {
			t.Errorf("区域 %d 边界无效: %+v", i, region)
		}
	}

	// 统计区域分布
	var (
		minArea, maxArea     = math.MaxFloat64, 0.0
		minWidth, maxWidth   = math.MaxFloat64, 0.0
		minHeight, maxHeight = math.MaxFloat64, 0.0
		totalArea            = 0.0
	)

	for _, region := range regions {
		area := getRegionArea(region)
		width := getRegionWidth(region)
		height := getRegionHeight(region)

		totalArea += area

		if area < minArea {
			minArea = area
		}
		if area > maxArea {
			maxArea = area
		}
		if width < minWidth {
			minWidth = width
		}
		if width > maxWidth {
			maxWidth = width
		}
		if height < minHeight {
			minHeight = height
		}
		if height > maxHeight {
			maxHeight = height
		}
	}

	t.Logf("区域统计:")
	t.Logf("  总区域数: %d", len(regions))
	t.Logf("  总面积: %.2f 度²", totalArea)
	t.Logf("  平均面积: %.2f 度²", totalArea/float64(len(regions)))
	t.Logf("  面积范围: %.6f - %.2f 度²", minArea, maxArea)
	t.Logf("  宽度范围: %.6f - %.2f 度", minWidth, maxWidth)
	t.Logf("  高度范围: %.6f - %.2f 度", minHeight, maxHeight)
}

func TestRandomStrategyMix(t *testing.T) {
	const samples = 20000
	counts := map[string]int{}
	for i := 0; i < samples; i++ {
		counts[ChooseRandomStrategy()]++
	}
	assertShare := func(strategy string, low, high float64) {
		t.Helper()
		share := float64(counts[strategy]) / samples
		if share < low || share > high {
			t.Fatalf("%s share = %.3f, want %.2f..%.2f", strategy, share, low, high)
		}
	}
	assertShare(RandomStrategyBroad, 0.57, 0.63)
	assertShare(RandomStrategyFair, 0.27, 0.33)
	assertShare(RandomStrategyFrontier, 0.08, 0.12)
}

func TestRandomCoordinateCandidateCarriesTargetCountry(t *testing.T) {
	requireGeoTestData(t)
	for i := 0; i < 100; i++ {
		candidate, err := GenerateRandomCoordinateCandidate(nil, "", RandomStrategyFair)
		if err != nil {
			t.Fatalf("GenerateRandomCoordinateCandidate() error = %v", err)
		}
		if candidate.TargetCountryCode == "" {
			t.Fatal("candidate missing target ISO2 country")
		}
		regions, err := countryRegionsByISOAlpha2(candidate.TargetCountryCode)
		if err != nil {
			t.Fatalf("target country %q not resolvable: %v", candidate.TargetCountryCode, err)
		}
		if !coordinateInAnyPolygon(candidate.Latitude, candidate.Longitude, regions) {
			t.Fatalf("candidate (%.6f, %.6f) outside target %s", candidate.Latitude, candidate.Longitude, candidate.TargetCountryCode)
		}
	}
}

func TestGlobalCandidateBatchUsesDistinctCountries(t *testing.T) {
	requireGeoTestData(t)
	for _, strategy := range []string{RandomStrategyBroad, RandomStrategyFair, RandomStrategyFrontier} {
		t.Run(strategy, func(t *testing.T) {
			candidates, err := GenerateRandomCoordinateCandidates(nil, "", strategy, 12)
			if err != nil {
				t.Fatalf("GenerateRandomCoordinateCandidates() error = %v", err)
			}
			if len(candidates) != 12 {
				t.Fatalf("candidate count = %d, want 12", len(candidates))
			}

			seen := make(map[string]struct{}, len(candidates))
			for _, candidate := range candidates {
				if _, exists := seen[candidate.TargetCountryCode]; exists {
					t.Fatalf("country %s repeated within one candidate batch", candidate.TargetCountryCode)
				}
				seen[candidate.TargetCountryCode] = struct{}{}
				regions, regionsErr := countryRegionsByISOAlpha2(candidate.TargetCountryCode)
				if regionsErr != nil {
					t.Fatalf("target country %q not resolvable: %v", candidate.TargetCountryCode, regionsErr)
				}
				if !coordinateInAnyPolygon(candidate.Latitude, candidate.Longitude, regions) {
					t.Fatalf("candidate (%.6f, %.6f) outside target %s", candidate.Latitude, candidate.Longitude, candidate.TargetCountryCode)
				}
			}
		})
	}
}

func TestGlobalCandidateCountriesExcludeUnownedMinorIslandOverlay(t *testing.T) {
	requireGeoTestData(t)
	regions, err := getLandMassRegions()
	if err != nil {
		t.Fatal(err)
	}
	grouped := groupRegionsByISO2(regions)
	if len(grouped) < 200 {
		t.Fatalf("country groups = %d, expected broad ISO2 coverage", len(grouped))
	}
	for code, countryRegions := range grouped {
		if normalized, valid := NormalizeISOAlpha2CountryCode(code); !valid || normalized != code {
			t.Fatalf("invalid pseudo-country included: %q", code)
		}
		for _, region := range countryRegions {
			if region.IsMinorIsland {
				t.Fatalf("minor-island overlay leaked into country %s", code)
			}
		}
	}
	if len(grouped["TW"]) == 0 {
		t.Fatal("expected Taiwan to use ISO_A2_EH fallback TW")
	}
}

func TestGenerateRandomCoordinateInCountry(t *testing.T) {
	requireGeoTestData(t)

	code, ok := NormalizeISOAlpha2CountryCode("jp")
	if !ok || code != "JP" {
		t.Fatalf("expected jp to normalize to JP, got %q", code)
	}

	regions, err := countryRegionsByISOAlpha2("JP")
	if err != nil {
		t.Fatalf("expected Japan regions: %v", err)
	}
	if len(regions) == 0 {
		t.Fatal("expected at least one Japan region")
	}

	for i := 0; i < 20; i++ {
		lat, lng, err := GenerateRandomCoordinateInCountry("JP")
		if err != nil {
			t.Fatalf("country coordinate generation failed: %v", err)
		}
		if !coordinateInAnyPolygon(lat, lng, regions) {
			t.Fatalf("coordinate (%.6f, %.6f) is outside Japan polygons", lat, lng)
		}
	}

	if _, _, err := GenerateRandomCoordinateInCountry("XX"); err == nil {
		t.Fatal("expected unsupported country code to fail")
	}
	if _, ok := NormalizeISOAlpha2CountryCode("USA"); ok {
		t.Fatal("expected alpha-3 country code to be rejected")
	}
}

// TestPointInPolygon 测试点在多边形内判断算法
func TestPointInPolygon(t *testing.T) {
	// 创建一个简单的正方形多边形用于测试
	square := orb.Polygon{
		orb.Ring{
			orb.Point{0, 0},   // 左下
			orb.Point{10, 0},  // 右下
			orb.Point{10, 10}, // 右上
			orb.Point{0, 10},  // 左上
			orb.Point{0, 0},   // 闭合
		},
	}

	// 测试用例
	testCases := []struct {
		lat, lng float64
		expected bool
		desc     string
	}{
		{5, 5, true, "中心点"},
		{0.1, 0.1, true, "接近左下角的内部点"},
		{9.9, 9.9, true, "接近右上角的内部点"},
		{-1, 5, false, "左侧外部"},
		{11, 5, false, "右侧外部"},
		{5, -1, false, "下方外部"},
		{5, 11, false, "上方外部"},
		{1, 1, true, "内部点"},
		{9, 9, true, "内部点"},
		{2.5, 2.5, true, "内部点"},
	}

	for _, tc := range testCases {
		result := pointInPolygon(tc.lat, tc.lng, square)
		if result != tc.expected {
			t.Errorf("点 (%.1f, %.1f) %s: 期望 %v, 实际 %v",
				tc.lat, tc.lng, tc.desc, tc.expected, result)
		}
	}

	t.Logf("✓ 点在多边形内判断算法测试通过")
}

// TestCoordinateGenerationWithoutFallback 测试修复后的坐标生成，验证是否避免了海岸线问题
func TestCoordinateGenerationWithoutFallback(t *testing.T) {
	requireGeoTestData(t)

	regions, err := getLandMassRegions()
	if err != nil {
		t.Fatalf("获取陆地区域失败: %v", err)
	}

	t.Logf("测试修复后的坐标生成（无边界框回退）...")

	// 生成一批坐标进行验证
	const numTests = 200
	inPolygonCount := 0
	totalAttempts := 0

	for i := 0; i < numTests; i++ {
		lat, lng := GenerateRandomCoordinate(nil)
		totalAttempts++

		found := coordinateInAnyPolygon(lat, lng, regions)
		if found {
			inPolygonCount++
		}

		if !found {
			t.Logf("警告：坐标 (%.6f, %.6f) 不在任何陆地多边形内", lat, lng)
		}
	}

	polygonRate := float64(inPolygonCount) / float64(totalAttempts) * 100
	t.Logf("坐标生成结果统计:")
	t.Logf("  总生成数: %d", totalAttempts)
	t.Logf("  在多边形内: %d", inPolygonCount)
	t.Logf("  多边形命中率: %.2f%%", polygonRate)

	// 修复后应该有很高的多边形命中率（期望 > 95%）
	if polygonRate < 95.0 {
		t.Errorf("多边形命中率太低: %.2f%%, 期望 > 95%%", polygonRate)
	} else {
		t.Logf("✓ 修复后的坐标生成工作正常，避免了海岸线问题")
	}
}

// TestPointInPolygonWithHoles 测试有洞的多边形
func TestPointInPolygonWithHoles(t *testing.T) {
	// 创建一个带洞的多边形：外环是大正方形，内环是小正方形（洞）
	polygonWithHole := orb.Polygon{
		// 外环：大正方形 (0,0) 到 (10,10)
		orb.Ring{
			orb.Point{0, 0},   // 左下
			orb.Point{10, 0},  // 右下
			orb.Point{10, 10}, // 右上
			orb.Point{0, 10},  // 左上
			orb.Point{0, 0},   // 闭合
		},
		// 内环（洞）：小正方形 (4,4) 到 (6,6)
		orb.Ring{
			orb.Point{4, 4}, // 左下
			orb.Point{6, 4}, // 右下
			orb.Point{6, 6}, // 右上
			orb.Point{4, 6}, // 左上
			orb.Point{4, 4}, // 闭合
		},
	}

	// 测试用例
	testCases := []struct {
		lat, lng float64
		expected bool
		desc     string
	}{
		{2, 2, true, "外环内部，洞外部"},
		{8, 8, true, "外环内部，洞外部"},
		{5, 5, false, "洞内部"},
		{1, 1, true, "外环内部，洞外部"},
		{9, 9, true, "外环内部，洞外部"},
		{4.5, 4.5, false, "洞内部"},
		{5.5, 5.5, false, "洞内部"},
		{-1, 5, false, "外环外部"},
		{11, 5, false, "外环外部"},
		{5, -1, false, "外环外部"},
		{5, 11, false, "外环外部"},
	}

	for _, tc := range testCases {
		result := pointInPolygon(tc.lat, tc.lng, polygonWithHole)
		if result != tc.expected {
			t.Errorf("点 (%.1f, %.1f) %s: 期望 %v, 实际 %v",
				tc.lat, tc.lng, tc.desc, tc.expected, result)
		}
	}

	t.Logf("✓ 带洞多边形的点判断算法测试通过")
}

// TestUserPreferenceRegionGeneration 测试用户偏好区域的坐标生成
func TestUserPreferenceRegionGeneration(t *testing.T) {
	// 创建模拟的用户偏好区域（模拟巴黎附近）
	userRegions := []models.Region{
		{
			Coordinates: struct {
				North float64 `json:"north"`
				South float64 `json:"south"`
				East  float64 `json:"east"`
				West  float64 `json:"west"`
			}{
				North: 49.0, // 北纬49度
				South: 48.5, // 南纬48.5度
				East:  2.5,  // 东经2.5度
				West:  2.0,  // 西经2度
			},
			RegionInfo: "巴黎附近区域",
		},
	}

	t.Logf("测试用户偏好区域坐标生成...")
	t.Logf("区域范围: 北纬%.1f°-南纬%.1f°, 东经%.1f°-西经%.1f°",
		userRegions[0].Coordinates.North,
		userRegions[0].Coordinates.South,
		userRegions[0].Coordinates.East,
		userRegions[0].Coordinates.West)

	// 测试多次生成
	const numTests = 25
	successCount := 0
	inRangeCount := 0

	for i := 0; i < numTests; i++ {
		lat, lng := GenerateRandomCoordinate(userRegions)

		// 检查坐标是否不是默认的北京坐标
		if lat != 39.9042 || lng != 116.4074 {
			successCount++

			// 检查坐标是否在期望的范围内
			if lat >= userRegions[0].Coordinates.South && lat <= userRegions[0].Coordinates.North &&
				lng >= userRegions[0].Coordinates.West && lng <= userRegions[0].Coordinates.East {
				inRangeCount++
			}
		}

		if i < 5 { // 只打印前5个
			t.Logf("  坐标 %d: (%.6f, %.6f)", i+1, lat, lng)
		}
	}

	successRate := float64(successCount) / float64(numTests) * 100
	inRangeRate := float64(inRangeCount) / float64(numTests) * 100

	t.Logf("用户偏好区域测试结果:")
	t.Logf("  总生成数: %d", numTests)
	t.Logf("  非默认坐标: %d (%.1f%%)", successCount, successRate)
	t.Logf("  在指定范围内: %d (%.1f%%)", inRangeCount, inRangeRate)

	// 验证修复效果
	if successRate < 95.0 {
		t.Errorf("用户偏好区域生成失败率过高: %.1f%% 的坐标是默认坐标", 100-successRate)
	}

	if inRangeRate < 95.0 {
		t.Errorf("坐标范围准确率过低: 只有 %.1f%% 的坐标在指定范围内", inRangeRate)
	}

	if successRate >= 95.0 && inRangeRate >= 95.0 {
		t.Logf("✅ 用户偏好区域坐标生成修复成功！")
	}
}
