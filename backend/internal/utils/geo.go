package utils

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"sync"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/paulmach/orb"
	"github.com/paulmach/orb/geojson"
)

// 初始化随机数生成器
var rng = rand.New(rand.NewSource(time.Now().UnixNano()))

// Region 表示一个坐标边界区域
type Region struct {
	North float64
	South float64
	East  float64
	West  float64
	// 添加实际的多边形数据用于精确的点在多边形内判断
	Polygons []orb.Polygon
	// 标识是否为小型岛屿（用于加权）
	IsMinorIsland bool
	// 国家信息，用于按国家等概率选择
	CountryName string
	CountryCode string
}

// 陆地区域缓存
var (
	cachedLandRegions []Region
	regionCacheMutex  sync.RWMutex
	regionCacheTime   time.Time
)

// 缓存有效期 (1小时)
const regionCacheExpiry = time.Hour

// getLandMassRegions 从Natural Earth数据集获取陆地区域
func getLandMassRegions() ([]Region, error) {
	regionCacheMutex.RLock()
	// 检查缓存是否有效
	if cachedLandRegions != nil && time.Since(regionCacheTime) < regionCacheExpiry {
		regions := cachedLandRegions
		regionCacheMutex.RUnlock()
		return regions, nil
	}
	regionCacheMutex.RUnlock()

	// 需要重新加载数据
	regionCacheMutex.Lock()
	defer regionCacheMutex.Unlock()

	// 双重检查，防止并发重复加载
	if cachedLandRegions != nil && time.Since(regionCacheTime) < regionCacheExpiry {
		return cachedLandRegions, nil
	}

	// 从地图管理器加载数据
	mapManager := GetGlobalMapManager()
	if mapManager == nil {
		return nil, fmt.Errorf("地图管理器未初始化")
	}

	// 加载世界地图数据
	worldData, err := mapManager.LoadWorldMapData()
	if err != nil {
		return nil, fmt.Errorf("加载世界地图数据失败: %w", err)
	}

	// 从世界地图数据提取陆地区域
	regions := extractLandRegionsFromGeoJSON(worldData, false) // false表示不是小型岛屿

	// 尝试加载小型岛屿数据
	minorIslandsData, err := mapManager.LoadMinorIslandsData()
	if err != nil {
		log.Printf("警告：加载小型岛屿数据失败: %v", err)
		log.Printf("将只使用世界地图数据")
	} else {
		// 从小型岛屿数据提取区域并合并
		minorIslandRegions := extractLandRegionsFromGeoJSON(minorIslandsData, true) // true表示是小型岛屿
		regions = append(regions, minorIslandRegions...)
	}

	if len(regions) == 0 {
		return nil, fmt.Errorf("未能从地图数据中提取到陆地区域")
	}

	// 缓存结果
	cachedLandRegions = regions
	regionCacheTime = time.Now()

	return regions, nil
}

// extractLandRegionsFromGeoJSON 从GeoJSON数据中提取陆地区域边界
func extractLandRegionsFromGeoJSON(fc *geojson.FeatureCollection, isMinorIsland bool) []Region {
	var regions []Region

	for _, feature := range fc.Features {
		if feature.Geometry == nil {
			continue
		}

		// 提取国家信息
		countryName := ""
		countryCode := ""
		if feature.Properties != nil {
			if name, exists := feature.Properties["NAME"]; exists {
				if nameStr, ok := name.(string); ok {
					countryName = nameStr
				}
			}
			if code, exists := feature.Properties["ISO_A3"]; exists {
				if codeStr, ok := code.(string); ok {
					countryCode = codeStr
				}
			}
		}

		switch geom := feature.Geometry.(type) {
		case orb.Polygon:
			regions = append(regions, extractRegionsFromPolygon(geom, isMinorIsland, countryName, countryCode)...)
		case orb.MultiPolygon:
			regions = append(regions, extractRegionsFromMultiPolygon(geom, isMinorIsland, countryName, countryCode)...)
		}
	}

	// 过滤掉无效的区域和南极洲区域
	var filteredRegions []Region
	for _, region := range regions {
		if isValidBounds(region) && !isAntarcticaRegion(region) {
			filteredRegions = append(filteredRegions, region)
		}
	}

	return filteredRegions
}

