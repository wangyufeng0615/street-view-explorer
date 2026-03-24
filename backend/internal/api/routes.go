package api

import (
	"github.com/gin-gonic/gin"
)

func SetupRoutes(r *gin.Engine, h *Handlers) {
	// API 版本组
	v1 := r.Group("/api/v1")
	{
		// 位置相关 (公开)
		locations := v1.Group("/locations")
		{
			locations.GET("/random", h.GetRandomLocation)
			locations.GET("/lookup", h.LookupLocation)
			locations.GET("/:panoId/description", h.GetLocationDescription)
			locations.GET("/:panoId/detailed-description", h.GetLocationDetailedDescription)
		}

		// 访问记录
		v1.GET("/visits", h.GetVisitHistory)

		// 探索偏好相关 (基于 sessionID)
		preferences := v1.Group("/preferences")
		{
			preferences.POST("/exploration", h.SetExplorationPreference)
			preferences.POST("/exploration/remove", h.DeleteExplorationPreference)
		}
	}
}
