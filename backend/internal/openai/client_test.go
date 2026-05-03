package openai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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
	}

	for _, phrase := range requiredPhrases {
		if !strings.Contains(geographerSystemPrompt, phrase) {
			t.Fatalf("geographerSystemPrompt missing phrase %q", phrase)
		}
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