// extractRegionsFromPolygon 从多边形提取区域边界
func extractRegionsFromPolygon(polygon orb.Polygon, isMinorIsland bool, countryName, countryCode string) []Region {
	if len(polygon) == 0 || len(polygon[0]) == 0 {
		return nil
	}

	bounds := getBoundsFromPolygon(polygon)
	if !isValidBounds(bounds) {
		return nil
	}

	// 保存边界框和实际多边形数据
	region := Region{
		North:         bounds.North,
		South:         bounds.South,
		East:          bounds.East,
		West:          bounds.West,
		Polygons:      []orb.Polygon{polygon},
		IsMinorIsland: isMinorIsland,
		CountryName:   countryName,
		CountryCode:   countryCode,
	}

	return []Region{region}
}

// extractRegionsFromMultiPolygon 从多多边形提取区域边界
// 将每个多边形作为独立区域，避免大国家的岛屿导致坐标密度不均
func extractRegionsFromMultiPolygon(multiPolygon orb.MultiPolygon, isMinorIsland bool, countryName, countryCode string) []Region {
	if len(multiPolygon) == 0 {
		return nil
	}

	var regions []Region

	// 将每个多边形作为独立的区域
	for _, polygon := range multiPolygon {
		if len(polygon) == 0 || len(polygon[0]) == 0 {
			continue
		}

		bounds := getBoundsFromPolygon(polygon)
		if !isValidBounds(bounds) {
			continue
		}

		// 创建独立的区域
		region := Region{
			North:         bounds.North,
			South:         bounds.South,
			East:          bounds.East,
			West:          bounds.West,
			Polygons:      []orb.Polygon{polygon},
			IsMinorIsland: isMinorIsland,
			CountryName:   countryName,
			CountryCode:   countryCode,
		}

		regions = append(regions, region)
	}

	return regions
}

// getBoundsFromPolygon 从多边形获取边界
func getBoundsFromPolygon(polygon orb.Polygon) Region {
	var bounds Region
	if len(polygon) == 0 || len(polygon[0]) == 0 {
		return bounds
	}

	// 初始化边界
	bounds.North = polygon[0][0][1]
	bounds.South = polygon[0][0][1]
	bounds.East = polygon[0][0][0]
	bounds.West = polygon[0][0][0]

	// 遍历所有环的所有点
	for _, ring := range polygon {
		for _, point := range ring {
			lng, lat := point[0], point[1]

			if lat > bounds.North {
				bounds.North = lat
			}
			if lat < bounds.South {
				bounds.South = lat
			}
			if lng > bounds.East {
				bounds.East = lng
			}
			if lng < bounds.West {
				bounds.West = lng
			}
		}
	}

	return bounds
}

// isValidBounds 检查边界是否有效
func isValidBounds(bounds Region) bool {
	return bounds.North > bounds.South && bounds.East > bounds.West &&
		bounds.North <= 90 && bounds.South >= -90 &&
		bounds.East <= 180 && bounds.West >= -180
}

// getRegionArea 计算区域面积（使用真实多边形面积）
func getRegionArea(region Region) float64 {
	if len(region.Polygons) == 0 {
		// 如果没有多边形数据，回退到边界框面积
		return getRegionWidth(region) * getRegionHeight(region)
	}

	// 计算所有多边形的总面积
	totalArea := 0.0
	for _, polygon := range region.Polygons {
		area := calculatePolygonArea(polygon)
		totalArea += area
	}

	return totalArea
}

// calculatePolygonArea 使用Shoelace公式计算多边形面积
func calculatePolygonArea(polygon orb.Polygon) float64 {
	if len(polygon) == 0 || len(polygon[0]) < 3 {
		return 0.0
	}

	// 使用外环计算面积
	ring := polygon[0]
	area := 0.0

	// Shoelace公式 (也称为测量师公式)
	for i := 0; i < len(ring)-1; i++ {
		x1, y1 := ring[i][0], ring[i][1]
		x2, y2 := ring[i+1][0], ring[i+1][1]
		area += (x1 * y2) - (x2 * y1)
	}

	// 取绝对值并除以2
	area = math.Abs(area) / 2.0

	// 减去内环（洞）的面积
	for j := 1; j < len(polygon); j++ {
		innerRing := polygon[j]
		innerArea := 0.0

		for i := 0; i < len(innerRing)-1; i++ {
			x1, y1 := innerRing[i][0], innerRing[i][1]
			x2, y2 := innerRing[i+1][0], innerRing[i+1][1]
			innerArea += (x1 * y2) - (x2 * y1)
		}

		area -= math.Abs(innerArea) / 2.0
	}

	return area
}

