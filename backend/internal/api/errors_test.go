package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/utils"
)

func TestReportableErrorMessagePreservesSafeErrorCause(t *testing.T) {
	err := utils.SafeError(
		utils.ErrorTypeExternal,
		"AI 描述生成失败",
		errors.New("OpenRouter request failed with status 503"),
	)

	if got := PublicErrorMessage(err); got != "AI 描述生成失败" {
		t.Fatalf("PublicErrorMessage() = %q, want safe user message", got)
	}

	got := reportableErrorMessage(err)
	if !strings.Contains(got, "OpenRouter request failed with status 503") {
		t.Fatalf("reportableErrorMessage() lost underlying cause: %q", got)
	}
}

func TestReportableErrorMessageRedactsSecrets(t *testing.T) {
	t.Setenv("AI_API_KEY", "secret-openrouter-key")
	err := utils.SafeError(
		utils.ErrorTypeExternal,
		"AI 描述生成失败",
		errors.New("authorization=Bearer secret-openrouter-key"),
	)

	got := reportableErrorMessage(err)
	if strings.Contains(got, "secret-openrouter-key") {
		t.Fatalf("reportableErrorMessage() leaked secret: %q", got)
	}
	if !strings.Contains(got, "[redacted]") {
		t.Fatalf("reportableErrorMessage() missing redaction marker: %q", got)
	}
}

func TestErrorHandlerIgnoresInvalidSentryContextValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(ErrorHandler())
	router.GET("/fails", func(c *gin.Context) {
		c.Set("sentry", "invalid-hub")
		_ = c.Error(errors.New("boom"))
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/fails", nil))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body: %s", response.Code, response.Body.String())
	}
}
