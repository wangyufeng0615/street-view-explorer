package utils

import (
	"fmt"
	"log"
)

// 全局地图数据管理器
var globalMapManager *MapDataManager

// init 包初始化函数，程序启动时自动执行
func init() {
	// 创建地图数据管理器
	globalMapManager = NewMapDataManager()

	// 确保世界地图数据存在
	if err := globalMapManager.EnsureWorldMapData(); err != nil {
		log.Printf("警告：初始化世界地图数据失败: %v", err)
		log.Printf("程序将继续运行，但地图相关功能可能受影响")
	} else {
		// 获取并显示地图数据信息
		info, err := globalMapManager.GetMapDataInfo()
		if err != nil {
			log.Printf("获取地图数据信息失败: %v", err)
		} else {
			if exists, ok := info["exists"].(bool); ok && exists {
				sizeKB, _ := info["size_kb"].(float64)
				featuresCount, _ := info["features_count"].(int)
				fmt.Printf("✓ 世界地图数据已就绪 (%.1f KB, %d 个特征)\n", sizeKB, featuresCount)
			}
		}
	}

	// 确保小型岛屿数据存在
	if err := globalMapManager.EnsureMinorIslandsData(); err != nil {
		log.Printf("警告：初始化小型岛屿数据失败: %v", err)
		log.Printf("程序将继续运行，但小型岛屿数据不可用")
	} else {
		// 尝试获取小型岛屿数据信息
		minorIslandsData, err := globalMapManager.LoadMinorIslandsData()
		if err != nil {
			log.Printf("获取小型岛屿数据信息失败: %v", err)
		} else {
			fmt.Printf("✓ 小型岛屿数据已就绪 (%d 个岛屿)\n", len(minorIslandsData.Features))
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