// getRegionWidth 计算区域宽度
func getRegionWidth(region Region) float64 {
	return region.East - region.West
}

// getRegionHeight 计算区域高度
func getRegionHeight(region Region) float64 {
	return region.North - region.South
}

// GenerateRandomCoordinate 统一的随机坐标生成函数
// 支持随机场景（regions为nil或空）和用户偏好场景（传入regions）
// 简化逻辑，依赖街景搜索的兜底机制来处理无街景区域
func GenerateRandomCoordinate(regions []models.Region) (latitude, longitude float64) {
	// 选择区域源（用户偏好区域 or 自然地理区域）
	selectedRegions := selectRegionSource(regions)

	// 随机选择一个区域
	region := selectRandomRegion(selectedRegions)

	// 尝试在实际多边形内生成坐标
	if len(region.Polygons) > 0 {
		// 随机选择一个多边形（对于MultiPolygon情况）
		polygon := region.Polygons[rng.Intn(len(region.Polygons))]

		// 在多边形内生成坐标，减少尝试次数因为有街景兜底
		lat, lng, success := generateCoordinateInPolygon(polygon, 100)
		if success {
			return lat, lng
		}

		// 如果多边形内生成失败，回退到边界框内生成
		lat, lng = generateCoordinateInBounds(region.North, region.South, region.East, region.West)
		return lat, lng
	}

	// 如果没有多边形数据，直接使用边界框
	lat, lng := generateCoordinateInBounds(region.North, region.South, region.East, region.West)
	return lat, lng
}

// selectRegionSource 选择区域源
// 如果用户提供了偏好区域，使用用户区域；否则使用自然地理区域
func selectRegionSource(userRegions []models.Region) []Region {
	if len(userRegions) > 0 {
		// 将用户区域转换为内部Region格式
		regions := make([]Region, len(userRegions))
		for i, userRegion := range userRegions {
			// 为用户区域创建简单的矩形多边形
			rectPolygon := orb.Polygon{
				orb.Ring{
					orb.Point{userRegion.Coordinates.West, userRegion.Coordinates.South}, // 左下
					orb.Point{userRegion.Coordinates.East, userRegion.Coordinates.South}, // 右下
					orb.Point{userRegion.Coordinates.East, userRegion.Coordinates.North}, // 右上
					orb.Point{userRegion.Coordinates.West, userRegion.Coordinates.North}, // 左上
					orb.Point{userRegion.Coordinates.West, userRegion.Coordinates.South}, // 闭合
				},
			}

			regions[i] = Region{
				North:         userRegion.Coordinates.North,
				South:         userRegion.Coordinates.South,
				East:          userRegion.Coordinates.East,
				West:          userRegion.Coordinates.West,
				Polygons:      []orb.Polygon{rectPolygon}, // 添加矩形多边形
				IsMinorIsland: false,                      // 用户定义的区域默认不是小型岛屿
			}
		}
		return regions
	}

	// 使用Natural Earth数据集的陆地区域
	landRegions, err := getLandMassRegions()
	if err != nil {
		log.Printf("获取陆地区域失败: %v", err)
		return []Region{}
	}

	return landRegions
}

