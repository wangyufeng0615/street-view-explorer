package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/my-streetview-project/backend/internal/atlas"
)

const (
	defaultRealtimeModel              = "gpt-realtime-2"
	defaultRealtimeVoice              = "cedar"
	defaultRealtimeTranscriptionModel = "gpt-4o-mini-transcribe"
)

type RealtimeHandlers struct {
	httpClient      *http.Client
	doubaoTTSClient *http.Client
}

var realtimeWSUpgrader = websocket.Upgrader{
	CheckOrigin: isAllowedRealtimeOrigin,
}

func NewRealtimeHandlers() *RealtimeHandlers {
	return &RealtimeHandlers{
		httpClient:      newRealtimeHTTPClient(),
		doubaoTTSClient: newDoubaoTTSHTTPClient(),
	}
}

type realtimeClientSecretRequest struct {
	ExpiresAfter realtimeExpiresAfter `json:"expires_after"`
	Session      realtimeSession      `json:"session"`
}

type realtimeExpiresAfter struct {
	Anchor  string `json:"anchor"`
	Seconds int    `json:"seconds"`
}

type realtimeSession struct {
	Type             string        `json:"type"`
	Model            string        `json:"model"`
	OutputModalities []string      `json:"output_modalities"`
	Instructions     string        `json:"instructions"`
	Audio            realtimeAudio `json:"audio"`
	ToolChoice       string        `json:"tool_choice"`
	Tracing          string        `json:"tracing,omitempty"`
}

type realtimeAudio struct {
	Input  realtimeAudioInput   `json:"input"`
	Output *realtimeAudioOutput `json:"output,omitempty"`
}

type realtimeAudioInput struct {
	Transcription realtimeTranscription `json:"transcription"`
	TurnDetection realtimeTurnDetection `json:"turn_detection"`
}

type realtimeTranscription struct {
	Model string `json:"model"`
}

type realtimeTurnDetection struct {
	Type              string   `json:"type"`
	Eagerness         string   `json:"eagerness,omitempty"`
	Threshold         *float64 `json:"threshold,omitempty"`
	PrefixPaddingMS   *int     `json:"prefix_padding_ms,omitempty"`
	SilenceDurationMS *int     `json:"silence_duration_ms,omitempty"`
	CreateResponse    bool     `json:"create_response,omitempty"`
	InterruptResponse bool     `json:"interrupt_response,omitempty"`
}

type realtimeAudioOutput struct {
	Voice string  `json:"voice"`
	Speed float64 `json:"speed"`
}

