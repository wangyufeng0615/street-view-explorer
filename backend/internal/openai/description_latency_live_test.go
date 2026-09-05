package openai

// Opt-in, paid diagnostic. Never runs during the normal test suite.
import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/joho/godotenv"
)

type latencyTransport struct {
	base    http.RoundTripper
	variant string
}

func (l latencyTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	b, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, err
	}
	r.Body.Close()
	var payload map[string]any
	if err = json.Unmarshal(b, &payload); err != nil {
		return nil, err
	}
	delete(payload, "provider")
	if l.variant == "latency" {
		payload["provider"] = map[string]any{"sort": "latency"}
	}
	if l.variant == "fireworks" {
		payload["provider"] = map[string]any{"order": []string{"fireworks"}, "allow_fallbacks": false}
	}
	params := payload["tools"].([]any)[0].(map[string]any)["parameters"].(map[string]any)
	params["engine"] = "auto"
	delete(params, "mode")
	if l.variant == "fast-search" || l.variant == "fireworks" {
		params["engine"] = "exa"
		params["mode"] = "fast"
	}
	b, err = json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	r.Body = io.NopCloser(bytes.NewReader(b))
	r.ContentLength = int64(len(b))
	return l.base.RoundTrip(r)
}

func TestDescriptionLatencyLive(t *testing.T) {
	if os.Getenv("ATLAS_LATENCY_LIVE") != "1" {
		t.Skip("set ATLAS_LATENCY_LIVE=1 to run paid calls")
	}
	env, err := godotenv.Read(os.Getenv("ATLAS_LATENCY_ENV"))
	if err != nil {
		t.Fatal("cannot read benchmark env")
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	if p := os.Getenv("ATLAS_LATENCY_PROXY"); p != "" {
		u, e := url.Parse(p)
		if e != nil {
			t.Fatal("invalid benchmark proxy")
		}
		tr.Proxy = http.ProxyURL(u)
	} else {
		tr.Proxy = nil
	}
	h := &http.Client{Transport: tr, Timeout: 80 * time.Second}
	q := url.Values{"size": {"640x480"}, "location": {"-13.53770,-172.39409"}, "heading": {"0"}, "pitch": {"0"}, "fov": {"90"}, "key": {env["GOOGLE_API_KEY"]}}
	resp, err := h.Get("https://maps.googleapis.com/maps/api/streetview?" + q.Encode())
	if err != nil {
		t.Fatal("frame request failed")
	}
	frame, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil || resp.StatusCode != 200 || len(frame) < 1000 {
		t.Fatal("invalid frame")
	}
	scene := &SceneImage{Base64: base64.StdEncoding.EncodeToString(frame), ContentType: resp.Header.Get("Content-Type"), FOV: 90}
	info := map[string]string{"formatted_address": "Unnamed Road, Paia, Samoa", "streetview_address": "Unnamed Road, Paia, Samoa", "country": "Samoa", "locality": "Paia"}
	model := env["OPENROUTER_SCENE_MODEL"]
	if model == "" {
		model = defaultSceneModel
	}
	variants := []string{"baseline", "latency", "fast-search"}
	if os.Getenv("ATLAS_LATENCY_CONFIRM") == "1" {
		variants = []string{"baseline", "fast-search"}
	}
	if os.Getenv("ATLAS_LATENCY_CONFIRM") == "provider" {
		variants = []string{"fast-search", "fireworks"}
	}
	out, err := os.OpenFile(os.Getenv("ATLAS_LATENCY_OUTPUT"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	for round := 0; round < 3; round++ {
		for offset := 0; offset < len(variants); offset++ {
			variant := variants[(round+offset)%len(variants)]
			lang := "zh"
			if round == 1 {
				lang = "en"
			}
			c := &client{apiKey: env["AI_API_KEY"], modelName: model, sceneModelName: model, endpoint: defaultAPIEndpoint, httpClient: &http.Client{Transport: latencyTransport{base: tr, variant: variant}}}
			start := time.Now()
			first := time.Duration(0)
			observe := func(s string) error {
				if first == 0 {
					first = time.Since(start)
				}
				return nil
			}
			research := "unverified"
			ctx := WithResearchObserver(context.Background(), func(status string) { research = status })
			var text string
			var citations []Citation
			var e error
			detailed := os.Getenv("ATLAS_LATENCY_CONFIRM") != "" && round == 2
			if detailed {
				text, citations, e = c.StreamDetailedLocationDescription(ctx, -13.53770, -172.39409, info, scene, lang, observe)
			} else {
				text, citations, e = c.StreamLocationDescription(ctx, -13.53770, -172.39409, info, scene, lang, observe)
			}
			row := map[string]any{"variant": variant, "round": round, "language": lang, "first_seconds": first.Seconds(), "total_seconds": time.Since(start).Seconds(), "success": e == nil, "citation_count": len(citations), "description": text}
			row["research_status"] = research
			row["detailed"] = detailed
			// Errors may embed provider details; diagnostics persist only the outcome.
			if err := json.NewEncoder(out).Encode(row); err != nil {
				t.Fatal(err)
			}
			t.Logf("variant=%s round=%d first=%.2fs total=%.2fs success=%t citations=%d", variant, round, first.Seconds(), time.Since(start).Seconds(), e == nil, len(citations))
		}
	}
}