// selectRandomRegion 按国家等概率选择一个区域
// 每个国家被选中的概率相同，然后在该国家内按面积加权选择区域
func selectRandomRegion(regions []Region) Region {
	if len(regions) == 0 {
		// 如果没有区域，返回一个默认的全球区域
		log.Printf("警告：没有可用的陆地区域，使用全球区域")
		return Region{North: 85.0, South: -85.0, East: 180.0, West: -180.0}
	}

	// 如果只有一个区域，直接返回
	if len(regions) == 1 {
		return regions[0]
	}

	// 按国家分组区域
	countryRegions := make(map[string][]Region)
	for _, region := range regions {
		countryKey := region.CountryCode
		if countryKey == "" {
			countryKey = region.CountryName
		}
		if countryKey == "" {
			countryKey = "UNKNOWN" // 为未知国家设置默认key
		}
		countryRegions[countryKey] = append(countryRegions[countryKey], region)
	}

	// 如果只有一个国家，直接在该国家内选择
	if len(countryRegions) == 1 {
		for _, countryRegionList := range countryRegions {
			return selectRegionWithinCountry(countryRegionList)
		}
	}

	// 随机选择一个国家（等概率）
	countryKeys := make([]string, 0, len(countryRegions))
	for key := range countryRegions {
		countryKeys = append(countryKeys, key)
	}
	selectedCountryKey := countryKeys[rng.Intn(len(countryKeys))]
	selectedCountryRegions := countryRegions[selectedCountryKey]

	// 在选中的国家内选择区域
	return selectRegionWithinCountry(selectedCountryRegions)
}

// selectRegionWithinCountry 在同一国家内按面积加权选择区域
func selectRegionWithinCountry(regions []Region) Region {
	if len(regions) == 0 {
		log.Printf("警告：国家内没有可用区域")
		return Region{North: 85.0, South: -85.0, East: 180.0, West: -180.0}
	}

	if len(regions) == 1 {
		return regions[0]
	}

	// 计算每个区域的面积权重
	weights := make([]float64, len(regions))
	totalWeight := 0.0

	for i, region := range regions {
		area := getRegionArea(region)
		weight := area

		// 如果是小型岛屿，应用1.2倍权重以稍微增加多样性
		if region.IsMinorIsland {
			weight *= 1.2
		}

		weights[i] = weight
		totalWeight += weight
	}

	// 如果总权重为0，回退到均匀随机选择
	if totalWeight == 0 {
		return regions[rng.Intn(len(regions))]
	}

	// 生成0到totalWeight之间的随机数
	randomValue := rng.Float64() * totalWeight

	// 使用累积权重找到对应的区域
	cumulativeWeight := 0.0
	for i, weight := range weights {
		cumulativeWeight += weight
		if randomValue <= cumulativeWeight {
			return regions[i]
		}
	}

	// 理论上不应该到达这里，但作为保险返回最后一个区域
	return regions[len(regions)-1]
}

// generateCoordinateInBounds 在指定边界内生成随机坐标
func generateCoordinateInBounds(north, south, east, west float64) (latitude, longitude float64) {
	// 生成纬度（南北范围）
	latitude = south + rng.Float64()*(north-south)

	// 生成经度（东西范围）
	longitude = west + rng.Float64()*(east-west)

	return latitude, longitude
}

// pointInPolygon 判断点是否在多边形内（射线法）
// 支持有洞的多边形，正确处理外环和内环
func pointInPolygon(lat, lng float64, polygon orb.Polygon) bool {
	if len(polygon) == 0 || len(polygon[0]) == 0 {
		return false
	}

	// 使用射线法判断点是否在多边形内
	// 从点向右发射一条射线，计算与多边形边的交点数
	// 奇数个交点表示在内部，偶数个交点表示在外部

	// 首先判断是否在外环内
	inside := pointInRing(lat, lng, polygon[0])

	// 如果不在外环内，直接返回false
	if !inside {
		return false
	}

	// 如果在外环内，检查是否在任何内环（洞）内
	// 如果在内环内，则实际上不在多边形内
	for i := 1; i < len(polygon); i++ {
		if pointInRing(lat, lng, polygon[i]) {
			return false // 在洞内，所以不在多边形内
		}
	}

	return true // 在外环内且不在任何洞内
}

