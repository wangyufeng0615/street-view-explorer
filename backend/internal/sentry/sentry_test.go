package sentry

import (
	"strings"
	"testing"
)

func TestRedactSensitiveString(t *testing.T) {
	t.Setenv("GOOGLE_API_KEY", "AIza-secret-value")

	input := `Get "https://maps.googleapis.com/maps/api/geocode/json?key=AIza-secret-value&latlng=1,2": authorization=Bearer abc123`
	got := RedactSensitiveString(input)

	if strings.Contains(got, "AIza-secret-value") || strings.Contains(got, "abc123") {
		t.Fatalf("redacted string still contains a secret: %q", got)
	}
	if !strings.Contains(got, "key=[redacted]") || !strings.Contains(got, "authorization=[redacted]") {
		t.Fatalf("redacted string missing redaction markers: %q", got)
	}
}

func TestRedactSensitiveValue(t *testing.T) {
	value := map[string]interface{}{
		"query":  "token=secret-token&lang=zh",
		"nested": map[string]interface{}{"api_key": "direct-secret"},
		"items":  []interface{}{"client_secret=hidden"},
		"ok":     "public",
	}

	got := RedactSensitiveValue(value).(map[string]interface{})

	if got["ok"] != "public" {
		t.Fatalf("public value changed unexpectedly: %#v", got["ok"])
	}
	if got["nested"].(map[string]interface{})["api_key"] != "[redacted]" {
		t.Fatalf("sensitive nested key was not redacted: %#v", got["nested"])
	}
	if strings.Contains(got["query"].(string), "secret-token") {
		t.Fatalf("query secret was not redacted: %#v", got["query"])
	}
}

func TestDefaultTracesSampleRate(t *testing.T) {
	if got := defaultTracesSampleRate("production"); got != 0.1 {
		t.Fatalf("production default sample rate = %v, want 0.1", got)
	}
	if got := defaultTracesSampleRate("development"); got != 1.0 {
		t.Fatalf("development default sample rate = %v, want 1.0", got)
	}
}
