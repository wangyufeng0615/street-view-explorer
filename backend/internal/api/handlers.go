package api

import (
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/services"
)

// ModeServices groups the location and AI services.
type ModeServices struct {
	LocationService *services.LocationService
	AIService       *services.AIService
}

type Handlers struct {
	global            *ModeServices
	descriptionBudget repositories.RateLimiter
}

func NewHandlers(
	locationService *services.LocationService,
	aiService *services.AIService,
	descriptionBudget ...repositories.RateLimiter,
) *Handlers {
	handlers := &Handlers{
		global: &ModeServices{
			LocationService: locationService,
			AIService:       aiService,
		},
	}
	if len(descriptionBudget) > 0 {
		handlers.descriptionBudget = descriptionBudget[0]
	}
	return handlers
}

// GlobalServices returns the global mode services (used by AgentHandlers).
func (h *Handlers) GlobalServices() *ModeServices {
	return h.global
}

// servicesForMode returns the services for the current request.
func (h *Handlers) servicesForMode(c *gin.Context) *ModeServices {
	return h.global
}

func parseCoordinate(raw string, min, max float64) (float64, error) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, strconv.ErrSyntax
	}
	if value < min || value > max {
		return 0, strconv.ErrRange
	}
	return value, nil
}

// ==================== 辅助方法 ====================

// getSessionID 从上下文获取 sessionID，如果失败则返回空字符串并设置错误响应
func (h *Handlers) getSessionID(c *gin.Context) string {
	sessionIDInterface, exists := c.Get("sessionID")
	if !exists {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "无法获取会话ID",
		})
		return ""
	}
	sessionID, ok := sessionIDInterface.(string)
	if !ok || sessionID == "" {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "无效的会话ID格式",
		})
		return ""
	}
	return sessionID
}

func (h *Handlers) getOptionalSessionID(c *gin.Context) string {
	sessionIDInterface, exists := c.Get("sessionID")
	if !exists {
		return ""
	}
	sessionID, ok := sessionIDInterface.(string)
	if !ok {
		return ""
	}
	return sessionID
}

// parseIntParam 解析整数参数，失败则返回默认值
func parseIntParam(c *gin.Context, key string, defaultValue int) int {
	value := c.DefaultQuery(key, "")
	if value == "" {
		return defaultValue
	}
	result, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return defaultValue
	}
	minValue := 1
	if defaultValue == 0 {
		minValue = 0
	}
	if result < minValue {
		return defaultValue
	}
	return result
}
