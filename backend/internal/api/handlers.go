package api

import (
	"net/http"
	"strconv"

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

	// 生成位置描述
	desc, err := h.aiService.GetDescriptionForLocation(loc)
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
			"location":    loc,
			"description": desc,
		},
	})
}

// 点赞位置
func (h *Handlers) LikeLocation(c *gin.Context) {
	panoID := c.Param("panoId")
	if panoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "缺少位置ID",
		})
		return
	}

	likes, err := h.locationService.LikeLocation(panoID)
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
			"likes": likes,
		},
	})
}

// 获取排行榜
func (h *Handlers) GetLeaderboard(c *gin.Context) {
	pageStr := c.DefaultQuery("page", "1")
	pageSizeStr := c.DefaultQuery("pageSize", "10")

	pageInt := 1
	if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
		pageInt = p
	}

	pageSizeInt := 10
	if ps, err := strconv.Atoi(pageSizeStr); err == nil && ps > 0 {
		pageSizeInt = ps
	}

	locations, err := h.locationService.GetLeaderboard(pageInt, pageSizeInt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    locations,
	})
}

// 获取位置信息
func (h *Handlers) GetLocation(c *gin.Context) {
	panoID := c.Param("panoId")
	if panoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "缺少位置ID",
		})
		return
	}

	loc, err := h.locationService.GetLocation(panoID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    loc,
	})
}

// 获取位置描述
func (h *Handlers) GetLocationDescription(c *gin.Context) {
	panoID := c.Param("panoId")
	if panoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "缺少位置ID",
		})
		return
	}

	loc, err := h.locationService.GetLocation(panoID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	desc, err := h.aiService.GetDescriptionForLocation(loc)
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
		},
	})
}

// 按国家获取位置列表
func (h *Handlers) GetLocationsByCountry(c *gin.Context) {
	country := c.Param("country")
	if country == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "缺少国家参数",
		})
		return
	}

	locations, err := h.locationService.GetLocationsByCountry(country)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    locations,
	})
}

// 按城市获取位置列表
func (h *Handlers) GetLocationsByCity(c *gin.Context) {
	city := c.Param("city")
	if city == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "缺少城市参数",
		})
		return
	}

	locations, err := h.locationService.GetLocationsByCity(city)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    locations,
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
