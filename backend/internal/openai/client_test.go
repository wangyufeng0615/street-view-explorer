package openai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/my-streetview-project/backend/internal/atlas"
)

func ann(url string, start, end int) annotation {
	return annotation{
		Type: "url_citation",
		URLCitation: struct {
			URL        string `json:"url"`
			Title      string `json:"title"`
			StartIndex int    `json:"start_index"`
			EndIndex   int    `json:"end_index"`
		}{URL: url, StartIndex: start, EndIndex: end},
	}
}

func TestStripInlineCitations(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		annotations []annotation
		want        string
	}{
		{
			name:        "no annotations",
			content:     "Hello world.",
			annotations: nil,
			want:        "Hello world.",
		},
		{
			// "Content.[link](https://x.co)"
			//  01234567890123456789012345678
			//          ^start=8          ^end=28
			name:        "strip bare citation",
			content:     "Content.[link](https://x.co)",
			annotations: []annotation{ann("https://x.co", 8, 28)},
			want:        "Content.",
		},
		{
			// "正文。([src](https://x.co))"
			//  0 1 2 3 4 5678 9 0123456789012 3
			//  正文。(  [src] ( https://x.co )  )
			//            ^start=4           ^end=23
			// wrapping () at 3 and 23 should also be stripped
			name:        "strip wrapped citation with parens",
			content:     "正文。([src](https://x.co))",
			annotations: []annotation{ann("https://x.co", 4, 23)},
			want:        "正文。",
		},
		{
			// "A。[a](https://a)\n\nB。[b](https://b)"
			//  0 1 2345 6789012345 67 89 01234 56789012 34
			//  A 。[a](https://a)  \n\n B 。[b](https://b)
			//      ^2         ^16        ^22          ^34  (note: \n is one rune)
			name:    "multiple citations in two paragraphs",
			content: "A。[a](https://a)\n\nB。[b](https://b)",
			annotations: []annotation{
				ann("https://a", 2, 16),
				ann("https://b", 20, 34),
			},
			want: "A。\n\nB。",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripInlineCitations(tt.content, tt.annotations)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestGeographerSystemPromptKeepsCitationsOutOfBody(t *testing.T) {
	requiredPhrases := []string{
		"The product renders citations separately",
		"Finish on a complete sentence about the place itself",
		"Treat links, raw URLs, source lists, and parenthetical reference blocks as off-screen metadata",
		"A current Google Street View frame is attached when available",
		"Never mention that an image or frame is attached",
		"Plus Codes and raw coordinates are internal navigation metadata",
		"Never discuss geocoders, APIs, databases, search failures",
	}

	for _, phrase := range requiredPhrases {
		if !strings.Contains(geographerSystemPrompt, phrase) {
			t.Fatalf("geographerSystemPrompt missing phrase %q", phrase)
		}
	}
	if strings.Contains(geographerSystemPrompt, "OUTPUT LANGUAGE IS FIXED") {
		t.Fatal("shared geographer prompt must not override task-specific language instructions")
	}
	if !strings.Contains(atlas.TextSystemPrompt("en"), "OUTPUT LANGUAGE IS FIXED TO ENGLISH") {
		t.Fatal("English Atlas text prompt did not enforce the UI language")
	}
}

func TestGenerateLocationDescriptionSendsSceneImageWithoutPlusCodeMetadata(t *testing.T) {
	var requestBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"[远处的屋顶在山坡上排开]\\n\\n这里是迈季代勒舍姆附近的街区，山地聚落沿着道路展开。\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[],\"usage\":{\"server_tool_use\":{\"web_search_requests\":1}}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	c := &client{
		apiKey:     "test-key",
		modelName:  "test-model",
		httpClient: server.Client(),
		endpoint:   server.URL,
	}

	_, _, err := c.GenerateLocationDescription(
		33.27597,
		35.77493,
		map[string]string{
			"formatted_address": "15, Majdal Shams 1243800",
			"locality":          "Majdal Shams",
			"plus_code_global":  "8G5Q7QGF+9X",
		},
		&SceneImage{
			Base64:      "c2NlbmU=",
			ContentType: "image/jpeg",
			Heading:     90,
			Pitch:       0,
			FOV:         90,
		},
		"zh",
	)
	if err != nil {
		t.Fatalf("GenerateLocationDescription() error = %v", err)
	}

	encoded, err := json.Marshal(requestBody)
	if err != nil {
		t.Fatalf("marshal captured request: %v", err)
	}
	body := string(encoded)
	if !strings.Contains(body, "data:image/jpeg;base64,c2NlbmU=") {
		t.Fatalf("request did not include scene image: %s", body)
	}
	if strings.Contains(body, "8G5Q7QGF+9X") {
		t.Fatalf("request leaked Plus Code into model context: %s", body)
	}
	if strings.Contains(body, `"plugins"`) {
		t.Fatalf("request still used deprecated web plugin: %s", body)
	}
	if !strings.Contains(body, `"type":"openrouter:web_search"`) {
		t.Fatalf("request did not include OpenRouter web-search server tool: %s", body)
	}
	if !strings.Contains(body, `"engine":"auto"`) {
		t.Fatalf("request did not use OpenRouter's model-aware search routing: %s", body)
	}
	if !strings.Contains(body, `"tool_choice":"auto"`) {
		t.Fatalf("request did not allow synthesis after the required search step: %s", body)
	}
	if !strings.Contains(body, "Silently call the web search tool exactly once") {
		t.Fatalf("request did not explicitly require one research step: %s", body)
	}
	if !strings.Contains(body, "输出语言固定为简体中文") || !strings.Contains(body, "地点位于日本或其他国家，也绝不能改用当地语言、日文或英文") {
		t.Fatalf("request did not enforce the UI language at system level: %s", body)
	}
	if !strings.Contains(body, "搜索和工具调用必须静默完成") {
		t.Fatalf("request did not keep research narration private: %s", body)
	}
	if !strings.Contains(body, `"stream":true`) {
		t.Fatalf("request did not enable streaming: %s", body)
	}
	if !strings.Contains(body, `"max_tool_calls":1`) {
		t.Fatalf("request did not cap web-search tool calls: %s", body)
	}
}

func TestDescriptionStreamGateDropsResearchNarration(t *testing.T) {
	var deltas []string
	gate := newDescriptionStreamGate("zh-CN", func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})

	for _, delta := range []string{
		"I'll search for information about this location first.",
		"[这条路边的低矮围墙很安静]",
		"\n\n嘿，这里是知立市牛田町的一片住宅区。",
	} {
		if err := gate.Write(delta); err != nil {
			t.Fatalf("gate.Write() error = %v", err)
		}
	}

	got := strings.Join(deltas, "")
	if strings.Contains(got, "I'll search") {
		t.Fatalf("research narration leaked into visible deltas: %q", got)
	}
	if !strings.HasPrefix(got, "[这条路边") {
		t.Fatalf("visible response did not start at Atlas prose: %q", got)
	}
}

