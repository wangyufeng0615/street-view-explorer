package config

import (
	"os"
	"testing"
)

func TestNew(t *testing.T) {
	// 清理环境变量
	os.Clearenv()

	t.Run("default values", func(t *testing.T) {
		cfg := New()

		if cfg.ServerAddress() != ":8080" {
			t.Errorf("ServerAddress 默认值不正确: %s", cfg.ServerAddress())
		}
		if cfg.SQLitePath() != "data/streetview.db" {
			t.Errorf("SQLitePath 默认值不正确: %s", cfg.SQLitePath())
		}
	})

	t.Run("with env vars", func(t *testing.T) {
		os.Setenv("AI_API_KEY", "test-key")
		os.Setenv("SQLITE_PATH", "/tmp/test.db")

		cfg := New()

		if cfg.OpenAIAPIKey() != "test-key" {
			t.Errorf("OpenAIAPIKey 不正确: %s", cfg.OpenAIAPIKey())
		}
		if cfg.SQLitePath() != "/tmp/test.db" {
			t.Errorf("SQLitePath 不正确: %s", cfg.SQLitePath())
		}
	})
}

func TestRealtimeWebRTCDisabledByDefault(t *testing.T) {
	t.Setenv("REALTIME_WEBRTC_ENABLED", "")
	if New().SecurityConfig().Realtime.WebRTCEnabled {
		t.Fatal("WebRTC should be disabled by default")
	}
	for value, want := range map[string]bool{"true": true, "1": true, "false": false, "nonsense": false} {
		t.Setenv("REALTIME_WEBRTC_ENABLED", value)
		if got := New().SecurityConfig().Realtime.WebRTCEnabled; got != want {
			t.Fatalf("REALTIME_WEBRTC_ENABLED=%q: got %v, want %v", value, got, want)
		}
	}
}