// pointInRing 判断点是否在环内（射线法）
func pointInRing(lat, lng float64, ring orb.Ring) bool {
	if len(ring) == 0 {
		return false
	}

	inside := false
	j := len(ring) - 1

	for i := 0; i < len(ring); i++ {
		xi, yi := ring[i][0], ring[i][1]
		xj, yj := ring[j][0], ring[j][1]

		// 改进的射线法，处理边界情况
		if ((yi > lat) != (yj > lat)) &&
			(lng <= (xj-xi)*(lat-yi)/(yj-yi)+xi) {
			inside = !inside
		}
		j = i
	}

	return inside
}

// generateCoordinateInPolygon 在多边形内生成随机坐标
// 移除边界框回退机制，只返回真正在多边形内的坐标
func generateCoordinateInPolygon(polygon orb.Polygon, maxAttempts int) (latitude, longitude float64, success bool) {
	if len(polygon) == 0 || len(polygon[0]) == 0 {
		return 0, 0, false
	}

	// 获取多边形的边界框
	bounds := getBoundsFromPolygon(polygon)
	if !isValidBounds(bounds) {
		return 0, 0, false
	}

	// 在边界框内尝试生成坐标，直到找到在多边形内的点
	for attempt := 0; attempt < maxAttempts; attempt++ {
		lat := bounds.South + rng.Float64()*(bounds.North-bounds.South)
		lng := bounds.West + rng.Float64()*(bounds.East-bounds.West)

		if pointInPolygon(lat, lng, polygon) {
			return lat, lng, true
		}
	}

	// 如果多次尝试都失败，返回失败状态而不是边界框坐标
	return 0, 0, false
}

// CalculateDistance 计算两个坐标点之间的距离（单位：公里）
func CalculateDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371 // 地球半径（公里）

	// 将经纬度转换为弧度
	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	lon1Rad := lon1 * math.Pi / 180
	lon2Rad := lon2 * math.Pi / 180

	// 差值
	dLat := lat2Rad - lat1Rad
	dLon := lon2Rad - lon1Rad

	// Haversine 公式
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	distance := R * c

	return distance
}

// ClearRegionCache 清空区域缓存（用于测试）
func ClearRegionCache() {
	regionCacheMutex.Lock()
	defer regionCacheMutex.Unlock()
	cachedLandRegions = nil
}

// GetRegionInfo 获取当前区域信息（用于调试）
func GetRegionInfo() map[string]interface{} {
	regions, err := getLandMassRegions()

	info := map[string]interface{}{
		"total_regions": len(regions),
		"cache_time":    regionCacheTime,
		"cache_valid":   time.Since(regionCacheTime) < regionCacheExpiry,
	}

	if err != nil {
		info["error"] = err.Error()
		return info
	}

	// 添加一些统计信息
	if len(regions) > 0 {
		var totalArea float64
		var minArea, maxArea float64 = math.MaxFloat64, 0
		var minWidth, maxWidth float64 = math.MaxFloat64, 0
		var minHeight, maxHeight float64 = math.MaxFloat64, 0
		var minorIslandCount int

		// 按国家分组统计
		countryRegions := make(map[string][]Region)
		countryStats := make(map[string]int)

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

			// 统计小型岛屿数量
			if region.IsMinorIsland {
				minorIslandCount++
			}

			// 按国家分组
			countryKey := region.CountryCode
			if countryKey == "" {
				countryKey = region.CountryName
			}
			if countryKey == "" {
				countryKey = "UNKNOWN"
			}
			countryRegions[countryKey] = append(countryRegions[countryKey], region)
			countryStats[countryKey]++
		}

		info["total_area"] = totalArea
		info["avg_area"] = totalArea / float64(len(regions))
		info["min_area"] = minArea
		info["max_area"] = maxArea
		info["min_width"] = minWidth
		info["max_width"] = maxWidth
		info["min_height"] = minHeight
		info["max_height"] = maxHeight
		info["minor_islands_count"] = minorIslandCount
		info["regular_regions_count"] = len(regions) - minorIslandCount
		info["total_countries"] = len(countryRegions)
		info["country_stats"] = countryStats
	}

	return info
}

// isAntarcticaRegion 判断区域是否为南极洲区域
func isAntarcticaRegion(region Region) bool {
	// 南极洲的判断条件：
	// 1. 北边界在南纬60度以南（North < -60）
	// 这样可以排除南极洲大陆及其周边岛屿
	return region.North < -60.0
}
