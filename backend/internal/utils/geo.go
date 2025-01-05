package utils

import (
	"math"
	"math/rand"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

// 初始化随机数生成器
var rng = rand.New(rand.NewSource(time.Now().UnixNano()))

// 定义主要陆地范围的边界
var landMasses = []struct {
	minLat, maxLat float64
	minLng, maxLng float64
}{
	{20.0, 55.0, -130.0, -60.0},  // 北美洲
	{35.0, 70.0, -10.0, 40.0},    // 欧洲
	{20.0, 55.0, 70.0, 140.0},    // 亚洲
	{-35.0, 35.0, -20.0, 50.0},   // 非洲
	{-35.0, -10.0, 110.0, 155.0}, // 澳大利亚
	{-35.0, 5.0, -75.0, -35.0},   // 南美洲
}

// GenerateRandomCoordinate 生成一个随机的陆地坐标
func GenerateRandomCoordinate() (latitude, longitude float64) {
	// 随机选择一个大陆
	landMass := landMasses[rng.Intn(len(landMasses))]

	// 在选定的大陆范围内生成随机坐标
	latitude = landMass.minLat + rng.Float64()*(landMass.maxLat-landMass.minLat)
	longitude = landMass.minLng + rng.Float64()*(landMass.maxLng-landMass.minLng)

	return latitude, longitude
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

// GenerateRandomCoordinateInRegion 在指定区域内生成随机坐标
func GenerateRandomCoordinateInRegion(north, south, east, west float64) (latitude, longitude float64) {
	// 在指定范围内生成随机坐标
	latitude = south + rng.Float64()*(north-south)
	longitude = west + rng.Float64()*(east-west)

	return latitude, longitude
}

// GenerateRandomCoordinateFromRegions 从多个区域中随机选择一个并生成坐标
func GenerateRandomCoordinateFromRegions(regions []models.Region) (latitude, longitude float64) {
	if len(regions) == 0 {
		// 如果没有指定区域，使用默认的陆地范围
		return GenerateRandomCoordinate()
	}

	// 随机选择一个区域
	region := regions[rng.Intn(len(regions))]
	coords := region.Coordinates

	return GenerateRandomCoordinateInRegion(
		coords.North,
		coords.South,
		coords.East,
		coords.West,
	)
}
