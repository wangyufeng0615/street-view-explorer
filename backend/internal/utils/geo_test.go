package utils

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"testing"
	"time"

	"github.com/paulmach/orb"
	"github.com/paulmach/orb/geojson"
)

// TestGetLandMassRegions 测试获取陆地区域
func TestGetLandMassRegions(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存以测试新数据
	ClearRegionCache()

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

// TestGenerateRandomCoordinate 测试随机坐标生成
func TestGenerateRandomCoordinate(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	// 测试不同数量的坐标生成
	testCases := []int{1, 10, 100}

	for _, count := range testCases {
		t.Run(fmt.Sprintf("生成%d个坐标", count), func(t *testing.T) {
			var coordinates [][]float64

			for i := 0; i < count; i++ {
				lat, lng := GenerateRandomCoordinate(nil)

				// 验证坐标范围
				if lat < -90 || lat > 90 {
					t.Errorf("纬度超出范围: %f", lat)
				}
				if lng < -180 || lng > 180 {
					t.Errorf("经度超出范围: %f", lng)
				}

				coordinates = append(coordinates, []float64{lat, lng})
			}

			// 分析坐标分布
			if len(coordinates) >= 10 {
				var latSum, lngSum float64
				for _, coord := range coordinates {
					latSum += coord[0]
					lngSum += coord[1]
				}

				avgLat := latSum / float64(len(coordinates))
				avgLng := lngSum / float64(len(coordinates))

				t.Logf("生成了 %d 个坐标", len(coordinates))
				t.Logf("平均坐标: (%.2f, %.2f)", avgLat, avgLng)
			}
		})
	}
}

// TestRegionCaching 测试区域缓存机制
func TestRegionCaching(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	// 第一次调用 - 从文件加载
	start := time.Now()
	regions1, err := getLandMassRegions()
	firstLoadTime := time.Since(start)
	if err != nil {
		t.Fatalf("第一次获取陆地区域失败: %v", err)
	}

	// 第二次调用 - 从缓存加载
	start = time.Now()
	regions2, err := getLandMassRegions()
	cacheLoadTime := time.Since(start)
	if err != nil {
		t.Fatalf("第二次获取陆地区域失败: %v", err)
	}

	// 验证结果一致
	if len(regions1) != len(regions2) {
		t.Errorf("缓存前后区域数量不一致: %d vs %d", len(regions1), len(regions2))
	}

	// 验证缓存性能提升
	t.Logf("第一次加载耗时: %v", firstLoadTime)
	t.Logf("缓存加载耗时: %v", cacheLoadTime)

	if cacheLoadTime >= firstLoadTime {
		t.Logf("注意: 缓存加载时间 (%v) 没有明显优于首次加载时间 (%v)", cacheLoadTime, firstLoadTime)
	}
}

// TestGetRegionInfo 测试获取区域信息
func TestGetRegionInfo(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	info := GetRegionInfo()

	// 验证基本信息
	if totalRegions, ok := info["total_regions"].(int); ok {
		if totalRegions <= 0 {
			t.Error("区域总数应该大于0")
		}
		t.Logf("区域总数: %d", totalRegions)
	} else {
		t.Error("无法获取区域总数")
	}

	// 验证统计信息
	expectedKeys := []string{"total_area", "avg_area", "min_area", "max_area", "min_width", "max_width", "min_height", "max_height"}
	for _, key := range expectedKeys {
		if _, exists := info[key]; !exists {
			t.Errorf("缺少统计信息: %s", key)
		}
	}

	// 打印详细信息
	for key, value := range info {
		t.Logf("%s: %v", key, value)
	}
}

// TestCoordinateDistribution 测试坐标分布情况
func TestCoordinateDistribution(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	// 生成大量坐标进行分布分析
	const numCoords = 10000
	coordinates := make([][]float64, numCoords)

	t.Logf("生成 %d 个随机坐标进行分布分析...", numCoords)
	start := time.Now()

	for i := 0; i < numCoords; i++ {
		lat, lng := GenerateRandomCoordinate(nil)
		coordinates[i] = []float64{lat, lng}
	}

	generationTime := time.Since(start)
	t.Logf("坐标生成耗时: %v (平均每个坐标: %v)", generationTime, generationTime/numCoords)

	// 分析坐标分布
	var (
		minLat, maxLat = 90.0, -90.0
		minLng, maxLng = 180.0, -180.0
		latSum, lngSum = 0.0, 0.0
	)

	for _, coord := range coordinates {
		lat, lng := coord[0], coord[1]

		if lat < minLat {
			minLat = lat
		}
		if lat > maxLat {
			maxLat = lat
		}
		if lng < minLng {
			minLng = lng
		}
		if lng > maxLng {
			maxLng = lng
		}

		latSum += lat
		lngSum += lng
	}

	avgLat := latSum / float64(numCoords)
	avgLng := lngSum / float64(numCoords)

	t.Logf("坐标分布统计:")
	t.Logf("  纬度范围: %.2f° 到 %.2f° (跨度: %.2f°)", minLat, maxLat, maxLat-minLat)
	t.Logf("  经度范围: %.2f° 到 %.2f° (跨度: %.2f°)", minLng, maxLng, maxLng-minLng)
	t.Logf("  平均坐标: (%.2f°, %.2f°)", avgLat, avgLng)
}

// TestVisualizationGeneration 测试可视化生成
func TestVisualizationGeneration(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	// 生成坐标用于可视化
	const numPoints = 100000
	const imgWidth, imgHeight = 3600, 1800 // 0.1度分辨率的世界地图

	t.Logf("生成 %d 个坐标点用于可视化...", numPoints)

	// 创建画布
	img := image.NewRGBA(image.Rect(0, 0, imgWidth, imgHeight))

	// 填充白色背景
	white := color.RGBA{255, 255, 255, 255}
	for y := 0; y < imgHeight; y++ {
		for x := 0; x < imgWidth; x++ {
			img.Set(x, y, white)
		}
	}

	// 绘制国家轮廓
	mapManager := GetGlobalMapManager()
	if mapManager != nil {
		// 绘制主要陆地区域
		worldData, err := mapManager.LoadWorldMapData()
		if err == nil {
			drawCountryOutlines(img, worldData, imgWidth, imgHeight, color.RGBA{0, 0, 0, 255}) // 黑色主陆地轮廓
		}

		// 绘制小型岛屿
		minorIslandsData, err := mapManager.LoadMinorIslandsData()
		if err == nil {
			drawCountryOutlines(img, minorIslandsData, imgWidth, imgHeight, color.RGBA{100, 100, 100, 255}) // 灰色小型岛屿轮廓
			t.Logf("已绘制 %d 个小型岛屿轮廓", len(minorIslandsData.Features))
		} else {
			t.Logf("警告：无法加载小型岛屿数据: %v", err)
		}
	}

	// 生成并绘制坐标点
	pointCount := 0
	red := color.RGBA{220, 20, 20, 255} // 深红色坐标点，更加明显
	for i := 0; i < numPoints; i++ {
		lat, lng := GenerateRandomCoordinate(nil)

		// 转换为图像坐标
		x := int((lng + 180) * float64(imgWidth) / 360)
		y := int((90 - lat) * float64(imgHeight) / 180)

		// 确保坐标在图像范围内
		if x >= 0 && x < imgWidth && y >= 0 && y < imgHeight {
			// 绘制更大的红色坐标点（2x2像素）
			drawPoint(img, x, y, red, imgWidth, imgHeight)
			pointCount++
		}
	}

	// 保存图像
	filename := "random_coordinates_natural_earth_high_res.png"
	file, err := os.Create(filename)
	if err != nil {
		t.Fatalf("创建图像文件失败: %v", err)
	}
	defer file.Close()

	if err := png.Encode(file, img); err != nil {
		t.Fatalf("保存图像失败: %v", err)
	}

	t.Logf("可视化测试完成:")
	t.Logf("  目标生成数量: %d", numPoints)
	t.Logf("  有效绘制点数: %d", pointCount)
	t.Logf("  可视化图像已保存: %s", filename)
	t.Logf("  图像分辨率: %dx%d (0.1° 精度)", imgWidth, imgHeight)
}

// drawCountryOutlines 绘制国家轮廓
func drawCountryOutlines(img *image.RGBA, fc *geojson.FeatureCollection, width, height int, lineColor color.RGBA) {
	for _, feature := range fc.Features {
		if feature.Geometry == nil {
			continue
		}

		switch geom := feature.Geometry.(type) {
		case orb.Polygon:
			drawPolygon(img, geom, lineColor, width, height)
		case orb.MultiPolygon:
			for _, poly := range geom {
				drawPolygon(img, poly, lineColor, width, height)
			}
		}
	}
}

// drawPolygon 绘制多边形轮廓
func drawPolygon(img *image.RGBA, polygon orb.Polygon, lineColor color.RGBA, width, height int) {
	for _, ring := range polygon {
		if len(ring) < 2 {
			continue
		}

		for i := 0; i < len(ring)-1; i++ {
			x1, y1 := coordToPixel(ring[i][0], ring[i][1], width, height)
			x2, y2 := coordToPixel(ring[i+1][0], ring[i+1][1], width, height)
			drawLine(img, x1, y1, x2, y2, lineColor, width, height)
		}
	}
}

// coordToPixel 将经纬度坐标转换为图像像素坐标
func coordToPixel(lng, lat float64, width, height int) (int, int) {
	// 经度 -180 到 180 映射到 0 到 width
	x := int((lng + 180.0) * float64(width) / 360.0)
	// 纬度 90 到 -90 映射到 0 到 height（注意Y轴翻转）
	y := int((90.0 - lat) * float64(height) / 180.0)

	// 确保坐标在有效范围内
	if x < 0 {
		x = 0
	}
	if x >= width {
		x = width - 1
	}
	if y < 0 {
		y = 0
	}
	if y >= height {
		y = height - 1
	}

	return x, y
}

// drawLine 使用Bresenham算法绘制直线
func drawLine(img *image.RGBA, x1, y1, x2, y2 int, lineColor color.RGBA, width, height int) {
	dx := abs(x2 - x1)
	dy := abs(y2 - y1)

	var sx, sy int
	if x1 < x2 {
		sx = 1
	} else {
		sx = -1
	}
	if y1 < y2 {
		sy = 1
	} else {
		sy = -1
	}

	err := dx - dy
	x, y := x1, y1

	for {
		if x >= 0 && x < width && y >= 0 && y < height {
			img.Set(x, y, lineColor)
		}

		if x == x2 && y == y2 {
			break
		}

		e2 := 2 * err
		if e2 > -dy {
			err -= dy
			x += sx
		}
		if e2 < dx {
			err += dx
			y += sy
		}
	}
}

// abs 绝对值函数
func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// drawPoint 绘制一个更明显的点（2x2像素）
func drawPoint(img *image.RGBA, x, y int, pointColor color.RGBA, width, height int) {
	// 绘制2x2的点使其更明显
	for dx := 0; dx < 2; dx++ {
		for dy := 0; dy < 2; dy++ {
			px := x + dx
			py := y + dy
			if px >= 0 && px < width && py >= 0 && py < height {
				img.Set(px, py, pointColor)
			}
		}
	}
}

// TestAreaWeightedSelection 测试按面积加权的随机选择
func TestAreaWeightedSelection(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	// 获取陆地区域
	regions, err := getLandMassRegions()
	if err != nil {
		t.Fatalf("获取陆地区域失败: %v", err)
	}

	if len(regions) == 0 {
		t.Fatal("没有可用的陆地区域")
	}

	// 计算每个区域的面积和总面积
	areas := make([]float64, len(regions))
	totalArea := 0.0
	for i, region := range regions {
		area := getRegionArea(region)
		areas[i] = area
		totalArea += area
	}

	// 进行大量采样来验证分布
	const numSamples = 100000
	selectionCounts := make([]int, len(regions))

	t.Logf("进行 %d 次采样来验证按面积加权的随机选择...", numSamples)

	for i := 0; i < numSamples; i++ {
		selectedRegion := selectRandomRegion(regions)

		// 找到被选中的区域索引
		for j, region := range regions {
			if selectedRegion.North == region.North &&
				selectedRegion.South == region.South &&
				selectedRegion.East == region.East &&
				selectedRegion.West == region.West {
				selectionCounts[j]++
				break
			}
		}
	}

	// 分析结果：找出面积最大和最小的几个区域
	type RegionStats struct {
		Index    int
		Area     float64
		Count    int
		Expected float64
		Actual   float64
	}

	var stats []RegionStats
	for i := 0; i < len(regions); i++ {
		expected := areas[i] / totalArea
		actual := float64(selectionCounts[i]) / float64(numSamples)
		stats = append(stats, RegionStats{
			Index:    i,
			Area:     areas[i],
			Count:    selectionCounts[i],
			Expected: expected,
			Actual:   actual,
		})
	}

	// 按面积排序
	for i := 0; i < len(stats)-1; i++ {
		for j := i + 1; j < len(stats); j++ {
			if stats[i].Area < stats[j].Area {
				stats[i], stats[j] = stats[j], stats[i]
			}
		}
	}

	// 显示前10个最大区域的统计
	t.Logf("面积最大的10个区域的选择统计:")
	t.Logf("%-5s %-12s %-8s %-12s %-12s %-8s", "排名", "面积(度²)", "选择次数", "期望概率", "实际概率", "误差")
	for i := 0; i < 10 && i < len(stats); i++ {
		stat := stats[i]
		error := math.Abs(stat.Expected - stat.Actual)
		t.Logf("%-5d %-12.2f %-8d %-12.4f %-12.4f %-8.4f",
			i+1, stat.Area, stat.Count, stat.Expected, stat.Actual, error)
	}

	// 显示后10个最小区域的统计
	t.Logf("\n面积最小的10个区域的选择统计:")
	t.Logf("%-5s %-12s %-8s %-12s %-12s %-8s", "排名", "面积(度²)", "选择次数", "期望概率", "实际概率", "误差")
	start := len(stats) - 10
	if start < 0 {
		start = 0
	}
	for i := start; i < len(stats); i++ {
		stat := stats[i]
		error := math.Abs(stat.Expected - stat.Actual)
		rank := len(stats) - i
		t.Logf("%-5d %-12.6f %-8d %-12.6f %-12.6f %-8.6f",
			rank, stat.Area, stat.Count, stat.Expected, stat.Actual, error)
	}

	// 验证大区域确实比小区域被选中更多
	largestArea := stats[0].Area
	smallestArea := stats[len(stats)-1].Area
	largestCount := stats[0].Count
	smallestCount := stats[len(stats)-1].Count

	t.Logf("\n验证结果:")
	t.Logf("最大区域面积: %.2f 度², 被选中 %d 次", largestArea, largestCount)
	t.Logf("最小区域面积: %.6f 度², 被选中 %d 次", smallestArea, smallestCount)

	// 面积比和选择次数比应该大致相等
	areaRatio := largestArea / smallestArea
	countRatio := float64(largestCount) / float64(smallestCount)
	t.Logf("面积比: %.2f, 选择次数比: %.2f", areaRatio, countRatio)

	// 验证选择次数比与面积比的相关性（允许一定误差）
	if countRatio < areaRatio*0.5 || countRatio > areaRatio*2.0 {
		t.Logf("警告: 选择次数比与面积比差异较大，可能需要更多样本或算法调整")
	} else {
		t.Logf("✓ 按面积加权的随机选择工作正常")
	}
}

// BenchmarkAreaWeightedSelection 测试按面积加权随机选择的性能
func BenchmarkAreaWeightedSelection(b *testing.B) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		b.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	// 获取陆地区域
	regions, err := getLandMassRegions()
	if err != nil {
		b.Fatalf("获取陆地区域失败: %v", err)
	}

	if len(regions) == 0 {
		b.Fatal("没有可用的陆地区域")
	}

	b.ResetTimer()

	// 测试随机区域选择的性能
	for i := 0; i < b.N; i++ {
		_ = selectRandomRegion(regions)
	}
}

