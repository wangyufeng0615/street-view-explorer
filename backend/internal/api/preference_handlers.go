package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// SetExplorationPreference 设置探索偏好
func (h *Handlers) SetExplorationPreference(c *gin.Context) {
	sessionID := h.getSessionID(c)
	if sessionID == "" {
		return
	}

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

	// 获取语言参数，默认为英文
	language := c.DefaultQuery("lang", "en")

	svc := h.servicesForMode(c)

	// 设置探索偏好
	if err := svc.LocationService.SetExplorationPreference(sessionID, req.Interest); err != nil {
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
			"error":   PublicErrorMessage(err),
		})
		return
	}

	// 根据语言设置成功消息
	successMsg := "探索偏好设置成功"
	if language == "en" {
		successMsg = "Exploration preference set successfully"
	}

	// 获取剩余速率限制信息（可选）
	response := gin.H{
		"success": true,
		"message": successMsg,
	}

	// 如果有速率限制信息，添加到响应中
	if userRemaining, exists := c.Get("userRateLimitRemaining"); exists {
		response["rate_limit"] = gin.H{
			"user_remaining": userRemaining,
		}
		if globalRemaining, exists := c.Get("globalRateLimitRemaining"); exists {
			response["rate_limit"].(gin.H)["global_remaining"] = globalRemaining
		}
	}

	c.JSON(http.StatusOK, response)
}

// DeleteExplorationPreference 删除探索偏好
func (h *Handlers) DeleteExplorationPreference(c *gin.Context) {
	sessionID := h.getSessionID(c)
	if sessionID == "" {
		return
	}

	// 获取语言参数，默认为英文
	language := c.DefaultQuery("lang", "en")

	svc := h.servicesForMode(c)

	// 删除探索偏好
	if err := svc.LocationService.DeleteExplorationPreference(sessionID); err != nil {
		errorMsg := "删除探索偏好失败"
		if language == "en" {
			errorMsg = "Failed to delete exploration preference"
		}
		CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
			"operation": "delete_exploration_preference",
			"language":  language,
		})

		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   errorMsg,
			"detail":  PublicErrorMessage(err),
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