func (h *RealtimeHandlers) CreateClientSecret(c *gin.Context) {
	apiKey := realtimeAPIKey()
	if apiKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Missing OPENAI_API_KEY or REALTIME_API_KEY for Realtime voice demo",
		})
		return
	}

	model := realtimeModel()
	lang := c.DefaultQuery("lang", "en")
	voice := strings.TrimSpace(os.Getenv("OPENAI_REALTIME_VOICE"))
	if voice == "" {
		voice = defaultRealtimeVoice
	}
	useOpenAIOutputAudio := atlasVoiceProvider() == atlasVoiceProviderOpenAI
	outputModalities := []string{"audio"}
	if !useOpenAIOutputAudio {
		outputModalities = []string{"text"}
	}

	audio := realtimeAudio{
		Input: realtimeAudioInput{
			Transcription: realtimeTranscription{Model: realtimeTranscriptionModel()},
			TurnDetection: realtimeTurnDetectionConfig(),
		},
	}
	log.Printf(
		"[ATLAS_VOICE] client_secret_start provider=%s model=%s output=%s vad=%s lang=%s",
		atlasVoiceProvider(),
		model,
		strings.Join(outputModalities, "+"),
		realtimeTurnDetectionSummary(audio.Input.TurnDetection),
		lang,
	)
	if useOpenAIOutputAudio {
		audio.Output = &realtimeAudioOutput{
			Voice: voice,
			Speed: 1.0,
		}
	}

	reqBody := realtimeClientSecretRequest{
		ExpiresAfter: realtimeExpiresAfter{
			Anchor:  "created_at",
			Seconds: 600,
		},
		Session: realtimeSession{
			Type:             "realtime",
			Model:            model,
			OutputModalities: outputModalities,
			Instructions:     atlasRealtimeInstructions(lang),
			ToolChoice:       "auto",
			Tracing:          "auto",
			Audio:            audio,
		},
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to encode Realtime session request",
		})
		return
	}

	req, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		realtimeAPIBase()+"/realtime/client_secrets",
		bytes.NewReader(reqJSON),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create Realtime session request",
		})
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("OpenAI-Safety-Identifier", hashedSafetyIdentifier(c))

	resp, err := h.httpClient.Do(req)
	if err != nil {
		log.Printf("[ATLAS_VOICE] client_secret_error provider=%s model=%s err=%v", atlasVoiceProvider(), model, err)
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"error":   "Failed to reach OpenAI Realtime API: " + err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"error":   "Failed to read OpenAI Realtime API response",
		})
		return
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"success": false,
			"error":   "OpenAI Realtime API returned a non-JSON response",
		})
		return
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[ATLAS_VOICE] client_secret_error provider=%s model=%s status=%s", atlasVoiceProvider(), model, resp.Status)
		c.JSON(resp.StatusCode, gin.H{
			"success": false,
			"error":   upstreamErrorMessage(payload),
		})
		return
	}
	log.Printf("[ATLAS_VOICE] client_secret_ok provider=%s model=%s status=%s", atlasVoiceProvider(), model, resp.Status)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    payload,
	})
}

func (h *RealtimeHandlers) ProxyCallSDP(c *gin.Context) {
	authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if !strings.HasPrefix(authHeader, "Bearer ") {
		c.String(http.StatusUnauthorized, "Missing Realtime bearer token")
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.String(http.StatusBadRequest, "Failed to read SDP offer")
		return
	}
	if len(bytes.TrimSpace(body)) == 0 {
		c.String(http.StatusBadRequest, "Missing SDP offer")
		return
	}

	req, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		realtimeAPIBase()+"/realtime/calls",
		bytes.NewReader(body),
	)
	if err != nil {
		c.String(http.StatusInternalServerError, "Failed to create Realtime call request")
		return
	}
	req.Header.Set("Authorization", authHeader)
	req.Header.Set("Content-Type", "application/sdp")
	req.Header.Set("OpenAI-Safety-Identifier", hashedSafetyIdentifier(c))

	resp, err := h.httpClient.Do(req)
	if err != nil {
		c.String(http.StatusBadGateway, "Failed to reach OpenAI Realtime API: "+err.Error())
		return
	}
	defer resp.Body.Close()

	answer, err := io.ReadAll(resp.Body)
	if err != nil {
		c.String(http.StatusBadGateway, "Failed to read OpenAI Realtime API response")
		return
	}

	if location := resp.Header.Get("Location"); location != "" {
		c.Header("Location", location)
	}
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), answer)
}

