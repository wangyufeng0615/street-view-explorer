package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/repositories"
	mysentry "github.com/my-streetview-project/backend/internal/sentry"
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
		"/api/v1/locations/address",
		"/api/v1/locations/lookup",
		"/api/v1/locations/:panoId/description",
		"/api/v1/locations/:panoId/detailed-description",
		"/api/v1/locations/:panoId/streetview-frame",
		"/api/v1/geo/ai-guess",
		"/api/v1/geo/satellite",
		"/api/v1/geo/online/rooms/:roomId/image",
		"/api/v1/geo/online/rooms",
		"/api/v1/geo/online/rooms/join",
		"/api/v1/geo/online/rooms/:roomId/ready",
		"/api/v1/realtime/client-secret",
		"/api/v1/realtime/calls",
		"/api/v1/realtime/ws",
		"/api/v1/realtime/doubao-tts":
		return true
	default:
		return false
	}
}

// rateLimitCheckTimeout bounds how long a request waits for the SQLite-backed
// limiter. The database has a single connection, so without a deadline one
// slow query would stall every request queued behind it.
const rateLimitCheckTimeout = 2 * time.Second

// contextRateLimiter is implemented by limiters that honour cancellation.
type contextRateLimiter interface {
	CheckAndIncrementContext(ctx context.Context, key string, maxRequests int, window time.Duration) (bool, int, error)
}

// rateLimitRefunder is implemented by limiters that can return a unit of budget.
type rateLimitRefunder interface {
	RefundContext(ctx context.Context, key string) error
}

// checkRateLimit prefers the context-aware limiter so a stalled database or a
// disconnected client does not hold the request forever.
func checkRateLimit(c *gin.Context, limiter repositories.RateLimiter, key string, maxRequests int, window time.Duration) (bool, int, error) {
	if ctxLimiter, ok := limiter.(contextRateLimiter); ok {
		ctx, cancel := context.WithTimeout(c.Request.Context(), rateLimitCheckTimeout)
		defer cancel()
		return ctxLimiter.CheckAndIncrementContext(ctx, key, maxRequests, window)
	}
	return limiter.CheckAndIncrement(key, maxRequests, window)
}

// refundRateLimit best-effort returns one unit of budget, e.g. after an
// upstream failure. The request context may already be cancelled, so it uses
// its own short deadline.
func refundRateLimit(limiter repositories.RateLimiter, key string) {
	refunder, ok := limiter.(rateLimitRefunder)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), rateLimitCheckTimeout)
	defer cancel()
	_ = refunder.RefundContext(ctx, key)
}

// rateLimitRule is the per-IP limit for one route.
type rateLimitRule struct {
	scope       string
	maxRequests int
	window      time.Duration
}

