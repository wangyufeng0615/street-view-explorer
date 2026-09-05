package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMixedScriptQualityAllowsNamesButRejectsGluedEnglish(t *testing.T) {
	for _, valid := range []string{"这里是萨摩亚的帕亚（Paia），远处是蓝色的海岸。", "这台GPS设备记录位置，AI讲解陪伴旅行。"} {
		if err := validateDescriptionMixedScript(valid, "zh"); err != nil {
			t.Fatal(err)
		}
	}
	if validateDescriptionMixedScript("希望这片绿把Back往海里的步子再多留上几十年。", "zh") == nil {
		t.Fatal("accepted malformed Chinese")
	}
}

func TestMalformedSentenceIsRejectedBeforeStreamingToVisitor(t *testing.T) {
	var visible strings.Builder
	limiter := newDescriptionStreamLimiter(700, func(s string) error { visible.WriteString(s); return nil })
	limiter.language = "zh"
	if err := limiter.Write("眼前是一片安静的森林。"); err != nil {
		t.Fatal(err)
	}
	if err := limiter.Write("希望这片绿把Ba"); err != nil {
		t.Fatal(err)
	}
	if err := limiter.Write("ck往海里的步子留下来。"); err == nil {
		t.Fatal("malformed complete sentence accepted")
	}
	if strings.Contains(visible.String(), "Back") {
		t.Fatalf("malformed prose leaked: %s", visible.String())
	}
}

func TestBothDescriptionPromptsCarryGroundingContract(t *testing.T) {
	t.Setenv("OPENROUTER_DESCRIPTION_SEARCH", "")
	t.Setenv("OPENROUTER_DESCRIPTION_PROVIDER_SORT", "")
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		data, _ := json.Marshal(body)
		for _, phrase := range []string{"Paia", "same geographic scope", "neighbouring village"} {
			if !strings.Contains(string(data), phrase) {
				t.Errorf("missing grounding %q", phrase)
			}
		}
		for _, wire := range []string{`"order":["fireworks"]`, `"allow_fallbacks":true`, `"engine":"exa"`, `"mode":"fast"`, `"tool_choice":"required"`} {
			if !strings.Contains(string(data), wire) {
				t.Errorf("missing production policy %s", wire)
			}
		}
		requests++
		w.Header().Set("Content-Type", "text/event-stream")
		chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": "[A forest above the sea]\n\nThis panorama looks across a green hillside near Paia, Samoa. The visible coastline lies beyond the forest."}}}})
		fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", chunk)
	}))
	defer server.Close()
	c := &client{apiKey: "test", modelName: defaultSceneModel, endpoint: server.URL, httpClient: server.Client()}
	info := map[string]string{"streetview_address": "Unnamed Road, Paia, Samoa"}
	if _, _, err := c.StreamLocationDescription(context.Background(), 1, 2, info, nil, "en", nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.StreamDetailedLocationDescription(context.Background(), 1, 2, info, nil, "en", nil); err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatalf("requests=%d", requests)
	}
}
