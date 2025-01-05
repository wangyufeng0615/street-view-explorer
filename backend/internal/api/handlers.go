package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/services"
)

type Handlers struct {
	locationService *services.LocationService
	aiService       *services.AIService
}

func NewHandlers(locationService *services.LocationService, aiService *services.AIService) *Handlers {
	return &Handlers{
		locationService: locationService,
		aiService:       aiService,
	}
}

// 获取随机位置
func (h *Handlers) GetRandomLocation(c *gin.Context) {
	// 获取会话 ID
	sessionID := c.GetHeader("X-Session-ID")
	if sessionID == "" {
		sessionID = c.ClientIP()
	}

	// 根据探索偏好获取随机位置
	loc, err := h.locationService.GetRandomLocationWithPreference(sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"location": loc,
		},
	})
}

// 获取位置描述
func (h *Handlers) GetLocationDescription(c *gin.Context) {
	panoID := c.Param("panoId")
	if panoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Missing location ID",
		})
		return
	}

	// Get language from query parameter, default to "zh"
	language := c.DefaultQuery("lang", "zh")

	loc, err := h.locationService.GetLocation(panoID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	desc, err := h.aiService.GetDescriptionForLocation(loc, language)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"description": desc,
			"language":    language,
		},
	})
}

// SetExplorationPreference 设置探索偏好
func (h *Handlers) SetExplorationPreference(c *gin.Context) {
	var req struct {
		Interest string `json:"interest" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求参数",
		})
		return
	}

	// 获取会话 ID
	sessionID := c.GetHeader("X-Session-ID")
	if sessionID == "" {
		sessionID = c.ClientIP() // 如果没有会话 ID，使用客户端 IP
	}

	// 设置探索偏好
	if err := h.locationService.SetExplorationPreference(sessionID, req.Interest); err != nil {
		// 所有错误都返回 200 状态码，由前端处理
		if err.Error() == "无法理解该探索兴趣" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"error":   "抱歉，我们无法理解您输入的探索兴趣。建议您尝试更具体的主题，例如：日本传统建筑、欧洲古堡、热带海滩、美国国家公园等。",
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "探索偏好设置成功",
	})
}

// DeleteExplorationPreference 删除探索偏好
func (h *Handlers) DeleteExplorationPreference(c *gin.Context) {
	// 获取会话 ID
	sessionID := c.GetHeader("X-Session-ID")
	if sessionID == "" {
		sessionID = c.ClientIP()
	}

	// 删除探索偏好
	if err := h.locationService.DeleteExplorationPreference(sessionID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "删除探索偏好失败",
			"detail":  err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "探索偏好已成功删除",
	})
}