func (h *RealtimeHandlers) ConnectWebSocket(c *gin.Context) {
	apiKey := realtimeAPIKey()
	if apiKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"type":  "error",
			"error": gin.H{"message": "Missing OPENAI_API_KEY or REALTIME_API_KEY for Realtime voice demo"},
		})
		return
	}

	startedAt := time.Now()
	vadConfig := realtimeTurnDetectionConfig()
	log.Printf(
		"[ATLAS_VOICE] ws_connect_start provider=%s model=%s vad=%s origin=%s",
		atlasVoiceProvider(),
		realtimeModel(),
		realtimeTurnDetectionSummary(vadConfig),
		c.GetHeader("Origin"),
	)

	clientConn, err := realtimeWSUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[ATLAS_VOICE] ws_upgrade_error provider=%s model=%s err=%v", atlasVoiceProvider(), realtimeModel(), err)
		return
	}
	defer clientConn.Close()

	targetURL, err := realtimeWebSocketURL()
	if err != nil {
		writeRealtimeWSError(clientConn, "Failed to build Realtime WebSocket URL")
		return
	}

	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+apiKey)
	headers.Set("OpenAI-Safety-Identifier", hashedSafetyIdentifier(c))

	dialer := websocket.Dialer{
		Proxy:            realtimeProxyFunc(),
		HandshakeTimeout: 10 * time.Second,
	}
	upstreamConn, resp, err := dialer.DialContext(c.Request.Context(), targetURL, headers)
	if err != nil {
		message := "Failed to reach OpenAI Realtime WebSocket: " + err.Error()
		if resp != nil && resp.Status != "" {
			message = message + " (" + resp.Status + ")"
		}
		log.Printf("[ATLAS_VOICE] ws_connect_error provider=%s model=%s duration=%s err=%v", atlasVoiceProvider(), realtimeModel(), time.Since(startedAt).Round(time.Millisecond), err)
		writeRealtimeWSError(clientConn, message)
		return
	}
	defer upstreamConn.Close()

	status := ""
	if resp != nil {
		status = resp.Status
	}
	log.Printf("[ATLAS_VOICE] ws_connect_ok provider=%s model=%s status=%s", atlasVoiceProvider(), realtimeModel(), status)

	trace := newRealtimeWSTrace()
	errCh := make(chan realtimeRelayResult, 2)
	go relayRealtimeWS("browser_to_openai", upstreamConn, clientConn, errCh, trace)
	go relayRealtimeWS("openai_to_browser", clientConn, upstreamConn, errCh, trace)
	result := <-errCh
	log.Printf(
		"[ATLAS_VOICE] ws_closed direction=%s duration=%s err=%v",
		result.Direction,
		time.Since(startedAt).Round(time.Millisecond),
		result.Err,
	)
}

type realtimeRelayResult struct {
	Direction string
	Err       error
}

func relayRealtimeWS(direction string, dst, src *websocket.Conn, errCh chan<- realtimeRelayResult, trace *realtimeWSTrace) {
	for {
		messageType, payload, err := src.ReadMessage()
		if err != nil {
			errCh <- realtimeRelayResult{Direction: direction, Err: err}
			return
		}
		trace.observe(direction, payload)
		if err := dst.WriteMessage(messageType, payload); err != nil {
			errCh <- realtimeRelayResult{Direction: direction, Err: err}
			return
		}
	}
}

type realtimeWSTrace struct {
	mu                sync.Mutex
	turn              int
	speechStoppedAt   time.Time
	responseCreatedAt time.Time
	firstTextAt       time.Time
	functionCallAt    time.Time
	toolOutputSentAt  time.Time
	functionCallID    string
	functionName      string
}

type realtimeWSObservedEvent struct {
	Type       string             `json:"type"`
	Delta      string             `json:"delta"`
	Transcript string             `json:"transcript"`
	Item       realtimeWSItem     `json:"item"`
	Response   realtimeWSResponse `json:"response"`
}

type realtimeWSResponse struct {
	ID     string           `json:"id"`
	Output []realtimeWSItem `json:"output"`
}

type realtimeWSItem struct {
	Type    string              `json:"type"`
	CallID  string              `json:"call_id"`
	Name    string              `json:"name"`
	Output  string              `json:"output"`
	Content []realtimeWSContent `json:"content"`
}

type realtimeWSContent struct {
	Type       string `json:"type"`
	Text       string `json:"text"`
	Transcript string `json:"transcript"`
}

func newRealtimeWSTrace() *realtimeWSTrace {
	return &realtimeWSTrace{}
}

func (t *realtimeWSTrace) observe(direction string, payload []byte) {
	if t == nil || !json.Valid(payload) {
		return
	}

	var event realtimeWSObservedEvent
	if err := json.Unmarshal(payload, &event); err != nil || event.Type == "" {
		return
	}

	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()

	switch direction {
	case "openai_to_browser":
		t.observeOpenAIEvent(event, now)
	case "browser_to_openai":
		t.observeBrowserEvent(event, now)
	}
}

