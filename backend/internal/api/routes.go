package api

import (
	"github.com/gin-gonic/gin"
)

func SetupRoutes(r *gin.Engine, h *Handlers) {
	// API 版本组
	v1 := r.Group("/api/v1")
	{
		// 位置相关
		locations := v1.Group("/locations")
		{
			// 获取随机位置
			locations.GET("/random", h.GetRandomLocation)

			// 获取位置描述
			locations.GET("/:panoId/description", h.GetLocationDescription)
		}

		// 探索偏好相关
		preferences := v1.Group("/preferences")
		{
			// 设置探索偏好
			preferences.POST("/exploration", h.SetExplorationPreference)
			// 删除探索偏好（改用 POST 方法）
			preferences.POST("/exploration/remove", h.DeleteExplorationPreference)
		}
	}
}
