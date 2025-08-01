package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/services"
	"github.com/my-streetview-project/backend/internal/utils"
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
	// 从 gin.Context 获取会话 ID (由 SessionMiddleware 设置)
	sessionIDInterface, exists := c.Get("sessionID")
	if !exists {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "无法获取会话ID"})
		return
	}
	sessionID, ok := sessionIDInterface.(string)
	if !ok || sessionID == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "无效的会话ID格式"})
		return
	}

	// Get language from query parameter, default to "en" (align with frontend default)
	language := c.DefaultQuery("lang", "en")

	// 获取随机位置（自动处理用户偏好）
	loc, err := h.locationService.GetRandomLocation(sessionID, language)
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

	startTime := time.Now()
	logger := utils.APILogger()

	desc, err := h.aiService.GetDescriptionForLocation(loc, language)
	if err != nil {
		duration := time.Since(startTime)
		statusCode := http.StatusInternalServerError

		if strings.Contains(err.Error(), "超时") || strings.Contains(err.Error(), "timeout") {
			statusCode = http.StatusRequestTimeout
		}

		logger.Error("get_description_failed", "Failed to get AI description", err, map[string]interface{}{
			"pano_id":  panoID,
			"language": language,
			"duration": duration.String(),
			"status":   statusCode,
		})

		c.JSON(statusCode, gin.H{
			"success":  false,
			"error":    err.Error(),
			"duration": duration.String(),
		})
		return
	}

	// 验证描述内容是否有效
	if desc == "" || strings.TrimSpace(desc) == "" {
		duration := time.Since(startTime)
		logger.Error("empty_description", "AI generated empty description", nil, map[string]interface{}{
			"pano_id":     panoID,
			"language":    language,
			"duration":    duration.String(),
			"desc_length": len(desc),
		})

		c.JSON(http.StatusInternalServerError, gin.H{
			"success":  false,
			"error":    "AI生成的描述为空，请重试",
			"duration": duration.String(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"description": desc,
			"language":    language,
			"duration":    time.Since(startTime).String(),
		},
	})
}

// 获取位置详细描述
func (h *Handlers) GetLocationDetailedDescription(c *gin.Context) {
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

	startTime := time.Now()
	logger := utils.APILogger()

	desc, err := h.aiService.GetDetailedDescriptionForLocation(loc, language)
	if err != nil {
		duration := time.Since(startTime)
		statusCode := http.StatusInternalServerError
		errorMsg := err.Error()

		if strings.Contains(errorMsg, "超时") || strings.Contains(errorMsg, "timeout") {
			statusCode = http.StatusRequestTimeout
		} else if strings.Contains(errorMsg, "没有找到基础对话历史") {
			statusCode = http.StatusBadRequest
		}

		logger.Error("get_detailed_description_failed", "Failed to get detailed AI description", err, map[string]interface{}{
			"pano_id":  panoID,
			"language": language,
			"duration": time.Since(startTime).String(),
			"status":   statusCode,
		})

		c.JSON(statusCode, gin.H{
			"success":  false,
			"error":    errorMsg,
			"duration": duration.String(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"description": desc,
			"language":    language,
			"duration":    time.Since(startTime).String(),
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

	// 从 gin.Context 获取会话 ID (由 SessionMiddleware 设置)
	sessionIDInterface, exists := c.Get("sessionID")
	if !exists {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "无法获取会话ID"})
		return
	}
	sessionID, ok := sessionIDInterface.(string)
	if !ok || sessionID == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "无效的会话ID格式"})
		return
	}

	// 获取语言参数，默认为英文
	language := c.DefaultQuery("lang", "en")

	// 设置探索偏好
	if err := h.locationService.SetExplorationPreference(sessionID, req.Interest); err != nil {
		// 所有错误都返回 200 状态码，由前端处理
		if err.Error() == "无法理解该探索兴趣" {
			errorMsg := "抱歉，我们无法理解您输入的探索兴趣。建议您尝试更具体的主题，例如：日本传统建筑、欧洲古堡、热带海滩、美国国家公园等。"

			// 根据语言提供对应的错误消息
			if language == "en" {
				errorMsg = "Sorry, we couldn't understand your exploration interest. Please try more specific topics, such as: traditional Japanese architecture, European castles, tropical beaches, US national parks, etc."
			}

			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"error":   errorMsg,
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	// 根据语言设置成功消息
	successMsg := "探索偏好设置成功"
	if language == "en" {
		successMsg = "Exploration preference set successfully"
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": successMsg,
	})
}

// DeleteExplorationPreference 删除探索偏好
func (h *Handlers) DeleteExplorationPreference(c *gin.Context) {
	// 从 gin.Context 获取会话 ID (由 SessionMiddleware 设置)
	sessionIDInterface, exists := c.Get("sessionID")
	if !exists {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "无法获取会话ID"})
		return
	}
	sessionID, ok := sessionIDInterface.(string)
	if !ok || sessionID == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "无效的会话ID格式"})
		return
	}

	// 获取语言参数，默认为英文
	language := c.DefaultQuery("lang", "en")

	// 删除探索偏好
	if err := h.locationService.DeleteExplorationPreference(sessionID); err != nil {
		errorMsg := "删除探索偏好失败"
		if language == "en" {
			errorMsg = "Failed to delete exploration preference"
		}

		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   errorMsg,
			"detail":  err.Error(),
		})
		return
	}

	// 根据语言设置成功消息
	successMsg := "探索偏好已成功删除"
	if language == "en" {
		successMsg = "Exploration preference successfully deleted"
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": successMsg,
	})
}
