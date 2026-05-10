package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	atlasVoiceProviderOpenAI = "openai"
	atlasVoiceProviderDoubao = "doubao"

	defaultDoubaoTTSEndpoint   = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
	defaultDoubaoTTSResourceID = "seed-tts-2.0"
	defaultDoubaoTTSSpeaker    = "zh_male_m191_uranus_bigtts"
	defaultDoubaoTTSFormat     = "pcm"
	defaultDoubaoTTSSampleRate = 24000
)

type realtimeVoiceConfigResponse struct {
	Provider         string `json:"provider"`
	DoubaoConfigured bool   `json:"doubao_configured"`
	DoubaoSpeaker    string `json:"doubao_speaker,omitempty"`
	DoubaoFormat     string `json:"doubao_format,omitempty"`
	DoubaoSampleRate int    `json:"doubao_sample_rate,omitempty"`
}

type doubaoTTSRequest struct {
	Text     string `json:"text"`
	Language string `json:"language"`
}

type doubaoTTSUpstreamRequest struct {
	User     doubaoTTSUser      `json:"user"`
	UniqueID string             `json:"unique_id"`
	Params   doubaoTTSReqParams `json:"req_params"`
}

type doubaoTTSUser struct {
	UID string `json:"uid"`
}

type doubaoTTSReqParams struct {
	Text        string               `json:"text"`
	Speaker     string               `json:"speaker"`
	AudioParams doubaoTTSAudioParams `json:"audio_params"`
	Additions   string               `json:"additions,omitempty"`
	MixSpeaker  map[string]any       `json:"mix_speaker,omitempty"`
}

type doubaoTTSAudioParams struct {
	Format       string  `json:"format"`
	SampleRate   int     `json:"sample_rate"`
	SpeechRate   int     `json:"speech_rate,omitempty"`
	LoudnessRate int     `json:"loudness_rate,omitempty"`
	Emotion      string  `json:"emotion,omitempty"`
	EmotionScale float64 `json:"emotion_scale,omitempty"`
}

type doubaoTTSAdditions struct {
	DisableMarkdownFilter bool   `json:"disable_markdown_filter"`
	EnableLanguageDetect  bool   `json:"enable_language_detector"`
	ExplicitLanguage      string `json:"explicit_language,omitempty"`
}

type doubaoTTSStreamChunk struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

func (h *RealtimeHandlers) GetVoiceConfig(c *gin.Context) {
	config := doubaoTTSConfigFromEnv()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": realtimeVoiceConfigResponse{
			Provider:         atlasVoiceProvider(),
			DoubaoConfigured: config.configured(),
			DoubaoSpeaker:    config.Speaker,
			DoubaoFormat:     config.Format,
			DoubaoSampleRate: config.SampleRate,
		},
	})
}

func (h *RealtimeHandlers) SynthesizeDoubaoTTS(c *gin.Context) {
	config := doubaoTTSConfigFromEnv()
	if err := config.validate(); err != nil {
		log.Printf("[ATLAS_VOICE] tts_rejected provider=doubao configured=%t err=%v", config.configured(), err)
		code := "doubao_tts_error"
		if !config.configured() {
			code = "doubao_tts_missing_credentials"
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"code":    code,
			"error":   err.Error(),
		})
		return
	}

	var request doubaoTTSRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid Doubao TTS request",
		})
		return
	}
	text := strings.TrimSpace(request.Text)
	if text == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Missing text for Doubao TTS",
		})
		return
	}
	if len([]rune(text)) > 900 {
		text = string([]rune(text)[:900])
	}

	startedAt := time.Now()
	charCount := len([]rune(text))
	log.Printf(
		"[ATLAS_VOICE] tts_start provider=doubao chars=%d lang=%s speaker=%s resource=%s format=%s sample_rate=%d",
		charCount,
		doubaoExplicitLanguage(request.Language),
		config.Speaker,
		config.ResourceID,
		config.Format,
		config.SampleRate,
	)

	c.Header("Content-Type", "application/x-ndjson; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)

	if err := h.streamDoubaoTTS(c, config, text, request.Language); err != nil {
		log.Printf(
			"[ATLAS_VOICE] tts_error provider=doubao chars=%d duration=%s err=%v",
			charCount,
			time.Since(startedAt).Round(time.Millisecond),
			err,
		)
		writeDoubaoTTSLine(c.Writer, gin.H{
			"type":  "error",
			"error": err.Error(),
		})
		return
	}
	log.Printf("[ATLAS_VOICE] tts_done provider=doubao chars=%d duration=%s", charCount, time.Since(startedAt).Round(time.Millisecond))
}

