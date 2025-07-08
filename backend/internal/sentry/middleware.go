package sentry

import (
	"fmt"
	"net/http"
	"time"

	"github.com/getsentry/sentry-go"
	sentrygin "github.com/getsentry/sentry-go/gin"
	"github.com/gin-gonic/gin"
)

// Middleware returns a Gin middleware for Sentry integration
func Middleware(repanic bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Create a hub for this request
		hub := sentrygin.GetHubFromContext(c)
		if hub == nil {
			hub = sentry.CurrentHub().Clone()
		}
		c.Set("sentry", hub)

		// Start a transaction for performance monitoring
		span := sentry.StartSpan(c.Request.Context(), "http.server",
			sentry.WithTransactionName(fmt.Sprintf("%s %s", c.Request.Method, c.FullPath())),
		)
		defer span.Finish()

		// Store span in context
		c.Request = c.Request.WithContext(span.Context())

		// Add request information to scope
		hub.Scope().SetRequest(c.Request)
		hub.Scope().SetTag("http.method", c.Request.Method)
		hub.Scope().SetTag("http.url", c.Request.URL.Path)
		hub.Scope().SetTag("http.client_ip", c.ClientIP())
		hub.Scope().SetTag("user_agent", c.Request.UserAgent())

		// Add session ID if available
		if sessionID := c.GetHeader("X-Session-ID"); sessionID != "" {
			hub.Scope().SetUser(sentry.User{
				ID: sessionID,
			})
		}

		// Process request
		defer func() {
			if err := recover(); err != nil {
				// Capture panic
				hub.WithScope(func(scope *sentry.Scope) {
					scope.SetLevel(sentry.LevelFatal)
					scope.SetContext("gin", sentry.Context{
						"method":     c.Request.Method,
						"path":       c.Request.URL.Path,
						"client_ip":  c.ClientIP(),
						"user_agent": c.Request.UserAgent(),
					})
					hub.RecoverWithContext(c.Request.Context(), err)
				})

				if repanic {
					panic(err)
				}
				c.AbortWithStatus(http.StatusInternalServerError)
			}
		}()

		// Record request start time
		startTime := time.Now()

		// Process the request
		c.Next()

		// Record request duration
		duration := time.Since(startTime)

		// Set span data based on response
		span.SetTag("http.status_code", fmt.Sprintf("%d", c.Writer.Status()))
		span.SetData("http.response.status_code", c.Writer.Status())
		span.SetData("http.request.duration", duration.Milliseconds())

		// Capture errors if any
		if len(c.Errors) > 0 {
			for _, err := range c.Errors {
				hub.WithScope(func(scope *sentry.Scope) {
					scope.SetLevel(sentry.LevelError)
					scope.SetContext("gin.errors", sentry.Context{
						"errors": c.Errors.JSON(),
					})
					scope.SetContext("request", sentry.Context{
						"method":     c.Request.Method,
						"path":       c.Request.URL.Path,
						"query":      c.Request.URL.Query(),
						"client_ip":  c.ClientIP(),
						"user_agent": c.Request.UserAgent(),
						"status":     c.Writer.Status(),
					})
					hub.CaptureException(err.Err)
				})
			}
		}

		// Capture non-200 responses as breadcrumbs
		if c.Writer.Status() >= 400 {
			hub.AddBreadcrumb(&sentry.Breadcrumb{
				Type:     "http",
				Category: "request",
				Message:  fmt.Sprintf("%s %s [%d]", c.Request.Method, c.Request.URL.Path, c.Writer.Status()),
				Level:    sentry.LevelWarning,
				Data: map[string]interface{}{
					"status_code": c.Writer.Status(),
					"method":      c.Request.Method,
					"url":         c.Request.URL.String(),
				},
			}, nil)
		}
	}
}

// TestSentry provides a test endpoint for Sentry integration
func TestSentry() gin.HandlerFunc {
	return func(c *gin.Context) {
		hub := sentrygin.GetHubFromContext(c)
		if hub == nil {
			// Try getting from context
			if h, exists := c.Get("sentry"); exists {
				hub = h.(*sentry.Hub)
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{
					"success": false,
					"error":   "Sentry hub not found",
				})
				return
			}
		}

		// Test 1: Capture a message
		messageID := hub.CaptureMessage("Sentry test message from backend")

		// Test 2: Capture an error
		testErr := fmt.Errorf("sentry test error from backend")
		errorID := hub.CaptureException(testErr)

		// Test 3: Add breadcrumb
		hub.AddBreadcrumb(&sentry.Breadcrumb{
			Message:  "Test breadcrumb",
			Category: "test",
			Level:    sentry.LevelInfo,
			Data: map[string]interface{}{
				"test": true,
			},
		}, nil)

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "Sentry test completed",
			"data": map[string]interface{}{
				"message_id": messageID,
				"error_id":   errorID,
			},
		})
	}
}
