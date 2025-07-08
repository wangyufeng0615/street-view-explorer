package api

import (
	"fmt"
	"log"
	"net/http"

	"github.com/getsentry/sentry-go"
	sentrygin "github.com/getsentry/sentry-go/gin"
	"github.com/gin-gonic/gin"
)

// ErrorResponse 定义统一的错误响应结构
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error 实现 error 接口
func (e *ErrorResponse) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// NewErrorResponse 创建新的错误响应
func NewErrorResponse(code, message string) *ErrorResponse {
	return &ErrorResponse{
		Code:    code,
		Message: message,
	}
}

// 预定义错误类型
var (
	ErrInvalidInput = &ErrorResponse{
		Code:    "INVALID_INPUT",
		Message: "输入参数无效",
	}
	ErrInternalServer = &ErrorResponse{
		Code:    "INTERNAL_ERROR",
		Message: "服务器内部错误",
	}
	ErrRateLimitExceeded = &ErrorResponse{
		Code:    "RATE_LIMIT_EXCEEDED",
		Message: "请求过于频繁，请稍后再试",
	}
	ErrUnauthorized = &ErrorResponse{
		Code:    "UNAUTHORIZED",
		Message: "未授权的访问",
	}
	ErrResourceNotFound = &ErrorResponse{
		Code:    "NOT_FOUND",
		Message: "请求的资源不存在",
	}
)

// ErrorHandler 统一错误处理中间件
func ErrorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if len(c.Errors) > 0 {
			err := c.Errors.Last()

			// Send error to Sentry
			hub := sentrygin.GetHubFromContext(c)
			if hub == nil {
				// Try getting from context
				if h, exists := c.Get("sentry"); exists {
					hub = h.(*sentry.Hub)
				}
			}

			if hub != nil {
				hub.WithScope(func(scope *sentry.Scope) {
					// Set error context
					scope.SetContext("request", sentry.Context{
						"method":     c.Request.Method,
						"path":       c.Request.URL.Path,
						"query":      c.Request.URL.RawQuery,
						"client_ip":  c.ClientIP(),
						"user_agent": c.Request.UserAgent(),
					})

					// Capture the error
					hub.CaptureException(err.Err)
				})
			}

			// 根据错误类型返回适当的响应
			switch e := err.Err.(type) {
			case *ErrorResponse:
				c.JSON(http.StatusBadRequest, gin.H{
					"success": false,
					"error": gin.H{
						"code":    e.Code,
						"message": e.Message,
					},
				})
			default:
				// 记录详细错误日志
				log.Printf("未处理的错误: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"success": false,
					"error": gin.H{
						"code":    ErrInternalServer.Code,
						"message": ErrInternalServer.Message,
					},
				})
			}
		}
	}
}
