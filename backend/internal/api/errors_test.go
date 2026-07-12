package api

import (
	"errors"
	"strings"
	"testing"

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
