package utils

// 全局地图数据管理器
var globalMapManager *MapDataManager

// init 包初始化函数，程序启动时自动执行
func init() {
	// 创建地图数据管理器
	globalMapManager = NewMapDataManager()
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
