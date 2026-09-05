package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/utils"
)

// 预编译正则表达式（性能优化）
var (
	panoIDRegex    = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
	sessionIDRegex = regexp.MustCompile(`^[a-zA-Z0-9-_]{32,64}$`)
)

func isCostSensitiveEndpoint(endpoint string) bool {
	switch endpoint {
	case "/api/v1/locations/random",
		"/api/v1/locations/search",
		"/api/v1/locations/:panoId/description",
		"/api/v1/locations/:panoId/detailed-description",
		"/api/v1/locations/:panoId/streetview-frame",
		"/api/v1/geo/ai-guess",
		"/api/v1/geo/satellite",
		"/api/v1/geo/online/rooms/:roomId/image",
		"/api/v1/realtime/client-secret",
		"/api/v1/realtime/calls",
		"/api/v1/realtime/ws",
		"/api/v1/realtime/doubao-tts":
		return true
	default:
		return false
	}
}

// RateLimitMiddleware 实现基于限流器的请求限流
func RateLimitMiddleware(rateLimiter repositories.RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		clientIP := c.ClientIP()
		endpoint := c.FullPath()

		// 针对不同端点设置不同的限流规则
		var maxRequests int
		var window time.Duration
		switch endpoint {
		case "/api/v1/locations/random":
			maxRequests = 120 // 每分钟120次，约2秒一次
			window = 60 * time.Second
		case "/api/v1/locations/search":
			maxRequests = 45 // Google Places/Geocoding 查询，避免语音误触发刷接口
			window = 60 * time.Second
		case "/api/v1/geo/ai-guess":
			maxRequests = 30 // AI 视觉猜测成本较高，限制自动刷接口
			window = 60 * time.Second
		case "/api/v1/geo/satellite",
			"/api/v1/geo/online/rooms/:roomId/image":
			maxRequests = 180 // 静态地图代理会消耗 Google Maps 配额
			window = 60 * time.Second
		case "/api/v1/locations/:panoId/streetview-frame":
			maxRequests = 60 // Atlas 视觉上下文；防止自动旋转意外刷图
			window = 60 * time.Second
		case "/api/v1/locations/:panoId/description":
			maxRequests = 12
			window = 60 * time.Second
		case "/api/v1/locations/:panoId/detailed-description":
			maxRequests = 6
			window = 60 * time.Second
		case "/api/v1/realtime/client-secret",
			"/api/v1/realtime/calls",
			"/api/v1/realtime/ws",
			"/api/v1/realtime/doubao-tts":
			maxRequests = 20 // Realtime sessions can spend OpenAI audio quota quickly
			window = 60 * time.Second
		case "/api/v1/realtime/voice-config":
			maxRequests = 120
			window = 60 * time.Second
		case "/api/v1/preferences/exploration":
			// 探索偏好设置：正常不会频繁调用
			maxRequests = 30 // 每分钟30次
			window = 60 * time.Second
		default:
			maxRequests = 200 // 默认限制
			window = 60 * time.Second
		}

		// 使用限流器检查
		key := "ratelimit:" + clientIP + ":" + endpoint
		allowed, _, err := rateLimiter.CheckAndIncrement(key, maxRequests, window)
		if err != nil {
			if isCostSensitiveEndpoint(endpoint) {
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"success": false,
					"error":   "成本保护暂时不可用，请稍后再试",
				})
				c.Abort()
				return
			}
			c.Next() // 限流器错误时不阻止请求
			return
		}

		if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   "请求过于频繁，请稍后再试",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// UserRateLimitMiddleware 实现基于用户会话的请求限流（探索偏好专用）