func TestDescriptionStreamGateRejectsJapaneseForChineseUI(t *testing.T) {
	gate := newDescriptionStreamGate("zh", func(string) error { return nil })
	err := gate.Write("[この塀の向こうに古い歴史が眠っている]\n\nここは愛知県知立市の住宅街です。")
	if err == nil || !strings.Contains(err.Error(), "简体中文") {
		t.Fatalf("gate.Write() error = %v", err)
	}
}

func TestValidateDescriptionLanguageAcceptsChineseWithJapanesePlaceNameInChinese(t *testing.T) {
	text := "[电线沿着安静的住宅街伸向远处]\n\n这里是日本爱知县知立市牛田町，独栋住宅和低矮围墙构成了典型的近郊街景。"
	if err := validateDescriptionLanguage(text, "zh-CN", false); err != nil {
		t.Fatalf("validateDescriptionLanguage() error = %v", err)
	}
}

func TestReadChatCompletionStreamForwardsDeltasAndUsage(t *testing.T) {
	stream := strings.NewReader(
		": OPENROUTER PROCESSING\n\n" +
			"data: {\"choices\":[{\"delta\":{\"content\":\"第一段\"}}]}\n\n" +
			"data: {\"choices\":[{\"delta\":{\"content\":\"第二段\"}}],\"usage\":{\"server_tool_use\":{\"web_search_requests\":2}}}\n\n" +
			"data: [DONE]\n\n",
	)

	var deltas []string
	resp, err := readChatCompletionStream(stream, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatalf("readChatCompletionStream() error = %v", err)
	}
	if got := resp.Choices[0].Message.Content; got != "第一段第二段" {
		t.Fatalf("content = %q", got)
	}
	if got := strings.Join(deltas, "|"); got != "第一段|第二段" {
		t.Fatalf("deltas = %q", got)
	}
	if got := resp.Usage.webSearchRequests(); got != 2 {
		t.Fatalf("web_search_requests = %d", got)
	}
}