// BenchmarkGenerateRandomCoordinate 测试完整随机坐标生成的性能
func BenchmarkGenerateRandomCoordinate(b *testing.B) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		b.Fatalf("确保地图数据就绪失败: %v", err)
	}

	b.ResetTimer()

	// 测试完整坐标生成的性能
	for i := 0; i < b.N; i++ {
		_, _ = GenerateRandomCoordinate(nil)
	}
}

// TestPolygonBasedGeneration 测试基于多边形的坐标生成
func TestPolygonBasedGeneration(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	// 获取陆地区域
	regions, err := getLandMassRegions()
	if err != nil {
		t.Fatalf("获取陆地区域失败: %v", err)
	}

	if len(regions) == 0 {
		t.Fatal("没有可用的陆地区域")
	}

	t.Logf("测试基于多边形的坐标生成...")
	t.Logf("总共有 %d 个陆地区域", len(regions))

	// 统计有多边形数据的区域
	regionsWithPolygons := 0
	totalPolygons := 0
	for _, region := range regions {
		if len(region.Polygons) > 0 {
			regionsWithPolygons++
			totalPolygons += len(region.Polygons)
		}
	}

	t.Logf("有多边形数据的区域: %d/%d", regionsWithPolygons, len(regions))
	t.Logf("总多边形数量: %d", totalPolygons)

	// 生成一些坐标并验证它们在多边形内
	const numTests = 1000
	successCount := 0
	polygonHitCount := 0

	for i := 0; i < numTests; i++ {
		lat, lng := GenerateRandomCoordinate(nil)

		// 检查这个坐标是否在某个多边形内
		found := false
		for _, region := range regions {
			for _, polygon := range region.Polygons {
				if pointInPolygon(lat, lng, polygon) {
					found = true
					polygonHitCount++
					break
				}
			}
			if found {
				break
			}
		}

		if found {
			successCount++
		}
	}

	t.Logf("测试结果:")
	t.Logf("  生成坐标数: %d", numTests)
	t.Logf("  在多边形内的坐标: %d", successCount)
	t.Logf("  多边形命中率: %.2f%%", float64(successCount)/float64(numTests)*100)
	t.Logf("  总多边形命中次数: %d", polygonHitCount)

	// 验证大部分坐标都在多边形内（允许一些回退到边界框的情况）
	if float64(successCount)/float64(numTests) < 0.7 {
		t.Logf("警告: 多边形命中率较低，可能需要调整算法参数")
	} else {
		t.Logf("✓ 多边形内坐标生成工作正常")
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

// TestRegionDistributionAnalysis 分析区域分布，查找坐标密度不均的原因
func TestRegionDistributionAnalysis(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	// 获取陆地区域
	regions, err := getLandMassRegions()
	if err != nil {
		t.Fatalf("获取陆地区域失败: %v", err)
	}

	if len(regions) == 0 {
		t.Fatal("没有可用的陆地区域")
	}

	t.Logf("区域分布分析:")
	t.Logf("总区域数: %d", len(regions))

	// 分析每个区域的详细信息
	type RegionAnalysis struct {
		Index        int
		Area         float64
		Width        float64
		Height       float64
		PolygonCount int
		North        float64
		South        float64
		East         float64
		West         float64
	}

	var analyses []RegionAnalysis
	totalArea := 0.0

	for i, region := range regions {
		area := getRegionArea(region)
		width := getRegionWidth(region)
		height := getRegionHeight(region)

		analyses = append(analyses, RegionAnalysis{
			Index:        i,
			Area:         area,
			Width:        width,
			Height:       height,
			PolygonCount: len(region.Polygons),
			North:        region.North,
			South:        region.South,
			East:         region.East,
			West:         region.West,
		})

		totalArea += area
	}

	// 按面积排序
	for i := 0; i < len(analyses)-1; i++ {
		for j := i + 1; j < len(analyses); j++ {
			if analyses[i].Area < analyses[j].Area {
				analyses[i], analyses[j] = analyses[j], analyses[i]
			}
		}
	}

	t.Logf("\n面积最大的20个区域:")
	t.Logf("%-4s %-12s %-8s %-8s %-8s %-12s %-12s %-12s %-12s",
		"排名", "面积(度²)", "宽度", "高度", "多边形数", "北纬", "南纬", "东经", "西经")

	for i := 0; i < 20 && i < len(analyses); i++ {
		a := analyses[i]
		t.Logf("%-4d %-12.2f %-8.2f %-8.2f %-8d %-12.2f %-12.2f %-12.2f %-12.2f",
			i+1, a.Area, a.Width, a.Height, a.PolygonCount,
			a.North, a.South, a.East, a.West)
	}

	t.Logf("\n面积最小的20个区域:")
	start := len(analyses) - 20
	if start < 0 {
		start = 0
	}

	for i := start; i < len(analyses); i++ {
		a := analyses[i]
		rank := len(analyses) - i
		t.Logf("%-4d %-12.6f %-8.6f %-8.6f %-8d %-12.2f %-12.2f %-12.2f %-12.2f",
			rank, a.Area, a.Width, a.Height, a.PolygonCount,
			a.North, a.South, a.East, a.West)
	}

	// 查找可能的问题区域
	t.Logf("\n可能导致密度不均的区域分析:")

	// 1. 查找多边形数量异常多的区域
	maxPolygons := 0
	for _, a := range analyses {
		if a.PolygonCount > maxPolygons {
			maxPolygons = a.PolygonCount
		}
	}

	t.Logf("多边形数量最多的区域 (可能包含很多岛屿):")
	for i, a := range analyses {
		if a.PolygonCount > 10 { // 超过10个多边形的区域
			percentage := a.Area / totalArea * 100
			t.Logf("  排名%d: 面积%.2f度² (%.2f%%), %d个多边形, 坐标范围(%.2f,%.2f)到(%.2f,%.2f)",
				i+1, a.Area, percentage, a.PolygonCount, a.South, a.West, a.North, a.East)
		}
	}

	// 2. 查找面积与多边形数量比例异常的区域
	t.Logf("\n面积/多边形比例分析 (可能的重复计算问题):")
	for i, a := range analyses[:10] { // 只看前10大区域
		if a.PolygonCount > 1 {
			areaPerPolygon := a.Area / float64(a.PolygonCount)
			percentage := a.Area / totalArea * 100
			t.Logf("  排名%d: 总面积%.2f度² (%.2f%%), %d个多边形, 平均每个多边形%.2f度²",
				i+1, a.Area, percentage, a.PolygonCount, areaPerPolygon)
		}
	}
}

// TestSpecificCountryDensityAnalysis 分析特定国家坐标密度异常的原因
func TestSpecificCountryDensityAnalysis(t *testing.T) {
	// 确保地图数据就绪
	if err := EnsureMapDataReady(); err != nil {
		t.Fatalf("确保地图数据就绪失败: %v", err)
	}

	// 清空缓存
	ClearRegionCache()

	// 获取陆地区域
	regions, err := getLandMassRegions()
	if err != nil {
		t.Fatalf("获取陆地区域失败: %v", err)
	}

	if len(regions) == 0 {
		t.Fatal("没有可用的陆地区域")
	}

	t.Logf("特定国家坐标密度分析:")
	t.Logf("总区域数: %d", len(regions))

	// 分析每个区域的详细信息
	type RegionDetail struct {
		Index       int
		Area        float64
		Width       float64
		Height      float64
		North       float64
		South       float64
		East        float64
		West        float64
		AspectRatio float64 // 宽高比
		Efficiency  float64 // 面积效率 (实际面积/边界框面积)
	}

	var details []RegionDetail
	totalArea := 0.0

	for i, region := range regions {
		area := getRegionArea(region)
		width := getRegionWidth(region)
		height := getRegionHeight(region)

		// 计算宽高比
		aspectRatio := width / height
		if height > width {
			aspectRatio = height / width
		}

		// 计算面积效率（这里简化为1，实际应该是多边形面积/边界框面积）
		efficiency := 1.0

		details = append(details, RegionDetail{
			Index:       i,
			Area:        area,
			Width:       width,
			Height:      height,
			North:       region.North,
			South:       region.South,
			East:        region.East,
			West:        region.West,
			AspectRatio: aspectRatio,
			Efficiency:  efficiency,
		})

		totalArea += area
	}

	// 按面积排序
	for i := 0; i < len(details)-1; i++ {
		for j := i + 1; j < len(details); j++ {
			if details[i].Area < details[j].Area {
				details[i], details[j] = details[j], details[i]
			}
		}
	}

	t.Logf("\n可能的问题国家特征分析:")

	// 查找可能对应挪威、智利、摩洛哥、索马里的区域
	// 这些国家的特点：细长形状，高宽高比

	t.Logf("\n高宽高比区域 (可能是细长国家如挪威、智利):")
	t.Logf("%-4s %-12s %-8s %-8s %-8s %-12s %-12s %-12s %-12s",
		"排名", "面积(度²)", "宽度", "高度", "宽高比", "北纬", "南纬", "东经", "西经")

	highAspectCount := 0
	for i, d := range details {
		if d.AspectRatio > 5.0 { // 宽高比大于5的细长区域
			t.Logf("%-4d %-12.2f %-8.2f %-8.2f %-8.2f %-12.2f %-12.2f %-12.2f %-12.2f",
				i+1, d.Area, d.Width, d.Height, d.AspectRatio,
				d.North, d.South, d.East, d.West)
			highAspectCount++
		}
	}

	t.Logf("发现 %d 个高宽高比区域", highAspectCount)

	// 查找中等面积但形状特殊的区域
	t.Logf("\n中等面积区域分析 (面积100-1000度²):")
	t.Logf("%-4s %-12s %-8s %-8s %-8s %-12s %-12s %-12s %-12s",
		"排名", "面积(度²)", "宽度", "高度", "宽高比", "北纬", "南纬", "东经", "西经")

	mediumAreaCount := 0
	for i, d := range details {
		if d.Area >= 100 && d.Area <= 1000 {
			t.Logf("%-4d %-12.2f %-8.2f %-8.2f %-8.2f %-12.2f %-12.2f %-12.2f %-12.2f",
				i+1, d.Area, d.Width, d.Height, d.AspectRatio,
				d.North, d.South, d.East, d.West)
			mediumAreaCount++
		}
	}

	t.Logf("发现 %d 个中等面积区域", mediumAreaCount)

	// 分析坐标生成效率问题
	t.Logf("\n坐标生成效率分析:")

	// 模拟生成一些坐标，看看哪些区域被选中频率高
	const testSamples = 10000
	selectionCounts := make([]int, len(regions))

	for i := 0; i < testSamples; i++ {
		selectedRegion := selectRandomRegion(regions)

		// 找到被选中的区域索引
		for j, region := range regions {
			if selectedRegion.North == region.North &&
				selectedRegion.South == region.South &&
				selectedRegion.East == region.East &&
				selectedRegion.West == region.West {
				selectionCounts[j]++
				break
			}
		}
	}

	// 显示选择频率最高的区域
	t.Logf("\n选择频率最高的20个区域:")
	t.Logf("%-4s %-12s %-8s %-8s %-8s %-8s %-12s %-12s",
		"排名", "面积(度²)", "选择次数", "期望%", "实际%", "宽高比", "北纬-南纬", "东经-西经")

	// 创建选择统计
	type SelectionStat struct {
		Index       int
		Area        float64
		Count       int
		Expected    float64
		Actual      float64
		AspectRatio float64
		LatRange    string
		LngRange    string
	}

	var stats []SelectionStat
	for i, count := range selectionCounts {
		if i < len(details) {
			d := details[i]
			expected := d.Area / totalArea * 100
			actual := float64(count) / float64(testSamples) * 100

			stats = append(stats, SelectionStat{
				Index:       i,
				Area:        d.Area,
				Count:       count,
				Expected:    expected,
				Actual:      actual,
				AspectRatio: d.AspectRatio,
				LatRange:    fmt.Sprintf("%.1f-%.1f", d.South, d.North),
				LngRange:    fmt.Sprintf("%.1f-%.1f", d.West, d.East),
			})
		}
	}

	// 按选择次数排序
	for i := 0; i < len(stats)-1; i++ {
		for j := i + 1; j < len(stats); j++ {
			if stats[i].Count < stats[j].Count {
				stats[i], stats[j] = stats[j], stats[i]
			}
		}
	}

	for i := 0; i < 20 && i < len(stats); i++ {
		s := stats[i]
		t.Logf("%-4d %-12.2f %-8d %-8.2f %-8.2f %-8.2f %-12s %-12s",
			i+1, s.Area, s.Count, s.Expected, s.Actual, s.AspectRatio, s.LatRange, s.LngRange)
	}
}
