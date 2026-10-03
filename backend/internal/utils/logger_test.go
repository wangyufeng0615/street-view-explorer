package utils

import (
	"bytes"
	"errors"
	"log"
	"os"
	"strings"
	"testing"
)

func TestLoggerErrorIncludesRedactedCause(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	cause := errors.New(`Get "https://maps.googleapis.com/maps/api/geocode/json?key=AIzaSECRET123": context deadline exceeded`)
	NewLogger("ai").Error("description_context_failed", "Failed to prepare context",
		NewAppError(ErrorTypeExternal, "获取位置信息失败", cause))

	out := buf.String()
	if !strings.Contains(out, "context deadline exceeded") {
		t.Fatalf("log line lost the underlying cause: %s", out)
	}
	if strings.Contains(out, "AIzaSECRET123") {
		t.Fatalf("log line leaked the API key: %s", out)
	}
}
