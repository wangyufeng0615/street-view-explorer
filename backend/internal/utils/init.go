package utils


// 全局地图数据管理器
var globalMapManager *MapDataManager

// init 包初始化函数，程序启动时自动执行
func init() {
	// 创建地图数据管理器
	globalMapManager = NewMapDataManager()

	logger := SystemLogger()
	
	// 确保世界地图数据存在
	if err := globalMapManager.EnsureWorldMapData(); err != nil {
		logger.Warn("map_data_init_failed", "Failed to initialize world map data", map[string]interface{}{
			"error": err.Error(),
		})
	} else {
		// 获取并显示地图数据信息
		info, err := globalMapManager.GetMapDataInfo()
		if err != nil {
			logger.Error("map_data_info_failed", "Failed to get map data info", err)
		} else {
			if exists, ok := info["exists"].(bool); ok && exists {
				sizeKB, _ := info["size_kb"].(float64)
				featuresCount, _ := info["features_count"].(int)
				logger.Info("map_data_ready", "World map data initialized", map[string]interface{}{
					"size_kb":         sizeKB,
					"features_count":  featuresCount,
				})
			}
		}
	}

	// 确保小型岛屿数据存在
	if err := globalMapManager.EnsureMinorIslandsData(); err != nil {
		logger.Warn("minor_islands_init_failed", "Failed to initialize minor islands data", map[string]interface{}{
			"error": err.Error(),
		})
	} else {
		// 尝试获取小型岛屿数据信息
		minorIslandsData, err := globalMapManager.LoadMinorIslandsData()
		if err != nil {
			logger.Error("minor_islands_load_failed", "Failed to load minor islands data", err)
		} else {
			islandCount := len(minorIslandsData.Features)
			logger.Info("minor_islands_ready", "Minor islands data initialized", map[string]interface{}{
				"island_count": islandCount,
			})
		}
	}
}

// GetGlobalMapManager 获取全局地图数据管理器
func GetGlobalMapManager() *MapDataManager {
	return globalMapManager
}

// EnsureMapDataReady 确保地图数据就绪（供其他包调用）
func EnsureMapDataReady() error {
	if globalMapManager == nil {
		globalMapManager = NewMapDataManager()
	}
	return globalMapManager.EnsureWorldMapData()
}