// rateLimitRuleFor returns the per-IP rule for a route. Most limits are keyed
// by route; the matchmaking POST is keyed by method so the frequent GET
// polling on the same path is not throttled by the join limit.
func rateLimitRuleFor(method, endpoint string) rateLimitRule {
	minute := 60 * time.Second
	switch endpoint {
	case "/api/v1/locations/random":
		return rateLimitRule{endpoint, 120, minute} // 每分钟120次，约2秒一次
	case "/api/v1/locations/search":
		return rateLimitRule{endpoint, 45, minute} // Google Places/Geocoding 查询，避免语音误触发刷接口
	case "/api/v1/locations/address":
		return rateLimitRule{endpoint, 30, minute} // 只在切换界面语言时调用一次反向地理编码
	case "/api/v1/locations/lookup":
		return rateLimitRule{endpoint, 30, minute} // 分享链接、地图选点：每次一次计费的反向地理编码，外加最多十次街景元数据查询
	case "/api/v1/geo/ai-guess":
		return rateLimitRule{endpoint, 30, minute} // AI 视觉猜测成本较高，限制自动刷接口
	case "/api/v1/geo/satellite",
		"/api/v1/geo/online/rooms/:roomId/image":
		return rateLimitRule{endpoint, 180, minute} // 静态地图代理会消耗 Google Maps 配额
	case "/api/v1/geo/online/rooms",
		"/api/v1/geo/online/rooms/join",
		"/api/v1/geo/online/rooms/:roomId/ready":
		return rateLimitRule{endpoint, 20, minute} // 开房/加入/准备会触发备题，放大 Google 调用
	case "/api/v1/geo/online/matchmaking":
		if method == http.MethodPost {
			return rateLimitRule{method + " " + endpoint, 20, minute}
		}
	case "/api/v1/locations/:panoId/streetview-frame":
		return rateLimitRule{endpoint, 60, minute} // Atlas 视觉上下文；防止自动旋转意外刷图
	case "/api/v1/locations/:panoId/description":
		return rateLimitRule{endpoint, 12, minute}
	case "/api/v1/locations/:panoId/detailed-description":
		return rateLimitRule{endpoint, 6, minute}
	case "/api/v1/realtime/client-secret",
		"/api/v1/realtime/calls",
		"/api/v1/realtime/ws",
		"/api/v1/realtime/doubao-tts":
		return rateLimitRule{endpoint, 20, minute} // Realtime sessions can spend OpenAI audio quota quickly
	case "/api/v1/realtime/voice-config":
		return rateLimitRule{endpoint, 120, minute}
	case "/api/v1/preferences/exploration":
		return rateLimitRule{endpoint, 30, minute} // 探索偏好设置：正常不会频繁调用
	}
	return rateLimitRule{endpoint, 200, minute} // 默认限制
}

// RateLimitMiddleware 实现基于限流器的请求限流
func RateLimitMiddleware(rateLimiter repositories.RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		clientIP := c.ClientIP()
		endpoint := c.FullPath()
		rule := rateLimitRuleFor(c.Request.Method, endpoint)

		// 使用限流器检查
		key := "ratelimit:" + clientIP + ":" + rule.scope
		allowed, _, err := checkRateLimit(c, rateLimiter, key, rule.maxRequests, rule.window)
		if err != nil {
			costSensitive := isCostSensitiveEndpoint(endpoint) ||
				(endpoint == "/api/v1/geo/online/matchmaking" && c.Request.Method == http.MethodPost)
			if costSensitive {
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

		// 全局限流配置（防止API费用爆炸）；单个 IP 最多用掉四分之一，
		// 避免换 session 的单个来源耗尽全站额度
		globalMaxRequests := 2000 // 全局每小时2000次
		globalWindow := time.Hour // 1小时窗口
		ipMaxRequests := globalMaxRequests / 4

		unavailable := func() {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"success": false,
				"error":   "成本保护暂时不可用，请稍后再试",
			})
			c.Abort()
		}

		// 检查用户级别限流；被拒的请求不再消耗 IP 和全局额度
		userKey := "user_ratelimit:preference:" + sessionID
		userAllowed, userRemaining, err := checkRateLimit(c, rateLimiter, userKey, userMaxRequests, userWindow)
		if err != nil {
			unavailable()
			return
		}
		if !userAllowed {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   "您的探索偏好设置过于频繁，请稍后再试（每小时最多60次）",
			})
			c.Abort()
			return
		}

		ipKey := "ip_ratelimit:preference:" + c.ClientIP()
		ipAllowed, _, err := checkRateLimit(c, rateLimiter, ipKey, ipMaxRequests, globalWindow)
		if err != nil {
			unavailable()
			return
		}
		if !ipAllowed {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"success": false,
				"error":   "当前网络的探索偏好设置过于频繁，请稍后再试",
			})
			c.Abort()
			return
		}

		// 检查全局限流
		globalKey := "global_ratelimit:preference"
		globalAllowed, globalRemaining, err := checkRateLimit(c, rateLimiter, globalKey, globalMaxRequests, globalWindow)
		if err != nil {
			unavailable()
			return
		}

		// 检查是否超过全局限制
		if !globalAllowed {
			// 记录日志以便监控
			logger := utils.APILogger()
			logger.Error("global_ratelimit_exceeded", "Global rate limit exceeded for preferences", nil, map[string]interface{}{
				"session_id": mysentry.HashSessionID(sessionID),
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
