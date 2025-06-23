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
	"github.com/redis/go-redis/v9"
	"github.com/my-streetview-project/backend/internal/utils"
)

// RateLimitMiddleware 实现基于 Redis 的请求限流
func RateLimitMiddleware(redisClient *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		clientIP := c.ClientIP()
		endpoint := c.FullPath()

		// 针对不同端点设置不同的限流规则
		var maxRequests int
		switch endpoint {
		case "/api/v1/locations/random":
			maxRequests = 30 // 每分钟
		default:
			maxRequests = 100 // 默认限制
		}

		// 使用 Redis 实现计数器
		key := "ratelimit:" + clientIP + ":" + endpoint
		count, err := redisClient.Incr(c.Request.Context(), key).Result()
		if err != nil {
			c.Next() // Redis 错误时不阻止请求
			return
		}

		// 设置过期时间（60秒）
		if count == 1 {
			if err := redisClient.Expire(c.Request.Context(), key, 60*time.Second).Err(); err != nil {
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
		// 只记录关键请求信息，避免过于详细
		if param.StatusCode >= 400 {
			logger.Error("request_failed", "HTTP request failed", nil, map[string]interface{}{
				"method":     param.Method,
				"path":       param.Path,
				"status":     param.StatusCode,
				"duration":   param.Latency.String(),
				"client_ip":  param.ClientIP,
				"user_agent": param.Request.UserAgent(),
			})
		} else if param.Path == "/api/v1/locations/random" || strings.Contains(param.Path, "/description") {
			// 只记录核心API的成功请求
			logger.LogRequest("request_success", param.Latency, map[string]interface{}{
				"method":    param.Method,
				"path":      param.Path,
				"status":    param.StatusCode,
				"client_ip": param.ClientIP,
			})
		}
		
		return "" // 返回空字符串避免重复日志
	})
}
