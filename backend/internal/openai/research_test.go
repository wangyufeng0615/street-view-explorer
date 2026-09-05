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

func TestResearchEvidenceIsRequestScoped(t *testing.T) {
	var first, second string
	a := WithResearchObserver(context.Background(), func(s string) { first = s })
	b := WithResearchObserver(context.Background(), func(s string) { second = s })
	reportResearch(a, 1)
	reportResearch(b, 0)
	if first != "verified" || second != "unverified" {
		t.Fatalf("statuses=%s,%s", first, second)
	}
}

func TestDescriptionRejectsLanguageDriftAfterVisibleText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, text := range []string{"[Atlas arrives]\n\n" + strings.Repeat("A quiet road runs beside the river. ", 4), strings.Repeat("远处的街道沿着河岸延伸，行人正在穿过广场。", 40)} {
			data, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": text}}}})
			fmt.Fprintf(w, "data: %s\n\n", data)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()
	c := &client{apiKey: "test", modelName: "test", endpoint: server.URL, httpClient: server.Client()}
	visible := false
	_, _, err := c.StreamLocationDescription(context.Background(), 1, 2, map[string]string{}, nil, "en", func(string) error { visible = true; return nil })
	if !visible || err == nil {
		t.Fatalf("visible=%v error=%v; final language validation must reject drift", visible, err)
	}
}