func (t *realtimeWSTrace) observeOpenAIEvent(event realtimeWSObservedEvent, now time.Time) {
	switch event.Type {
	case "input_audio_buffer.speech_stopped":
		t.turn++
		t.speechStoppedAt = now
		t.responseCreatedAt = time.Time{}
		t.firstTextAt = time.Time{}
		t.functionCallAt = time.Time{}
		t.toolOutputSentAt = time.Time{}
		t.functionCallID = ""
		t.functionName = ""
		log.Printf("[ATLAS_VOICE] turn_speech_stopped turn=%d", t.turn)
	case "conversation.item.input_audio_transcription.completed":
		textChars := realtimeItemTextChars(event.Item) + len([]rune(event.Transcript))
		log.Printf(
			"[ATLAS_VOICE] transcription_done turn=%d since_speech_stopped=%s text_chars=%d",
			t.turn,
			durationSince(t.speechStoppedAt, now),
			textChars,
		)
	case "response.created":
		t.responseCreatedAt = now
		log.Printf(
			"[ATLAS_VOICE] response_created turn=%d since_speech_stopped=%s response_id=%s",
			t.turn,
			durationSince(t.speechStoppedAt, now),
			event.Response.ID,
		)
	case "response.output_text.delta":
		if t.firstTextAt.IsZero() {
			t.firstTextAt = now
			log.Printf(
				"[ATLAS_VOICE] first_text_delta turn=%d since_speech_stopped=%s since_response_created=%s delta_chars=%d",
				t.turn,
				durationSince(t.speechStoppedAt, now),
				durationSince(t.responseCreatedAt, now),
				len([]rune(event.Delta)),
			)
		}
	case "response.output_item.done":
		if event.Item.Type == "function_call" {
			t.functionCallAt = now
			t.functionCallID = event.Item.CallID
			t.functionName = event.Item.Name
			log.Printf(
				"[ATLAS_VOICE] function_call_done turn=%d name=%s since_speech_stopped=%s since_response_created=%s",
				t.turn,
				event.Item.Name,
				durationSince(t.speechStoppedAt, now),
				durationSince(t.responseCreatedAt, now),
			)
		}
	case "response.done":
		toolCalls, textChars := realtimeResponseOutputShape(event.Response.Output)
		log.Printf(
			"[ATLAS_VOICE] response_done turn=%d since_speech_stopped=%s since_response_created=%s first_text_ms=%s tool_calls=%d text_chars=%d",
			t.turn,
			durationSince(t.speechStoppedAt, now),
			durationSince(t.responseCreatedAt, now),
			durationSince(t.firstTextAt, now),
			toolCalls,
			textChars,
		)
	case "error", "invalid_request_error":
		log.Printf("[ATLAS_VOICE] realtime_error turn=%d event=%s", t.turn, event.Type)
	}
}

func (t *realtimeWSTrace) observeBrowserEvent(event realtimeWSObservedEvent, now time.Time) {
	switch event.Type {
	case "conversation.item.create":
		if event.Item.Type == "function_call_output" {
			t.toolOutputSentAt = now
			success, action := realtimeFunctionOutputSummary(event.Item.Output)
			log.Printf(
				"[ATLAS_VOICE] tool_output_sent turn=%d call_id=%s function=%s since_function_call=%s success=%s action=%s",
				t.turn,
				event.Item.CallID,
				t.functionName,
				durationSince(t.functionCallAt, now),
				success,
				action,
			)
		}
	case "response.create":
		log.Printf(
			"[ATLAS_VOICE] browser_response_create turn=%d since_tool_output=%s",
			t.turn,
			durationSince(t.toolOutputSentAt, now),
		)
	}
}

func realtimeItemTextChars(item realtimeWSItem) int {
	total := 0
	for _, content := range item.Content {
		total += len([]rune(content.Text))
		total += len([]rune(content.Transcript))
	}
	return total
}

