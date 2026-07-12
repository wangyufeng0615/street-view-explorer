package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/getsentry/sentry-go"
	sentrygin "github.com/getsentry/sentry-go/gin"
	"github.com/gin-gonic/gin"
	mysentry "github.com/my-streetview-project/backend/internal/sentry"
	"github.com/my-streetview-project/backend/internal/utils"
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

func PublicErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	return mysentry.RedactSensitiveString(err.Error())
}

// reportableErrorMessage keeps the public response safe while preserving the
// redacted underlying cause for Sentry. AppError.Error intentionally returns
// only UserMsg, which previously collapsed unrelated upstream failures into a
// single, unactionable issue such as "AI 描述生成失败".
func reportableErrorMessage(err error) string {
	if err == nil {
		return ""
	}

	var appErr *utils.AppError
	if errors.As(err, &appErr) && strings.TrimSpace(appErr.InternalMsg) != "" {
		return mysentry.RedactSensitiveString(appErr.InternalMsg)
	}
	return mysentry.RedactSensitiveString(err.Error())
}

func CaptureHandlerError(c *gin.Context, err error, status int, contexts map[string]interface{}) {
	if err == nil || status < http.StatusInternalServerError {
		return
	}
	// A disconnected browser/curl request is not a backend incident. Streaming
	// callbacks surface the request cancellation as an error, so reporting it
	// creates noisy false-positive AI failures.
	if errors.Is(err, context.Canceled) || errors.Is(c.Request.Context().Err(), context.Canceled) {
		return
	}

	hub := sentrygin.GetHubFromContext(c)
	if hub == nil {
		if h, exists := c.Get("sentry"); exists {
			if typedHub, ok := h.(*sentry.Hub); ok {
				hub = typedHub
			}
		}
	}
	if hub == nil {
		return
	}

	hub.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(sentry.LevelError)
		scope.SetTag("http.status_code", fmt.Sprintf("%d", status))
		scope.SetContext("request", sentry.Context{
			"method":     c.Request.Method,
			"path":       c.Request.URL.Path,
			"query":      mysentry.RedactSensitiveString(c.Request.URL.RawQuery),
			"user_agent": c.Request.UserAgent(),
			"status":     status,
		})
		for key, value := range contexts {
			scope.SetContext(key, sentry.Context{
				"data": mysentry.RedactSensitiveValue(value),
			})
		}
		hub.CaptureException(errors.New(reportableErrorMessage(err)))
	})
	c.Set(mysentry.ErrorReportedKey, true)
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
					if typedHub, ok := h.(*sentry.Hub); ok {
						hub = typedHub
					}
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
