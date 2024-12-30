package api

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/services"
)

type Handlers struct {
	locationService *services.LocationService
	aiService       *services.AIService
}

func NewHandlers(ls *services.LocationService, ai *services.AIService) *Handlers {
	return &Handlers{locationService: ls, aiService: ai}
}

func (h *Handlers) GetRandomLocation(c *gin.Context) {
	_, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	loc, err := h.locationService.GetRandomLocation()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"location_id": loc.LocationID,
			"latitude":    loc.Latitude,
			"longitude":   loc.Longitude,
			"likes":       loc.Likes,
		},
		"error": nil,
	})
}

func (h *Handlers) Like(c *gin.Context) {
	var req struct {
		LocationID string `json:"location_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	likes, err := h.locationService.LikeLocation(req.LocationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"location_id": req.LocationID,
			"likes":       likes,
		},
		"error": nil,
	})
}

func (h *Handlers) Leaderboard(c *gin.Context) {
	var req struct {
		Page     int `json:"page"`
		PageSize int `json:"page_size"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		req.Page = 1
		req.PageSize = 10
	}
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.PageSize <= 0 {
		req.PageSize = 10
	}

	list, err := h.locationService.GetLeaderboard(req.Page, req.PageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": list, "error": nil})
}

func (h *Handlers) MapLikes(c *gin.Context) {
	list, err := h.locationService.GetAllLikes()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": list, "error": nil})
}

func (h *Handlers) GetLocationDescription(c *gin.Context) {
	var req struct {
		LocationID string `json:"location_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"data":    nil,
			"error":   "无效的请求参数: " + err.Error(),
		})
		return
	}

	loc, err := h.locationService.GetLocationByID(req.LocationID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"data":    nil,
			"error":   "位置不存在: " + err.Error(),
		})
		return
	}

	desc, err := h.aiService.GetDescriptionForLocation(loc)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"data":    nil,
			"error":   "获取位置描述失败: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"location_id": req.LocationID,
			"description": desc,
		},
		"error": nil,
	})
}

func (h *Handlers) GetLocationByID(c *gin.Context) {
	// For future use if needed
	locationID := c.Param("location_id")
	loc, err := h.locationService.GetLocationByID(locationID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "location not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": loc, "error": nil})
}