func realtimeResponseOutputShape(items []realtimeWSItem) (toolCalls int, textChars int) {
	for _, item := range items {
		if item.Type == "function_call" {
			toolCalls++
		}
		textChars += realtimeItemTextChars(item)
	}
	return toolCalls, textChars
}

func realtimeFunctionOutputSummary(output string) (success string, action string) {
	success = "unknown"
	action = ""
	if output == "" {
		return success, action
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(output), &parsed); err != nil {
		return success, action
	}
	if value, ok := parsed["success"].(bool); ok {
		if value {
			success = "true"
		} else {
			success = "false"
		}
	}
	if value, ok := parsed["action"].(string); ok {
		action = value
	}
	return success, action
}

func durationSince(start time.Time, now time.Time) string {
	if start.IsZero() {
		return "unknown"
	}
	return now.Sub(start).Round(time.Millisecond).String()
}

func writeRealtimeWSError(conn *websocket.Conn, message string) {
	_ = conn.WriteJSON(gin.H{
		"type":  "error",
		"error": gin.H{"message": message},
	})
}

func realtimeAPIKey() string {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("REALTIME_API_KEY"))
	}
	return apiKey
}

func realtimeModel() string {
	model := strings.TrimSpace(os.Getenv("OPENAI_REALTIME_MODEL"))
	if model == "" {
		model = defaultRealtimeModel
	}
	return model
}

func realtimeTranscriptionModel() string {
	model := strings.TrimSpace(os.Getenv("OPENAI_REALTIME_TRANSCRIPTION_MODEL"))
	if model == "" {
		model = defaultRealtimeTranscriptionModel
	}
	return model
}

func realtimeAPIBase() string {
	apiBase := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENAI_REALTIME_API_BASE")), "/")
	if apiBase == "" {
		return "https://api.openai.com/v1"
	}
	return apiBase
}

func realtimeWebSocketURL() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("OPENAI_REALTIME_WS_URL")); configured != "" {
		return configured, nil
	}

	base, err := url.Parse(realtimeAPIBase())
	if err != nil {
		return "", err
	}
	switch base.Scheme {
	case "https":
		base.Scheme = "wss"
	case "http":
		base.Scheme = "ws"
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/realtime"
	query := base.Query()
	query.Set("model", realtimeModel())
	base.RawQuery = query.Encode()
	return base.String(), nil
}

func newRealtimeHTTPClient() *http.Client {
	transport := &http.Transport{}
	if proxyFunc := realtimeProxyFunc(); proxyFunc != nil {
		transport.Proxy = proxyFunc
	} else {
		transport.Proxy = http.ProxyFromEnvironment
	}

	return &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
	}
}

func realtimeProxyFunc() func(*http.Request) (*url.URL, error) {
	proxyURLStr := strings.TrimSpace(os.Getenv("AI_PROXY_URL"))
	if proxyURLStr == "" {
		proxyURLStr = strings.TrimSpace(os.Getenv("PROXY_URL"))
	}
	if proxyURLStr == "" {
		return nil
	}

	proxyURL, err := url.Parse(proxyURLStr)
	if err != nil {
		return nil
	}
	if user := strings.TrimSpace(os.Getenv("PROXY_USER")); user != "" {
		proxyURL.User = url.UserPassword(user, os.Getenv("PROXY_PASS"))
	}
	return http.ProxyURL(proxyURL)
}

