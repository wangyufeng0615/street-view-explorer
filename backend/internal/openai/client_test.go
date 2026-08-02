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

func TestTextSystemPromptKeepsCitationsOutOfBody(t *testing.T) {
	prompt := atlas.TextSystemPrompt()
	requiredPhrases := []string{
		"The product renders citations separately",
		"Finish on a complete sentence about the place itself",
		"Treat links, raw URLs, source lists, and parenthetical reference blocks as off-screen metadata",
		"No current Street View image is attached",
		"Never claim to see a building, sign, person, road condition, weather condition, or landscape",
		"Plus Codes and raw coordinates are internal navigation metadata",
		"Never discuss geocoders, APIs, databases, search failures",
	}

	for _, phrase := range requiredPhrases {
		if !strings.Contains(prompt, phrase) {
			t.Fatalf("TextSystemPrompt missing phrase %q", phrase)
		}
	}
	if strings.Contains(prompt, "OUTPUT LANGUAGE IS FIXED") {
		t.Fatal("default text prompt must not override task-specific language instructions")
	}
	if !strings.Contains(atlas.TextSystemPrompt("en"), "OUTPUT LANGUAGE IS FIXED TO ENGLISH") {
		t.Fatal("English Atlas text prompt did not enforce the UI language")
	}
}

