package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/services"
)

type noStreetViewMapProvider struct{}

func (noStreetViewMapProvider) HasStreetView(context.Context, float64, float64, bool) (bool, float64, float64, string) {
	return false, 0, 0, ""
}
func (noStreetViewMapProvider) FindNearbyStreetView(context.Context, float64, float64) (bool, float64, float64, string) {
	return false, 0, 0, ""
}
func (noStreetViewMapProvider) FindNearestStreetView(context.Context, float64, float64) (bool, float64, float64, string) {
	return false, 0, 0, ""
}
func (noStreetViewMapProvider) GetLocationInfo(context.Context, float64, float64, string) (map[string]string, error) {
	return nil, nil
}
func (noStreetViewMapProvider) GeocodeAddress(context.Context, string) (float64, float64, string, error) {
	return 0, 0, "", nil
}
func (noStreetViewMapProvider) SearchPlace(context.Context, string, string) (*services.PlaceCandidate, error) {
	return nil, nil
}
func (noStreetViewMapProvider) GetStreetViewFrame(context.Context, string, services.StreetViewView) (*services.StreetViewFrame, error) {
	return nil, nil
}

func TestParseCoordinate(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		min     float64
		max     float64
		want    float64
		wantErr bool
	}{
		{name: "valid latitude", input: "31.2304", min: -90, max: 90, want: 31.2304},
		{name: "trimmed value", input: " 121.4737 ", min: -180, max: 180, want: 121.4737},
		{name: "reject trailing junk", input: "1abc", min: -90, max: 90, wantErr: true},
		{name: "reject nan", input: "nan", min: -90, max: 90, wantErr: true},
		{name: "reject infinity", input: "+Inf", min: -90, max: 90, wantErr: true},
		{name: "reject out of range", input: "181", min: -180, max: 180, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseCoordinate(tt.input, tt.min, tt.max)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got value %v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestLookupLocationWithoutStreetViewReturnsNotFound(t *testing.T) {
	locationService := services.NewLocationService(nil, nil, noStreetViewMapProvider{})
	handlers := NewHandlers(locationService, nil)
	router := gin.New()
	router.GET("/api/v1/locations/lookup", handlers.LookupLocation)

	response := doJSON(router, http.MethodGet, "/api/v1/locations/lookup?lat=41.05916&lng=47.26079&lang=zh", nil)
	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), services.ErrStreetViewNotFound.Error()) {
		t.Fatalf("body missing no-street-view message: %s", response.Body.String())
	}
}

func TestWriteDescriptionSSEFlushesNamedEvent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)

	if err := writeDescriptionSSE(context, "delta", gin.H{"text": "你好"}); err != nil {
		t.Fatalf("writeDescriptionSSE() error = %v", err)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, "event: delta\n") || !strings.Contains(body, `data: {"text":"你好"}`) {
		t.Fatalf("unexpected SSE body: %q", body)
	}
}

func TestSanitizeDescription(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "keeps plain paragraphs",
			input: "第一段。\n\n第二段。",
			want:  "第一段。\n\n第二段。",
		},
		{
			name:  "strips trailing markdown links",
			input: "正文内容。\n\n[Wikipedia](https://en.wikipedia.org/wiki/Foo_(bar))\n[NOAA](https://example.com/report?id=1)",
			want:  "正文内容。",
		},
		{
			name:  "strips wrapped trailing markdown links",
			input: "Body text.\n\n([Example](https://example.com/a_(b)))",
			want:  "Body text.",
		},
		{
			name:  "only links becomes empty",
			input: "[Example](https://example.com)\n[Other](https://example.org)",
			want:  "",
		},
		{
			name:  "strips inline wrapped markdown citation after chinese sentence",
			input: "这地方的气质，很大程度上是被海湾、小机场和岛上的法属行政体系一起塑出来的。([en.wikipedia.org](https://en.wikipedia.org/wiki/Grand_Case?utm_source=openai))",
			want:  "这地方的气质，很大程度上是被海湾、小机场和岛上的法属行政体系一起塑出来的。",
		},
		{
			name:  "strips inline wrapped markdown citation before punctuation",
			input: "The village sits by the bay ([Wikipedia](https://example.com/a_(b))).",
			want:  "The village sits by the bay.",
		},
		{
			name:  "keeps non-source markdown labels as plain text",
			input: "It points toward [Grand Case](https://en.wikipedia.org/wiki/Grand_Case).",
			want:  "It points toward Grand Case.",
		},
		{
			name:  "strips parenthetical raw urls",
			input: "正文内容。 (https://example.com/a_(b))",
			want:  "正文内容。",
		},
		{
			name:  "keeps bracketed narration when a later citation exists",
			input: "[站在海风和红土之间，盯着北边那一片安静的地势]\n\n朋友，这里是普恩一带。([en.wikipedia.org](https://example.com/wiki/Poum))",
			want:  "[站在海风和红土之间，盯着北边那一片安静的地势]\n\n朋友，这里是普恩一带。",
		},
		{
			name:  "strips standalone markdown emphasis",
			input: "第一段。\n\n*这一段不应保留星号*\n\n**最后一段也一样**",
			want:  "第一段。\n\n这一段不应保留星号\n\n最后一段也一样",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeDescription(tt.input); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPanoIDRegexAllowsGooglePanoCharacters(t *testing.T) {
	valid := []string{
		"pano-a_b",
		"CAoSFkNJSE0wb2dLRUlDQWdJQ09nX0N0RGc.",
		"CAoSHENJQUJJaEQ2MkllUzNQWGEtMDV2OEIyY3Vsd24.",
	}
	for _, panoID := range valid {
		if !panoIDRegex.MatchString(panoID) {
			t.Fatalf("panoIDRegex rejected valid pano id %q", panoID)
		}
	}

	invalid := []string{
		"bad/pano",
		"bad pano",
		"bad?pano",
	}
	for _, panoID := range invalid {
		if panoIDRegex.MatchString(panoID) {
			t.Fatalf("panoIDRegex accepted invalid pano id %q", panoID)
		}
	}
}

func TestStreetViewViewFromRequestKeepsActualScenePanorama(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(
		"GET",
		"/?scene_pano_id=actual-pano_2&heading=91&pitch=-5&fov=72",
		nil,
	)

	view, err := streetViewViewFromRequest(context)
	if err != nil {
		t.Fatalf("streetViewViewFromRequest() error = %v", err)
	}
	if view.PanoID != "actual-pano_2" || view.Heading != 91 || view.Pitch != -5 || view.FOV != 72 {
		t.Fatalf("unexpected view: %#v", view)
	}
}

func TestStreetViewViewFromRequestRejectsInvalidScenePanorama(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest("GET", "/?scene_pano_id=bad%2Fpano", nil)

	if _, err := streetViewViewFromRequest(context); err == nil {
		t.Fatal("expected invalid scene panorama to be rejected")
	}
}