func hashedSafetyIdentifier(c *gin.Context) string {
	sessionID, _ := c.Get("sessionID")
	raw := fmt.Sprintf("streetview:%v:%s", sessionID, c.ClientIP())
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func upstreamErrorMessage(payload map[string]any) string {
	if errorValue, ok := payload["error"]; ok {
		if errorMap, ok := errorValue.(map[string]any); ok {
			if message, ok := errorMap["message"].(string); ok && message != "" {
				return message
			}
		}
	}
	return "OpenAI Realtime API request failed"
}

func realtimeTurnDetectionConfig() realtimeTurnDetection {
	vadType := strings.ToLower(envFirstNonEmpty("semantic_vad", "OPENAI_REALTIME_VAD_TYPE", "REALTIME_VAD_TYPE"))
	if vadType == "server_vad" {
		threshold := clampFloat(envFloat(0.5, "OPENAI_REALTIME_VAD_THRESHOLD", "REALTIME_VAD_THRESHOLD"), 0.0, 1.0)
		prefixPaddingMS := clampInt(envInt(250, "OPENAI_REALTIME_VAD_PREFIX_PADDING_MS", "REALTIME_VAD_PREFIX_PADDING_MS"), 0, 1000)
		silenceDurationMS := clampInt(envInt(350, "OPENAI_REALTIME_VAD_SILENCE_DURATION_MS", "REALTIME_VAD_SILENCE_DURATION_MS"), 100, 2000)
		return realtimeTurnDetection{
			Type:              "server_vad",
			Threshold:         &threshold,
			PrefixPaddingMS:   &prefixPaddingMS,
			SilenceDurationMS: &silenceDurationMS,
			CreateResponse:    true,
			InterruptResponse: true,
		}
	}

	return realtimeTurnDetection{
		Type:              "semantic_vad",
		Eagerness:         realtimeVADEagerness(),
		CreateResponse:    true,
		InterruptResponse: true,
	}
}

func realtimeVADEagerness() string {
	switch strings.ToLower(envFirstNonEmpty("high", "OPENAI_REALTIME_VAD_EAGERNESS", "REALTIME_VAD_EAGERNESS")) {
	case "low":
		return "low"
	case "medium", "auto":
		return "medium"
	case "high":
		return "high"
	default:
		return "high"
	}
}

func realtimeTurnDetectionSummary(config realtimeTurnDetection) string {
	if config.Type == "server_vad" {
		return fmt.Sprintf(
			"server_vad(threshold=%.2f,prefix_ms=%d,silence_ms=%d)",
			valueOrZero(config.Threshold),
			intValueOrZero(config.PrefixPaddingMS),
			intValueOrZero(config.SilenceDurationMS),
		)
	}
	return fmt.Sprintf("%s(eagerness=%s)", config.Type, config.Eagerness)
}

func valueOrZero(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func intValueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func clampFloat(value float64, minValue float64, maxValue float64) float64 {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func clampInt(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func atlasRealtimeInstructions(language string) string {
	return atlas.RealtimeInstructions(language)
}

func isAllowedRealtimeOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}

	originURL, err := url.Parse(origin)
	if err != nil || originURL.Host == "" {
		return false
	}

	originHost := hostnameWithoutPort(originURL.Host)
	requestHost := hostnameWithoutPort(r.Host)
	if originHost == requestHost && originHost != "" {
		return true
	}
	if isLocalRealtimeHost(originHost) {
		return true
	}

	for _, allowed := range realtimeAllowedOrigins() {
		allowedURL, err := url.Parse(allowed)
		if err != nil || allowedURL.Host == "" {
			continue
		}
		if strings.EqualFold(originURL.Scheme, allowedURL.Scheme) &&
			strings.EqualFold(originURL.Host, allowedURL.Host) {
			return true
		}
	}

	return false
}

func realtimeAllowedOrigins() []string {
	origins := []string{"https://earth.wangyufeng.org"}
	for _, key := range []string{
		"OPENAI_REALTIME_ALLOWED_ORIGINS",
		"REALTIME_ALLOWED_ORIGINS",
		"APP_ALLOWED_ORIGINS",
	} {
		for _, origin := range strings.Split(os.Getenv(key), ",") {
			origin = strings.TrimSpace(origin)
			if origin != "" {
				origins = append(origins, origin)
			}
		}
	}
	return origins
}

func hostnameWithoutPort(host string) string {
	if host == "" {
		return ""
	}
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		return strings.Trim(strings.ToLower(parsedHost), "[]")
	}
	return strings.Trim(strings.ToLower(host), "[]")
}

func isLocalRealtimeHost(host string) bool {
	switch strings.ToLower(host) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}
