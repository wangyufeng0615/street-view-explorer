package api

import (
	"net/http"
	"testing"
)

func TestRealtimeOriginAllowsLocalDevelopment(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "http://localhost:8080/api/v1/realtime/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "localhost:8080"
	req.Header.Set("Origin", "http://127.0.0.1:3100")

	if !isAllowedRealtimeOrigin(req) {
		t.Fatal("local dev origin should be allowed")
	}
}

func TestRealtimeOriginRejectsUnknownBrowserOrigin(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://earth.wangyufeng.org/api/v1/realtime/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "earth.wangyufeng.org"
	req.Header.Set("Origin", "https://example.com")

	if isAllowedRealtimeOrigin(req) {
		t.Fatal("unknown cross-site origin should be rejected")
	}
}

func TestRealtimeOriginAllowsSameOrigin(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://earth.wangyufeng.org/api/v1/realtime/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "earth.wangyufeng.org"
	req.Header.Set("Origin", "https://earth.wangyufeng.org")

	if !isAllowedRealtimeOrigin(req) {
		t.Fatal("same origin should be allowed")
	}
}

func TestAtlasVoiceProviderDefaultsToOpenAI(t *testing.T) {
	t.Setenv("ATLAS_VOICE_PROVIDER", "")
	t.Setenv("VOICE_AUDIO_PROVIDER", "")

	if got := atlasVoiceProvider(); got != atlasVoiceProviderOpenAI {
		t.Fatalf("atlasVoiceProvider() = %q, want %q", got, atlasVoiceProviderOpenAI)
	}
}

func TestAtlasVoiceProviderCanUseDoubao(t *testing.T) {
	t.Setenv("ATLAS_VOICE_PROVIDER", "doubao")
	t.Setenv("VOICE_AUDIO_PROVIDER", "")

	if got := atlasVoiceProvider(); got != atlasVoiceProviderDoubao {
		t.Fatalf("atlasVoiceProvider() = %q, want %q", got, atlasVoiceProviderDoubao)
	}
}

func TestRealtimeTurnDetectionDefaultsToHighSemanticVAD(t *testing.T) {
	t.Setenv("OPENAI_REALTIME_VAD_TYPE", "")
	t.Setenv("REALTIME_VAD_TYPE", "")
	t.Setenv("OPENAI_REALTIME_VAD_EAGERNESS", "")
	t.Setenv("REALTIME_VAD_EAGERNESS", "")

	config := realtimeTurnDetectionConfig()
	if config.Type != "semantic_vad" {
		t.Fatalf("Type = %q, want semantic_vad", config.Type)
	}
	if config.Eagerness != "high" {
		t.Fatalf("Eagerness = %q, want high", config.Eagerness)
	}
	if !config.CreateResponse || !config.InterruptResponse {
		t.Fatal("semantic VAD should create and interrupt responses")
	}
}

func TestRealtimeTurnDetectionCanUseFastServerVAD(t *testing.T) {
	t.Setenv("OPENAI_REALTIME_VAD_TYPE", "server_vad")
	t.Setenv("OPENAI_REALTIME_VAD_THRESHOLD", "1.5")
	t.Setenv("OPENAI_REALTIME_VAD_PREFIX_PADDING_MS", "180")
	t.Setenv("OPENAI_REALTIME_VAD_SILENCE_DURATION_MS", "280")

	config := realtimeTurnDetectionConfig()
	if config.Type != "server_vad" {
		t.Fatalf("Type = %q, want server_vad", config.Type)
	}
	if config.Threshold == nil || *config.Threshold != 1 {
		t.Fatalf("Threshold = %v, want 1", config.Threshold)
	}
	if config.PrefixPaddingMS == nil || *config.PrefixPaddingMS != 180 {
		t.Fatalf("PrefixPaddingMS = %v, want 180", config.PrefixPaddingMS)
	}
	if config.SilenceDurationMS == nil || *config.SilenceDurationMS != 280 {
		t.Fatalf("SilenceDurationMS = %v, want 280", config.SilenceDurationMS)
	}
}

func TestRealtimeFunctionOutputSummaryKeepsOnlySafeFields(t *testing.T) {
	success, action := realtimeFunctionOutputSummary(`{"success":true,"action":"wandered_nearby","location":"private address"}`)

	if success != "true" {
		t.Fatalf("success = %q, want true", success)
	}
	if action != "wandered_nearby" {
		t.Fatalf("action = %q, want wandered_nearby", action)
	}
}

func TestDoubaoTTSConfigReadsCredentials(t *testing.T) {
	t.Setenv("DOUBAO_TTS_API_KEY", "test-api-key")
	t.Setenv("DOUBAO_TTS_SPEAKER", "zh_male_xiaotian_jupiter_bigtts")
	t.Setenv("DOUBAO_TTS_SPEECH_RATE", "-8")

	config := doubaoTTSConfigFromEnv()
	if !config.configured() {
		t.Fatal("expected Doubao TTS config to be configured")
	}
	if config.Speaker != "zh_male_xiaotian_jupiter_bigtts" {
		t.Fatalf("Speaker = %q", config.Speaker)
	}
	if config.SpeechRate != -8 {
		t.Fatalf("SpeechRate = %d, want -8", config.SpeechRate)
	}
}

func TestDoubaoTTSConfigReadsAPIKeyAliases(t *testing.T) {
	t.Setenv("VOLCENGINE_API_KEY", "test-volcengine-api-key")

	config := doubaoTTSConfigFromEnv()
	if !config.configured() {
		t.Fatal("expected Doubao TTS config to be configured from VOLCENGINE_API_KEY")
	}
	if config.APIKey != "test-volcengine-api-key" {
		t.Fatalf("APIKey = %q", config.APIKey)
	}
}

func TestDoubaoTTSConfigReadsAppIDAndTokenAliases(t *testing.T) {
	t.Setenv("DOUBAO_TTS_APPID", "test-app-id")
	t.Setenv("DOUBAO_TTS_TOKEN", "test-access-token")

	config := doubaoTTSConfigFromEnv()
	if !config.configured() {
		t.Fatal("expected Doubao TTS config to be configured from APPID and TOKEN aliases")
	}
	if config.AppID != "test-app-id" {
		t.Fatalf("AppID = %q", config.AppID)
	}
	if config.AccessKey != "test-access-token" {
		t.Fatalf("AccessKey = %q", config.AccessKey)
	}
}