func TestGenerateLocationDescriptionUsesTextOnlyContextWithoutPlusCodeMetadata(t *testing.T) {
	var requestBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"[Atlas 刚在地图上圈住这里]\\n\\n这里是迈季代勒舍姆附近的街区，山地聚落沿着道路展开。\"}}]}\n\n"))
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
	if strings.Contains(body, "data:image/") || strings.Contains(body, "c2NlbmU=") || strings.Contains(body, `"image_url"`) {
		t.Fatalf("request included scene image in text-only description: %s", body)
	}
	if !strings.Contains(body, "no image is provided") {
		t.Fatalf("request did not make the text-only grounding contract explicit: %s", body)
	}
	if !strings.Contains(body, `"reasoning":{"enabled":false}`) {
		t.Fatalf("request did not disable paid reasoning tokens for the description path: %s", body)
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
	if strings.Contains(body, `"provider"`) {
		t.Fatalf("description request overrode OpenRouter Auto Exacto provider routing: %s", body)
	}
	if strings.Contains(body, `"require_parameters"`) {
		t.Fatalf("request used a hard parameter filter that can exclude every server-tool endpoint: %s", body)
	}
	if !strings.Contains(body, `"tool_choice":"auto"`) {
		t.Fatalf("request did not allow synthesis after the required search step: %s", body)
	}
	if !strings.Contains(body, "静默调用联网搜索工具一次") {
		t.Fatalf("request did not explicitly require one research step: %s", body)
	}
	if !strings.Contains(body, "输出语言固定为简体中文") || !strings.Contains(body, "地点所属国家和当地语言都不能改变这条规则") {
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
	if !strings.Contains(body, `"max_tokens":640`) {
		t.Fatalf("request did not cap standard description output tokens: %s", body)
	}
	if !strings.Contains(body, "约 260-380 个中文字") || !strings.Contains(body, "绝不能超过 450 个中文字") {
		t.Fatalf("request did not include the shortened standard length contract: %s", body)
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

func TestLimitDescriptionLengthStopsAtCompleteSentence(t *testing.T) {
	text := "[Atlas 抵达这里]\n\n第一句介绍地点。第二句补充历史，而且这一句明显更长。第三句不应出现。"
	got := limitDescriptionLength(text, 34)
	if got != "[Atlas 抵达这里]\n\n第一句介绍地点。" {
		t.Fatalf("limitDescriptionLength() = %q", got)
	}
	if len([]rune(got)) > 34 {
		t.Fatalf("bounded description has %d runes", len([]rune(got)))
	}
}

func TestDescriptionStreamLimiterMatchesBoundedFinalText(t *testing.T) {
	var deltas []string
	limiter := newDescriptionStreamLimiter(38, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	full := "[Atlas 抵达这里]\n\n第一句介绍地点。第二句补充历史。第三句很长而且不应该越过产品规定的上限。"
	for _, delta := range []string{
		"[Atlas 抵达这里]\n\n第一句介绍",
		"地点。第二句补充历史。第三句很长",
		"而且不应该越过产品规定的上限。",
	} {
		if err := limiter.Write(delta); err != nil {
			t.Fatalf("limiter.Write() error = %v", err)
		}
	}
	if err := limiter.Finish(full); err != nil {
		t.Fatalf("limiter.Finish() error = %v", err)
	}
	want := limitDescriptionLength(full, 38)
	if got := strings.Join(deltas, ""); got != want {
		t.Fatalf("streamed description = %q, want %q", got, want)
	}
	if !strings.HasSuffix(want, "。") {
		t.Fatalf("bounded description did not end at a sentence: %q", want)
	}
}

func TestDescriptionStreamGateRejectsJapaneseForChineseUI(t *testing.T) {
	var deltas []string
	gate := newDescriptionStreamGate("zh", func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	text := "[この塀の向こうに古い歴史が眠っている]\n\nここは愛知県知立市の住宅街です。"
	if err := gate.Write(text); err != nil {
		t.Fatalf("partial gate.Write() must keep buffering, got %v", err)
	}
	if len(deltas) != 0 {
		t.Fatalf("wrong-language partial response leaked downstream: %q", deltas)
	}
	err := gate.Finish(text)
	if err == nil || !strings.Contains(err.Error(), "简体中文") {
		t.Fatalf("gate.Finish() error = %v", err)
	}
}

func TestDescriptionStreamGateWaitsPastEnglishPreambleForChineseBody(t *testing.T) {
	var deltas []string
	gate := newDescriptionStreamGate("zh-CN", func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})

	preamble := strings.Repeat("preparing context quietly ", 10)
	if err := gate.Write(preamble); err != nil {
		t.Fatalf("gate.Write(preamble) error = %v", err)
	}
	if len(deltas) != 0 {
		t.Fatalf("English preamble leaked downstream: %q", deltas)
	}
	if err := gate.Write("[Atlas 在地图上找到这条山路]\n\n这里是哥斯达黎加南部一片有明确历史脉络的山地社区。当地生活与咖啡种植、道路交通和周边城镇长期相连。"); err != nil {
		t.Fatalf("gate.Write(Chinese body) error = %v", err)
	}
	got := strings.Join(deltas, "")
	if strings.Contains(got, "preparing context") || !strings.HasPrefix(got, "[Atlas 在地图上") {
		t.Fatalf("visible response = %q", got)
	}
}

func TestDescriptionStreamGateDoesNotReleaseChineseOpeningFollowedByEnglishBody(t *testing.T) {
	var deltas []string
	gate := newDescriptionStreamGate("zh-CN", func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	text := "[Atlas 在地图上抵达这里]\n\n" + strings.Repeat("This body continues in English despite the Chinese opening. ", 5)
	if err := gate.Write(text); err != nil {
		t.Fatalf("gate.Write() error = %v", err)
	}
	if len(deltas) != 0 {
		t.Fatalf("mixed-language response leaked downstream: %q", deltas)
	}
	if err := gate.Finish(text); err == nil || !strings.Contains(err.Error(), "简体中文") {
		t.Fatalf("gate.Finish() error = %v", err)
	}
}

func TestValidateDescriptionLanguageAcceptsChineseWithJapanesePlaceNameInChinese(t *testing.T) {
	text := "[电线沿着安静的住宅街伸向远处]\n\n这里是日本爱知县知立市牛田町，独栋住宅和低矮围墙构成了典型的近郊街景。"
	if err := validateDescriptionLanguage(text, "zh-CN", false); err != nil {
		t.Fatalf("validateDescriptionLanguage() error = %v", err)
	}
}

func TestValidateDescriptionLanguageAcceptsPredominantlyChineseWithLocalKana(t *testing.T) {
	text := "[Atlas 在地图上圈住这座车站]\n\n这里是长野县的しなの铁道沿线，正文仍以简体中文介绍当地交通与聚落历史。"
	if err := validateDescriptionLanguage(text, "zh-CN", false); err != nil {
		t.Fatalf("validateDescriptionLanguage() rejected predominantly Chinese text: %v", err)
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

func TestGenerateDetailedLocationDescriptionUsesTextOnlyContext(t *testing.T) {
	var requestBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"[Atlas 抵达了这里]\\n\\n这是一封只根据地点资料写成的详细来信。\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[],\"usage\":{\"server_tool_use\":{\"web_search_requests\":1}}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	c := &client{apiKey: "test-key", modelName: "test-model", httpClient: server.Client(), endpoint: server.URL}
	_, _, err := c.GenerateDetailedLocationDescription(
		1,
		2,
		map[string]string{"formatted_address": "Test Street"},
		"zh",
	)
	if err != nil {
		t.Fatalf("GenerateDetailedLocationDescription() error = %v", err)
	}

	encoded, err := json.Marshal(requestBody)
	if err != nil {
		t.Fatalf("marshal captured request: %v", err)
	}
	body := string(encoded)
	if strings.Contains(body, "data:image/") || strings.Contains(body, "c2NlbmU=") || strings.Contains(body, `"image_url"`) {
		t.Fatalf("detailed request included scene image: %s", body)
	}
	if !strings.Contains(body, "No image is provided") {
		t.Fatalf("detailed request did not declare text-only grounding: %s", body)
	}
	if strings.Contains(body, `"provider"`) {
		t.Fatalf("detailed request overrode OpenRouter Auto Exacto provider routing: %s", body)
	}
	if !strings.Contains(body, `"max_tokens":850`) {
		t.Fatalf("request did not cap detailed description output tokens: %s", body)
	}
	if !strings.Contains(body, "写 4 个有内容的正文段落") || !strings.Contains(body, "约 400-550 个中文字") || !strings.Contains(body, "绝不能超过 650 个中文字") {
		t.Fatalf("request did not include the bounded detailed length contract: %s", body)
	}
	if strings.Contains(body, "write 6-8 substantive body paragraphs") {
		t.Fatalf("detailed request still contained the obsolete long-form instruction: %s", body)
	}
}

func TestGenerateRegionsForInterestUsesJSONOnlySystemPrompt(t *testing.T) {
	var requestBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"regions\":[{\"coordinates\":{\"north\":49,\"south\":48,\"east\":17,\"west\":16},\"region_info\":\"Central European castles\"}]}"}}]}`))
	}))
	defer server.Close()

	c := &client{apiKey: "test-key", modelName: "deepseek/deepseek-v4-flash", httpClient: server.Client(), endpoint: server.URL}
	regions, err := c.GenerateRegionsForInterest("castles")
	if err != nil {
		t.Fatalf("GenerateRegionsForInterest() error = %v", err)
	}
	if len(regions) != 1 {
		t.Fatalf("regions = %d, want 1", len(regions))
	}

	messages, ok := requestBody["messages"].([]interface{})
	if !ok || len(messages) < 1 {
		t.Fatalf("request messages = %#v", requestBody["messages"])
	}
	system, ok := messages[0].(map[string]interface{})
	if !ok {
		t.Fatalf("system message = %#v", messages[0])
	}
	content, _ := system["content"].(string)
	if !strings.Contains(content, "Return exactly one JSON object") {
		t.Fatalf("region system prompt was not JSON-only: %q", content)
	}
	for _, forbidden := range []string{"Atlas", "arrival letter", "Always start with one bracket line"} {
		if strings.Contains(content, forbidden) {
			t.Fatalf("region system prompt contained %q: %q", forbidden, content)
		}
	}
}

func TestGuessLocationFromImageUsesSeparateVisionModel(t *testing.T) {
	var requestBody map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"lat\":1,\"lng\":2,\"reasoning\":\"terrain\"}"}}]}`))
	}))
	defer server.Close()

	c := &client{
		apiKey:          "test-key",
		modelName:       "deepseek/deepseek-v4-flash",
		visionModelName: "vision-test-model",
		httpClient:      server.Client(),
		endpoint:        server.URL,
	}
	if _, _, _, err := c.GuessLocationFromImage(context.Background(), "aW1hZ2U=", 10, "en"); err != nil {
		t.Fatalf("GuessLocationFromImage() error = %v", err)
	}
	if got := requestBody["model"]; got != "vision-test-model" {
		t.Fatalf("request model = %v, want vision-test-model", got)
	}
}