func UserRateLimitMiddleware(rateLimiter repositories.RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 仅对探索偏好相关端点生效
		endpoint := c.FullPath()
		if endpoint != "/api/v1/preferences/exploration" {
			c.Next()
			return
		}

		// 获取会话ID
		sessionIDInterface, exists := c.Get("sessionID")
		if !exists {
			c.Next()
			return
		}
		sessionID, ok := sessionIDInterface.(string)
		if !ok || sessionID == "" {
			c.Next()
			return
		}

		// 每个用户的限流配置
		userMaxRequests := 60   // 每用户每小时60次（平均每分钟1次）
		userWindow := time.Hour // 1小时窗口

		// 全局限流配置（防止API费用爆炸）
		globalMaxRequests := 2000 // 全局每小时2000次
		globalWindow := time.Hour // 1小时窗口

		// 检查用户级别限流
		userKey := "user_ratelimit:preference:" + sessionID
		userAllowed, userRemaining, err := rateLimiter.CheckAndIncrement(userKey, userMaxRequests, userWindow)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"error":   "成本保护暂时不可用，请稍后再试",
			})
			c.Abort()
			return
		}

		// 检查全局限流
		globalKey := "global_ratelimit:preference"
		globalAllowed, globalRemaining, err := rateLimiter.CheckAndIncrement(globalKey, globalMaxRequests, globalWindow)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"error":   "成本保护暂时不可用，请稍后再试",
			})
			c.Abort()
			return
		}

		// 检查是否超过用户限制
		if !userAllowed {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   "您的探索偏好设置过于频繁，请稍后再试（每小时最多60次）",
			})
			c.Abort()
			return
		}

		// 检查是否超过全局限制
		if !globalAllowed {
			// 记录日志以便监控
			logger := utils.APILogger()
			logger.Error("global_ratelimit_exceeded", "Global rate limit exceeded for preferences", nil, map[string]interface{}{
				"session_id": sessionID,
				"client_ip":  c.ClientIP(),
			})

			c.JSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"error":   "服务暂时不可用，请稍后再试",
			})
			c.Abort()
			return
		}

		// 在上下文中设置剩余次数信息
		c.Set("userRateLimitRemaining", userRemaining)
		c.Set("globalRateLimitRemaining", globalRemaining)

		c.Next()
	}
}

// CORSMiddleware 实现跨域资源共享控制
func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		// 只允许特定域名
		allowedOrigins := []string{
			"http://localhost:3000",        // 开发环境
			"https://earth.wangyufeng.org", // 生产环境
		}

		for _, allowedOrigin := range allowedOrigins {
			if origin == allowedOrigin {
				c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
				break
			}
		}

		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Session-ID")
		c.Writer.Header().Set("Access-Control-Max-Age", "86400") // 24小时

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// InputValidationMiddleware 实现输入验证
func InputValidationMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 验证请求大小
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024*1024)
		if c.Request.ContentLength > 1024*1024 { // 1MB
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{
				"success": false,
				"error":   "请求体过大",
			})
			c.Abort()
			return
		}

		// 验证路径参数
		if panoID := c.Param("panoId"); panoID != "" {
			if len(panoID) > 100 || !panoIDRegex.MatchString(panoID) {
				c.JSON(http.StatusBadRequest, gin.H{
					"success": false,
					"error":   "无效的位置ID格式",
				})
				c.Abort()
				return
			}
		}

		// 验证查询参数
		if page := c.Query("page"); page != "" {
			if pageNum, err := strconv.Atoi(page); err != nil || pageNum < 1 || pageNum > 1000 {
				c.JSON(http.StatusBadRequest, gin.H{
					"success": false,
					"error":   "无效的页码",
				})
				c.Abort()
				return
			}
		}

		c.Next()
	}
}

// SessionMiddleware 实现会话管理
func SessionMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID := c.GetHeader("X-Session-ID")

		// 验证会话ID格式
		if sessionID != "" {
			if !sessionIDRegex.MatchString(sessionID) {
				c.JSON(http.StatusBadRequest, gin.H{
					"success": false,
					"error":   "无效的会话ID",
				})
				c.Abort()
				return
			}
		} else {
			// 生成新的会话ID
			sessionID = generateSecureSessionID()
			c.Header("X-Session-ID", sessionID)
		}

		c.Set("sessionID", sessionID)
		c.Next()
	}
}

// generateSecureSessionID 生成安全的会话ID
func generateSecureSessionID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return ""
	}
	return hex.EncodeToString(b)
}

// RequestLoggingMiddleware 记录请求日志
func RequestLoggingMiddleware() gin.HandlerFunc {
	logger := utils.APILogger()

	return gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		if param.StatusCode >= 400 {
			logger.Error("request_failed", "HTTP request failed", nil, map[string]interface{}{
				"method":     param.Method,
				"path":       param.Request.URL.Path,
				"status":     param.StatusCode,
				"duration":   param.Latency.String(),
				"client_ip":  param.ClientIP,
				"user_agent": param.Request.UserAgent(),
			})
		} else if strings.HasPrefix(param.Request.URL.Path, "/api/v1/agent/") {
			// Log successful agent requests for observability
			logger.Info("agent_request", "Agent API request", map[string]interface{}{
				"method":   param.Method,
				"path":     param.Request.URL.Path,
				"status":   param.StatusCode,
				"duration": param.Latency.String(),
			})
		}

		return ""
	})
}