func (h *RealtimeHandlers) streamDoubaoTTS(c *gin.Context, config doubaoTTSConfig, text string, language string) error {
	requestID := uuid.NewString()
	additionsJSON, err := json.Marshal(doubaoTTSAdditions{
		DisableMarkdownFilter: true,
		EnableLanguageDetect:  true,
		ExplicitLanguage:      doubaoExplicitLanguage(language),
	})
	if err != nil {
		return err
	}

	payload := doubaoTTSUpstreamRequest{
		User:     doubaoTTSUser{UID: hashedSafetyIdentifier(c)},
		UniqueID: requestID,
		Params: doubaoTTSReqParams{
			Text:    text,
			Speaker: config.Speaker,
			AudioParams: doubaoTTSAudioParams{
				Format:       config.Format,
				SampleRate:   config.SampleRate,
				SpeechRate:   config.SpeechRate,
				LoudnessRate: config.LoudnessRate,
				Emotion:      config.Emotion,
				EmotionScale: config.EmotionScale,
			},
			Additions: string(additionsJSON),
		},
	}

	reqJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		config.Endpoint,
		bytes.NewReader(reqJSON),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Resource-Id", config.ResourceID)
	req.Header.Set("X-Api-Request-Id", requestID)
	if config.APIKey != "" {
		req.Header.Set("X-Api-Key", config.APIKey)
	} else {
		if config.AppID != "" {
			req.Header.Set("X-Api-App-Id", config.AppID)
		}
		if config.AppKey != "" {
			req.Header.Set("X-Api-App-Key", config.AppKey)
		}
		if config.AccessKey != "" {
			req.Header.Set("X-Api-Access-Key", config.AccessKey)
			req.Header.Set("Authorization", "Bearer;"+config.AccessKey)
		}
	}

	client := h.doubaoTTSClient
	if client == nil {
		client = newDoubaoTTSHTTPClient()
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to reach Doubao TTS API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("Doubao TTS API returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}

	writeDoubaoTTSLine(c.Writer, gin.H{
		"type":        "start",
		"request_id":  requestID,
		"format":      config.Format,
		"sample_rate": config.SampleRate,
		"log_id":      resp.Header.Get("X-Tt-Logid"),
	})

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}

		var chunk doubaoTTSStreamChunk
		if err := json.Unmarshal(line, &chunk); err != nil {
			return fmt.Errorf("failed to decode Doubao TTS stream chunk: %w", err)
		}

		audioBase64 := rawJSONString(chunk.Data)
		if audioBase64 != "" {
			writeDoubaoTTSLine(c.Writer, gin.H{
				"type":        "audio_delta",
				"delta":       audioBase64,
				"format":      config.Format,
				"sample_rate": config.SampleRate,
			})
		}

		if chunk.Code == 20000000 {
			writeDoubaoTTSLine(c.Writer, gin.H{
				"type":    "done",
				"message": chunk.Message,
			})
			return nil
		}
		if chunk.Code > 0 {
			message := strings.TrimSpace(chunk.Message)
			if message == "" {
				message = fmt.Sprintf("Doubao TTS stream error code %d", chunk.Code)
			}
			return errors.New(message)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("failed to read Doubao TTS stream: %w", err)
	}

	writeDoubaoTTSLine(c.Writer, gin.H{"type": "done"})
	return nil
}

func writeDoubaoTTSLine(w gin.ResponseWriter, payload gin.H) {
	line, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_, _ = w.Write(append(line, '\n'))
	w.Flush()
}

func rawJSONString(raw json.RawMessage) string {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return ""
	}
	return strings.TrimSpace(text)
}

type doubaoTTSConfig struct {
	Endpoint     string
	APIKey       string
	AppID        string
	AppKey       string
	AccessKey    string
	ResourceID   string
	Speaker      string
	Format       string
	SampleRate   int
	SpeechRate   int
	LoudnessRate int
	Emotion      string
	EmotionScale float64
}

func (c doubaoTTSConfig) configured() bool {
	return c.APIKey != "" || ((c.AppID != "" || c.AppKey != "") && c.AccessKey != "")
}

func (c doubaoTTSConfig) validate() error {
	if !c.configured() {
		return errors.New("Doubao TTS is not configured. Set DOUBAO_TTS_API_KEY, or DOUBAO_TTS_APP_ID plus DOUBAO_TTS_ACCESS_KEY/DOUBAO_TTS_TOKEN")
	}
	if c.Format != "pcm" {
		return errors.New("Atlas Doubao voice currently supports pcm output only")
	}
	return nil
}

