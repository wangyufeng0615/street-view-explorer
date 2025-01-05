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

			// 获取特定位置
			locations.GET("/:panoId", h.GetLocation)

			// 获取位置描述
			locations.GET("/:panoId/description", h.GetLocationDescription)

			// 点赞位置
			locations.POST("/:panoId/like", h.LikeLocation)

			// 获取排行榜
			locations.GET("/leaderboard", h.GetLeaderboard)

			// 按国家获取位置
			locations.GET("/country/:country", h.GetLocationsByCountry)

			// 按城市获取位置
			locations.GET("/city/:city", h.GetLocationsByCity)
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