func TestGenerateLocationDescriptionAcceptsResponseWhenSearchUsageMetadataIsMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"[Atlas has arrived]\\n\\nThis is a sufficiently long English description about the location and its regional context.\"}}]}\n\n"))
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
	var visibleDeltas []string
	desc, _, err := c.StreamLocationDescription(
		context.Background(),
		1,
		2,
		map[string]string{},
		"en",
		func(delta string) error {
			visibleDeltas = append(visibleDeltas, delta)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("StreamLocationDescription() error after visible delta = %v", err)
	}
	if !strings.Contains(desc, "sufficiently long English description") {
		t.Fatalf("StreamLocationDescription() description = %q", desc)
	}
	if got := strings.Join(visibleDeltas, ""); got != desc {
		t.Fatalf("visible stream = %q, final description = %q", got, desc)
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

func TestSelectModelUsesDeepSeekV4FlashByDefault(t *testing.T) {
	t.Setenv("OPENROUTER_MODEL", "")
	t.Setenv("AI_MODEL", "")
	t.Setenv("CN_AI_MODEL", "")

	if got := selectModel("http://127.0.0.1:10086"); got != "deepseek/deepseek-v4-flash" {
		t.Fatalf("selectModel with proxy = %q, want deepseek/deepseek-v4-flash", got)
	}
}

func TestSelectVisionModelUsesClaudeHaiku45ByDefaultAndAllowsOverride(t *testing.T) {
	t.Setenv("OPENROUTER_VISION_MODEL", "")
	if got := selectVisionModel(); got != "anthropic/claude-haiku-4.5" {
		t.Fatalf("selectVisionModel = %q, want anthropic/claude-haiku-4.5", got)
	}

	t.Setenv("OPENROUTER_VISION_MODEL", "google/gemini-2.5-flash")
	if got := selectVisionModel(); got != "google/gemini-2.5-flash" {
		t.Fatalf("selectVisionModel override = %q, want google/gemini-2.5-flash", got)
	}
}

func TestSelectProviderPreferences(t *testing.T) {
	t.Setenv("OPENROUTER_PROVIDER_SORT", "")
	preferences := selectProviderPreferences()
	if preferences == nil || preferences.Sort != "latency" {
		t.Fatalf("default provider preferences = %#v", preferences)
	}

	t.Setenv("OPENROUTER_PROVIDER_SORT", "throughput")
	preferences = selectProviderPreferences()
	if preferences == nil || preferences.Sort != "throughput" {
		t.Fatalf("configured provider preferences = %#v", preferences)
	}

	t.Setenv("OPENROUTER_PROVIDER_SORT", "off")
	if preferences := selectProviderPreferences(); preferences != nil {
		t.Fatalf("disabled provider preferences = %#v, want nil", preferences)
	}
}

func testStartTime() time.Time {
	return time.Now()
}
