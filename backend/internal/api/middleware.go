package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/utils"
	"github.com/redis/go-redis/v9"
)

// RateLimitMiddleware 实现基于 Redis 的请求限流
func RateLimitMiddleware(redisClient *redis.Client) gin.HandlerFunc {
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
		case "/api/v1/preferences/exploration":
			// 探索偏好设置：正常不会频繁调用
			maxRequests = 30 // 每分钟30次
			window = 60 * time.Second
		default:
			maxRequests = 200 // 默认限制
			window = 60 * time.Second
		}

		// 使用 Redis 实现计数器
		key := "ratelimit:" + clientIP + ":" + endpoint
		count, err := redisClient.Incr(c.Request.Context(), key).Result()
		if err != nil {
			c.Next() // Redis 错误时不阻止请求
			return
		}

		// 设置过期时间
		if count == 1 {
			if err := redisClient.Expire(c.Request.Context(), key, window).Err(); err != nil {
				c.Next()
				return
			}
		}

		if count > int64(maxRequests) {
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
func UserRateLimitMiddleware(redisClient *redis.Client) gin.HandlerFunc {
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
		userMaxRequests := 60      // 每用户每小时60次（平均每分钟1次）
		userWindow := time.Hour    // 1小时窗口
		
		// 全局限流配置（防止API费用爆炸）
		globalMaxRequests := 2000  // 全局每小时2000次
		globalWindow := time.Hour  // 1小时窗口

		// 检查用户级别限流
		userKey := "user_ratelimit:preference:" + sessionID
		userCount, err := redisClient.Incr(c.Request.Context(), userKey).Result()
		if err != nil {
			c.Next()
			return
		}

		// 设置用户级别过期时间
		if userCount == 1 {
			redisClient.Expire(c.Request.Context(), userKey, userWindow)
		}

		// 检查全局限流
		globalKey := "global_ratelimit:preference"
		globalCount, err := redisClient.Incr(c.Request.Context(), globalKey).Result()
		if err != nil {
			c.Next()
			return
		}

		// 设置全局过期时间
		if globalCount == 1 {
			redisClient.Expire(c.Request.Context(), globalKey, globalWindow)
		}

		// 检查是否超过用户限制
		if userCount > int64(userMaxRequests) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   "您的探索偏好设置过于频繁，请稍后再试（每小时最多60次）",
			})
			c.Abort()
			return
		}

		// 检查是否超过全局限制
		if globalCount > int64(globalMaxRequests) {
			// 记录日志以便监控
			logger := utils.APILogger()
			logger.Error("global_ratelimit_exceeded", "Global rate limit exceeded for preferences", nil, map[string]interface{}{
				"global_count": globalCount,
				"session_id":   sessionID,
				"client_ip":    c.ClientIP(),
			})
			
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"error":   "服务暂时不可用，请稍后再试",
			})
			c.Abort()
			return
		}

		// 在上下文中设置剩余次数信息
		c.Set("userRateLimitRemaining", userMaxRequests-int(userCount))
		c.Set("globalRateLimitRemaining", globalMaxRequests-int(globalCount))

		c.Next()
	}
}

// CORSMiddleware 实现跨域资源共享控制
func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		// 只允许特定域名
		allowedOrigins := []string{
			"http://localhost:3000",  // 开发环境
			"https://streetview.com", // 生产环境
		}

		for _, allowedOrigin := range allowedOrigins {
			if origin == allowedOrigin {
				c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
				break
			}
		}

		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-ID")
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
			if len(panoID) > 100 || !regexp.MustCompile(`^[a-zA-Z0-9_-]+$`).MatchString(panoID) {
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
			if !regexp.MustCompile(`^[a-zA-Z0-9-_]{32,64}$`).MatchString(sessionID) {
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
		// 只记录失败的请求
		if param.StatusCode >= 400 {
			logger.Error("request_failed", "HTTP request failed", nil, map[string]interface{}{
				"method":     param.Method,
				"path":       param.Path,
				"status":     param.StatusCode,
				"duration":   param.Latency.String(),
				"client_ip":  param.ClientIP,
				"user_agent": param.Request.UserAgent(),
			})
		}

		return "" // 返回空字符串避免重复日志
	})
}
