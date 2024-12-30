package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/services"
)

func SetupRoutes(r *gin.Engine, ls *services.LocationService, ai *services.AIService) {
	h := NewHandlers(ls, ai)

	// 添加健康检查接口
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Example routes
	r.POST("/random-location", h.GetRandomLocation)
	r.POST("/like", h.Like)
	r.POST("/leaderboard", h.Leaderboard)
	r.POST("/map-likes", h.MapLikes)
	r.POST("/location-description", h.GetLocationDescription)
}
