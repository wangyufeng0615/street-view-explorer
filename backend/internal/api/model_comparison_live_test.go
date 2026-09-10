package api

// Paid, opt-in diagnostic using the production client, prompts and image reticle.
// See docs/benchmarks/2026-09-10-deepseek-v41.md for the command and limitations.
import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/joho/godotenv"
	"github.com/my-streetview-project/backend/internal/openai"
)

type comparisonCase struct {
	Name, Kind, Language, Interest string
	Lat, Lng                       float64
	Zoom                           int
	Info                           map[string]string
	Image                          []byte
}

func TestModelComparisonLive(t *testing.T) {
	if os.Getenv("ATLAS_MODEL_COMPARISON_LIVE") != "1" {
		t.Skip("opt-in paid model comparison")
	}
	env, err := godotenv.Read(os.Getenv("ATLAS_MODEL_COMPARISON_ENV"))
	if err != nil || env["AI_API_KEY"] == "" || env["GOOGLE_API_KEY"] == "" {
		t.Fatal("benchmark credentials unavailable")
	}
	output := os.Getenv("ATLAS_MODEL_COMPARISON_OUTPUT")
	if output == "" {
		t.Fatal("set ATLAS_MODEL_COMPARISON_OUTPUT")
	}
	if err := os.MkdirAll(filepath.Dir(output), 0700); err != nil {
		t.Fatal(err)
	}
	out, err := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	// Provider errors can contain raw details; persist only classified outcomes.
	previousLog := log.Writer()
	log.SetOutput(io.Discard)
	defer log.SetOutput(previousLog)
	proxy := env["AI_PROXY_URL"]
	if proxy == "" {
		proxy = env["PROXY_URL"]
	}
	if proxy == "" {
		t.Fatal("local external calls require an AI proxy")
	}
	t.Setenv("AI_PROXY_URL", proxy)
	t.Setenv("OPENROUTER_API_ENDPOINT", "")
	t.Setenv("OPENROUTER_DESCRIPTION_PROVIDER_SORT", "")
	t.Setenv("OPENROUTER_DESCRIPTION_SEARCH", "")
	t.Setenv("OPENROUTER_PROVIDER_SORT", "")
	tr := http.DefaultTransport.(*http.Transport).Clone()
	mapProxy := env["MAPS_PROXY_URL"]
	if mapProxy == "" {
		mapProxy = proxy
	}
	proxyURL, err := url.Parse(mapProxy)
	if err != nil {
		t.Fatal("invalid map proxy")
	}
	tr.Proxy = http.ProxyURL(proxyURL)
	h := &http.Client{Transport: tr, Timeout: 25 * time.Second}
	defer tr.CloseIdleConnections()
	fetch := func(path string, q url.Values) []byte {
		t.Helper()
		q.Set("key", env["GOOGLE_API_KEY"])
		resp, e := h.Get("https://maps.googleapis.com/maps/api/" + path + "?" + q.Encode())
		if e != nil {
			t.Fatal("map request failed")
		}
		defer resp.Body.Close()
		b, e := io.ReadAll(resp.Body)
		if e != nil || resp.StatusCode != 200 || len(b) < 1000 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "image/") {
			t.Fatal("invalid benchmark image")
		}
		return b
	}
	cases := []comparisonCase{
		{Name: "Japan historic streets", Kind: "regions", Interest: "日本的传统古城和老街"},
		{Name: "Alpine lakes", Kind: "regions", Interest: "阿尔卑斯山适合自驾的湖边小镇"},
		{Name: "Coastal villages", Kind: "regions", Interest: "Quiet coastal villages with colorful houses"},
		{Name: "Paia zh", Kind: "description", Language: "zh", Lat: -13.53770, Lng: -172.39409, Info: map[string]string{"formatted_address": "Unnamed Road, Paia, Samoa", "streetview_address": "Unnamed Road, Paia, Samoa", "country": "Samoa", "locality": "Paia"}},
		{Name: "Kyoto en", Kind: "description", Language: "en", Lat: 35.0035, Lng: 135.7780, Info: map[string]string{"formatted_address": "Higashiyama, Kyoto, Japan", "streetview_address": "Higashiyama, Kyoto, Japan", "country": "Japan", "locality": "Kyoto"}},
		{Name: "Kyoto detailed zh", Kind: "detailed", Language: "zh", Lat: 35.0035, Lng: 135.7780, Info: map[string]string{"formatted_address": "Higashiyama, Kyoto, Japan", "streetview_address": "Higashiyama, Kyoto, Japan", "country": "Japan", "locality": "Kyoto"}},
		{Name: "Tokyo", Kind: "satellite", Language: "zh", Lat: 35.6812, Lng: 139.7671, Zoom: 12},
		{Name: "Reykjavik", Kind: "satellite", Language: "zh", Lat: 64.1466, Lng: -21.9426, Zoom: 10},
		{Name: "Luxor", Kind: "satellite", Language: "zh", Lat: 25.6995, Lng: 32.6390, Zoom: 12},
		{Name: "Sydney", Kind: "satellite", Language: "zh", Lat: -33.8688, Lng: 151.2093, Zoom: 12},
	}
	images := map[string][]byte{}
	for i := range cases {
		c := &cases[i]
		if c.Kind == "regions" {
			continue
		}
		key := fmt.Sprintf("%s:%f:%f:%d", c.Kind, c.Lat, c.Lng, c.Zoom)
		if c.Kind == "detailed" {
			key = fmt.Sprintf("description:%f:%f:0", c.Lat, c.Lng)
		}
		if b, ok := images[key]; ok {
			c.Image = b
			continue
		}
		if c.Kind == "satellite" {
			// Match the current handler, including scale=2, dimensions and reticle.
			q := url.Values{"center": {fmt.Sprintf("%.6f,%.6f", c.Lat, c.Lng)}, "zoom": {fmt.Sprint(c.Zoom)}, "size": {"640x480"}, "scale": {"2"}, "maptype": {"satellite"}, "format": {"png"}}
			c.Image = fetch("staticmap", q)
			c.Image, err = annotateGeoAICenterReticle(c.Image)
			if err != nil {
				t.Fatal("reticle generation failed")
			}
		} else {
			c.Image = fetch("streetview", url.Values{"location": {fmt.Sprintf("%.6f,%.6f", c.Lat, c.Lng)}, "size": {"640x480"}, "heading": {"0"}, "pitch": {"0"}, "fov": {"90"}, "return_error_code": {"true"}})
		}
		images[key] = c.Image
	}
	count := 0
	for round := 0; round < 2; round++ {
		for caseIndex, tc := range cases {
			order := []string{"old", "v4.1"}
			if (round+caseIndex)%2 == 1 {
				order = []string{"v4.1", "old"}
			}
			for _, variant := range order {
				model := "deepseek/deepseek-v4.1-flash"
				if variant == "old" {
					model = "deepseek/deepseek-v4-flash-vision-exp"
					if tc.Kind == "regions" {
						model = "deepseek/deepseek-v4-flash"
					}
				}
				t.Setenv("OPENROUTER_MODEL", model)
				t.Setenv("OPENROUTER_SCENE_MODEL", model)
				t.Setenv("OPENROUTER_VISION_MODEL", model)
				client := openai.NewClient(env["AI_API_KEY"])
				start := time.Now()
				first := 0.0
				research := "unverified"
				row := map[string]any{"case": tc.Name, "kind": tc.Kind, "round": round + 1, "variant": variant, "model": model, "started_at": start.UTC().Format(time.RFC3339), "language": tc.Language}
				if len(tc.Image) > 0 {
					row["image_sha256"] = fmt.Sprintf("%x", sha256.Sum256(tc.Image))
				}
				var callErr error
				switch tc.Kind {
				case "regions":
					regions, e := client.GenerateRegionsForInterest(tc.Interest)
					callErr = e
					row["regions"] = regions
					row["region_count"] = len(regions)
					valid := len(regions) >= 3 && len(regions) <= 5
					for _, r := range regions {
						c := r.Coordinates
						if c.North <= c.South || c.North > 90 || c.South < -90 || c.East > 180 || c.West < -180 || c.East <= c.West {
							valid = false
						}
					}
					row["valid_bounds"] = valid
				case "description", "detailed":
					ctx := openai.WithResearchObserver(context.Background(), func(s string) { research = s })
					scene := &openai.SceneImage{Base64: base64.StdEncoding.EncodeToString(tc.Image), ContentType: "image/jpeg", FOV: 90}
					observe := func(s string) error {
						if first == 0 {
							first = time.Since(start).Seconds()
						}
						return nil
					}
					var desc string
					var citations []openai.Citation
					if tc.Kind == "detailed" {
						desc, citations, callErr = client.StreamDetailedLocationDescription(ctx, tc.Lat, tc.Lng, tc.Info, scene, tc.Language, observe)
					} else {
						desc, citations, callErr = client.StreamLocationDescription(ctx, tc.Lat, tc.Lng, tc.Info, scene, tc.Language, observe)
					}
					row["description"] = desc
					row["citation_count"] = len(citations)
					row["research_status"] = research
					row["first_seconds"] = first
					row["output_runes"] = len([]rune(desc))
				case "satellite":
					lat, lng, reason, e := client.GuessLocationFromImage(context.Background(), base64.StdEncoding.EncodeToString(tc.Image), tc.Zoom, tc.Language)
					callErr = e
					row["lat"] = lat
					row["lng"] = lng
					row["reasoning"] = reason
					row["target_lat"] = tc.Lat
					row["target_lng"] = tc.Lng
					row["zoom"] = tc.Zoom
					if e == nil {
						rad := math.Pi / 180
						a := math.Pow(math.Sin((lat-tc.Lat)*rad/2), 2) + math.Cos(lat*rad)*math.Cos(tc.Lat*rad)*math.Pow(math.Sin((lng-tc.Lng)*rad/2), 2)
						a = math.Min(1, math.Max(0, a))
						row["distance_km"] = 6371 * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
					}
				}
				row["seconds"] = time.Since(start).Seconds()
				row["success"] = callErr == nil
				if callErr != nil {
					s := strings.ToLower(callErr.Error())
					category := "request_or_validation_error"
					if strings.Contains(s, "deadline") || strings.Contains(s, "timeout") || strings.Contains(s, "超时") {
						category = "timeout"
					}
					if strings.Contains(s, "language") || strings.Contains(s, "语言") {
						category = "language_validation"
					}
					row["error_category"] = category
				}
				if e := json.NewEncoder(out).Encode(row); e != nil {
					t.Fatal(e)
				}
				count++
				t.Logf("%d/40 round=%d case=%s variant=%s seconds=%.2f success=%t", count, round+1, tc.Name, variant, row["seconds"], callErr == nil)
			}
		}
	}
}