func TestGenerateLocationDescriptionRejectsResponseWithoutSearchUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"Unresearched answer\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	c := &client{
		apiKey:     "test-key",
		modelName:  "test-model",
		httpClient: server.Client(),
		endpoint:   server.URL,
	}
	_, _, err := c.GenerateLocationDescription(1, 2, map[string]string{}, nil, "en")
	if err == nil || !strings.Contains(err.Error(), "未执行要求的资料搜索") {
		t.Fatalf("GenerateLocationDescription() error = %v", err)
	}
}

func TestReadChatCompletionStreamSupportsCurrentServerToolUsageDetails(t *testing.T) {
	stream := strings.NewReader(
		"data: {\"choices\":[{\"delta\":{\"content\":\"searched\"}}]}\n\n" +
			"data: {\"choices\":[],\"usage\":{\"server_tool_use_details\":{\"web_search_requests\":1,\"tool_calls_requested\":1,\"tool_calls_executed\":1}}}\n\n" +
			"data: [DONE]\n\n",
	)

	resp, err := readChatCompletionStream(stream, nil)
	if err != nil {
		t.Fatalf("readChatCompletionStream() error = %v", err)
	}
	if got := resp.Usage.webSearchRequests(); got != 1 {
		t.Fatalf("web_search_requests = %d", got)
	}
}

func TestGeoGuessPromptTargetsExactImageCenter(t *testing.T) {
	requiredSystemPhrases := []string{
		"exact center pixel",
		"hidden map center",
		"AI-only red center reticle",
		"exact target pixel",
		"Do not return the coordinates of the most recognizable landmark",
		"unless that feature is actually at the exact center pixel",
	}

	for _, phrase := range requiredSystemPhrases {
		if !strings.Contains(geoGuessSystemPrompt, phrase) {
			t.Fatalf("geoGuessSystemPrompt missing phrase %q", phrase)
		}
	}

	prompt := geoGuessUserPrompt(12, "zh")
	requiredUserPhrases := []string{
		"zoom level 12",
		"red crosshair/reticle",
		"exact center pixel of the raster image",
		"point under the red reticle center",
		"do not shift your final lat/lng to the most distinctive visible object",
		"not the center of a city",
		"Simplified Chinese",
	}

	for _, phrase := range requiredUserPhrases {
		if !strings.Contains(prompt, phrase) {
			t.Fatalf("geoGuessUserPrompt missing phrase %q", phrase)
		}
	}
}

func TestDoChatCompletionRetriesTransientStatus(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			w.Header().Set("Retry-After", "0")
			http.Error(w, `{"error":{"message":"temporary upstream failure","code":503}}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
	}))
	defer server.Close()

	c := &client{
		apiKey:     "test-key",
		modelName:  "test-model",
		httpClient: server.Client(),
		endpoint:   server.URL,
	}

	body, err := c.doChatCompletion(context.Background(), "test", []byte(`{"messages":[]}`), testStartTime())
	if err != nil {
		t.Fatalf("doChatCompletion returned error: %v", err)
	}
	if !strings.Contains(string(body), `"content":"ok"`) {
		t.Fatalf("unexpected response body: %s", string(body))
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}
}

func TestDoChatCompletionDoesNotRetryNonTransientStatus(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		http.Error(w, `{"error":{"message":"region blocked","code":403}}`, http.StatusForbidden)
	}))
	defer server.Close()

	c := &client{
		apiKey:     "test-key",
		modelName:  "test-model",
		httpClient: server.Client(),
		endpoint:   server.URL,
	}

	_, err := c.doChatCompletion(context.Background(), "test", []byte(`{"messages":[]}`), testStartTime())
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "状态码: 403") {
		t.Fatalf("unexpected error: %v", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}

func TestSelectModelUsesCNModelOnlyWithoutProxy(t *testing.T) {
	t.Setenv("OPENROUTER_MODEL", "")
	t.Setenv("AI_MODEL", "")
	t.Setenv("CN_AI_MODEL", "minimax/minimax-m2.7")

	if got := selectModel(""); got != "minimax/minimax-m2.7" {
		t.Fatalf("selectModel without proxy = %q", got)
	}
	if got := selectModel("http://127.0.0.1:10086"); got != defaultModel {
		t.Fatalf("selectModel with proxy = %q, want %q", got, defaultModel)
	}
}

func testStartTime() time.Time {
	return time.Now()
}