func doubaoTTSConfigFromEnv() doubaoTTSConfig {
	return doubaoTTSConfig{
		Endpoint:     envFirstNonEmpty(defaultDoubaoTTSEndpoint, "DOUBAO_TTS_ENDPOINT", "VOLCENGINE_TTS_ENDPOINT"),
		APIKey:       envFirstNonEmpty("", "DOUBAO_TTS_API_KEY", "DOUBAO_API_KEY", "VOLCENGINE_TTS_API_KEY", "VOLCENGINE_API_KEY", "VOLC_TTS_API_KEY", "VOLC_API_KEY", "TTS_API_KEY"),
		AppID:        envFirstNonEmpty("", "DOUBAO_TTS_APP_ID", "DOUBAO_TTS_APPID", "VOLCENGINE_TTS_APP_ID", "VOLCENGINE_TTS_APPID"),
		AppKey:       envFirstNonEmpty("", "DOUBAO_TTS_APP_KEY", "VOLCENGINE_TTS_APP_KEY"),
		AccessKey:    envFirstNonEmpty("", "DOUBAO_TTS_ACCESS_KEY", "DOUBAO_TTS_ACCESS_TOKEN", "DOUBAO_TTS_TOKEN", "DOUBAO_ACCESS_KEY", "DOUBAO_TOKEN", "VOLCENGINE_TTS_ACCESS_KEY", "VOLCENGINE_TTS_TOKEN", "VOLC_ACCESS_KEY", "VOLC_ACCESS_TOKEN"),
		ResourceID:   envFirstNonEmpty(defaultDoubaoTTSResourceID, "DOUBAO_TTS_RESOURCE_ID", "VOLCENGINE_TTS_RESOURCE_ID"),
		Speaker:      envFirstNonEmpty(defaultDoubaoTTSSpeaker, "DOUBAO_TTS_SPEAKER", "DOUBAO_TTS_VOICE_TYPE", "VOLCENGINE_TTS_SPEAKER"),
		Format:       strings.ToLower(envFirstNonEmpty(defaultDoubaoTTSFormat, "DOUBAO_TTS_FORMAT", "DOUBAO_TTS_ENCODING", "VOLCENGINE_TTS_FORMAT")),
		SampleRate:   envInt(defaultDoubaoTTSSampleRate, "DOUBAO_TTS_SAMPLE_RATE", "VOLCENGINE_TTS_SAMPLE_RATE"),
		SpeechRate:   envInt(0, "DOUBAO_TTS_SPEECH_RATE"),
		LoudnessRate: envInt(0, "DOUBAO_TTS_LOUDNESS_RATE"),
		Emotion:      envFirstNonEmpty("", "DOUBAO_TTS_EMOTION"),
		EmotionScale: envFloat(0, "DOUBAO_TTS_EMOTION_SCALE"),
	}
}

func atlasVoiceProvider() string {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("ATLAS_VOICE_PROVIDER")))
	if provider == "" {
		provider = strings.ToLower(strings.TrimSpace(os.Getenv("VOICE_AUDIO_PROVIDER")))
	}
	switch provider {
	case atlasVoiceProviderDoubao:
		return atlasVoiceProviderDoubao
	default:
		return atlasVoiceProviderOpenAI
	}
}

func doubaoExplicitLanguage(language string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(language)), "zh") {
		return "zh-cn"
	}
	return ""
}

func envFirstNonEmpty(fallback string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return fallback
}

func envInt(fallback int, keys ...string) int {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value == "" {
			continue
		}
		parsed, err := strconv.Atoi(value)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func envFloat(fallback float64, keys ...string) float64 {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value == "" {
			continue
		}
		parsed, err := strconv.ParseFloat(value, 64)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func doubaoProxyFunc() func(*http.Request) (*url.URL, error) {
	if proxyURLStr := strings.TrimSpace(os.Getenv("DOUBAO_TTS_PROXY_URL")); proxyURLStr != "" {
		proxyURL, err := url.Parse(proxyURLStr)
		if err != nil {
			return nil
		}
		return http.ProxyURL(proxyURL)
	}
	return realtimeProxyFunc()
}

func newDoubaoTTSHTTPClient() *http.Client {
	transport := &http.Transport{Proxy: doubaoProxyFunc()}
	if transport.Proxy == nil {
		transport.Proxy = http.ProxyFromEnvironment
	}
	return &http.Client{
		Transport: transport,
		Timeout:   45 * time.Second,
	}
}
