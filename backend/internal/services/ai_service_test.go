package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/my-streetview-project/backend/internal/config"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/openai"
)

type noCacheTestConfig struct{}

func (noCacheTestConfig) ServerAddress() string                  { return "" }
func (noCacheTestConfig) SQLitePath() string                     { return "" }
func (noCacheTestConfig) OpenAIAPIKey() string                   { return "test" }
func (noCacheTestConfig) GoogleMapsAPIKey() string               { return "" }
func (noCacheTestConfig) EnableOpenAI() bool                     { return true }
func (noCacheTestConfig) EnableGoogleAPI() bool                  { return false }
func (noCacheTestConfig) SecurityConfig() *config.SecurityConfig { return nil }
func (noCacheTestConfig) ProxyURL() string                       { return "" }
func (noCacheTestConfig) ProxyType() string                      { return "" }
func (noCacheTestConfig) ProxyAuth() (string, string)            { return "", "" }
func (noCacheTestConfig) OpenAIProxyURL() string                 { return "" }
func (noCacheTestConfig) MapsProxyURL() string                   { return "" }
func (noCacheTestConfig) SkipProxyCheck() bool                   { return false }
func (noCacheTestConfig) SetSkipProxyCheck(bool)                 {}

type visualDescriptionConfig struct{ noCacheTestConfig }

func (visualDescriptionConfig) EnableGoogleAPI() bool { return true }

type visualDescriptionMaps struct {
	MapProvider
	frameCalls    int
	lastPanoID    string
	lastFrameView StreetViewView
	frameErr      error
	geocodeErr    error
}

func (m *visualDescriptionMaps) GetLocationInfo(context.Context, float64, float64, string) (map[string]string, error) {
	if m.geocodeErr != nil {
		return nil, m.geocodeErr
	}
	return map[string]string{"formatted_address": "Test Street, Test City"}, nil
}

func (m *visualDescriptionMaps) GetStreetViewFrame(_ context.Context, panoID string, view StreetViewView) (*StreetViewFrame, error) {
	m.frameCalls++
	m.lastPanoID = panoID
	m.lastFrameView = view
	if m.frameErr != nil {
		return nil, m.frameErr
	}
	return &StreetViewFrame{Data: []byte("scene"), ContentType: "image/jpeg", View: view}, nil
}

type changingLetterClient struct {
	calls     int
	lastScene *openai.SceneImage
	lastInfo  map[string]string
}

func (c *changingLetterClient) next(onDelta func(string) error) (string, []openai.Citation, error) {
	c.calls++
	letter := fmt.Sprintf("Atlas 来信 %d", c.calls)
	if onDelta != nil {
		if err := onDelta(letter); err != nil {
			return "", nil, err
		}
	}
	return letter, []openai.Citation{{URL: fmt.Sprintf("https://example.com/%d", c.calls)}}, nil
}

func (c *changingLetterClient) StreamLocationDescription(_ context.Context, _ float64, _ float64, info map[string]string, scene *openai.SceneImage, _ string, onDelta func(string) error) (string, []openai.Citation, error) {
	c.lastScene = scene
	c.lastInfo = info
	return c.next(onDelta)
}

func (c *changingLetterClient) StreamDetailedLocationDescription(_ context.Context, _ float64, _ float64, info map[string]string, scene *openai.SceneImage, _ string, onDelta func(string) error) (string, []openai.Citation, error) {
	c.lastScene = scene
	c.lastInfo = info
	return c.next(onDelta)
}

func (*changingLetterClient) GenerateRegionsForInterest(string) ([]models.Region, error) {
	return nil, nil
}

func (*changingLetterClient) GuessLocationFromImage(context.Context, string, int, string) (float64, float64, string, error) {
	return 0, 0, "", nil
}

func TestDescriptionRequestsAlwaysGenerateANewLetter(t *testing.T) {
	client := &changingLetterClient{}
	service := NewAIService(noCacheTestConfig{}, nil, nil, client)
	location := models.Location{PanoID: "same-panorama", Latitude: 44.0882, Longitude: 25.33667}

	first, firstCitations, err := service.GetDescriptionForLocationContext(context.Background(), location, "zh", StreetViewView{})
	if err != nil {
		t.Fatalf("first description: %v", err)
	}
	second, secondCitations, err := service.GetDescriptionForLocationContext(context.Background(), location, "zh", StreetViewView{})
	if err != nil {
		t.Fatalf("second description: %v", err)
	}

	if client.calls != 2 {
		t.Fatalf("same location generated %d upstream requests, want 2", client.calls)
	}
	if first == second || firstCitations[0].URL == secondCitations[0].URL {
		t.Fatalf("same location reused an earlier letter: first=%q second=%q", first, second)
	}
}

func TestDescriptionFetchesCurrentStreetViewFrame(t *testing.T) {
	maps := &visualDescriptionMaps{}
	client := &changingLetterClient{}
	service := NewAIService(visualDescriptionConfig{}, nil, maps, client)

	_, _, err := service.GetDescriptionForLocationContext(
		context.Background(),
		models.Location{PanoID: "pano", Latitude: 1, Longitude: 2},
		"en",
		StreetViewView{PanoID: "actual-pano", Heading: 90, FOV: 80},
	)
	if err != nil {
		t.Fatalf("GetDescriptionForLocationContext() error = %v", err)
	}
	if maps.frameCalls != 1 {
		t.Fatalf("Street View frame fetches = %d, want 1", maps.frameCalls)
	}
	if maps.lastPanoID != "actual-pano" || maps.lastFrameView.Heading != 90 || maps.lastFrameView.FOV != 80 {
		t.Fatalf("Street View request = pano %q view %#v", maps.lastPanoID, maps.lastFrameView)
	}
	if client.lastScene == nil || client.lastScene.Base64 != "c2NlbmU=" || client.lastScene.Heading != 90 || client.lastScene.FOV != 80 {
		t.Fatalf("scene passed to AI = %#v", client.lastScene)
	}
}

func TestDescriptionFallsBackToSavedAddressWhenGeocodingFails(t *testing.T) {
	maps := &visualDescriptionMaps{geocodeErr: fmt.Errorf("geocoding timeout")}
	client := &changingLetterClient{}
	service := NewAIService(visualDescriptionConfig{}, nil, maps, client)

	desc, _, err := service.GetDescriptionForLocationContext(
		context.Background(),
		models.Location{PanoID: "pano", Latitude: 1, Longitude: 2, FormattedAddress: "Saved Road, Saved Town", Country: "Chile", CountryCode: "CL"},
		"en",
		StreetViewView{Heading: 90, FOV: 80},
	)
	if err != nil || desc == "" {
		t.Fatalf("GetDescriptionForLocationContext() = %q, %v; want a description from the saved address", desc, err)
	}
	if client.lastInfo["formatted_address"] != "Saved Road, Saved Town" || client.lastInfo["country_code"] != "CL" {
		t.Fatalf("location info passed to AI = %#v", client.lastInfo)
	}
	if client.lastScene == nil {
		t.Fatal("scene should still be attached when only geocoding fails")
	}
}

func TestDescriptionFailsClosedWhenStreetViewFrameFails(t *testing.T) {
	maps := &visualDescriptionMaps{frameErr: fmt.Errorf("maps unavailable")}
	service := NewAIService(visualDescriptionConfig{}, nil, maps, &changingLetterClient{})

	_, _, err := service.GetDescriptionForLocationContext(
		context.Background(),
		models.Location{PanoID: "pano", Latitude: 1, Longitude: 2},
		"en",
		StreetViewView{Heading: 90, FOV: 80},
	)
	if err == nil || !strings.Contains(err.Error(), "获取街景画面失败") {
		t.Fatalf("GetDescriptionForLocationContext() error = %v, want visible frame failure", err)
	}
}

func TestDescriptionRefundableWhenVisitorLeavesBeforeTheAIRequest(t *testing.T) {
	// 画面和地址都立即就绪（相当于命中缓存），但访客已经离开
	maps := &visualDescriptionMaps{}
	client := &changingLetterClient{}
	service := NewAIService(visualDescriptionConfig{}, nil, maps, client)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, _, err := service.generateDescription(ctx, models.Location{PanoID: "pano", Latitude: 1, Longitude: 2}, "en", StreetViewView{}, false, nil)
	if !errors.Is(err, ErrCanceledBeforeUpstream) {
		t.Fatalf("generateDescription() error = %v, want ErrCanceledBeforeUpstream so the budget is returned", err)
	}
	if client.calls != 0 {
		t.Fatalf("AI requests = %d, want none after the visitor left", client.calls)
	}
}

type regionsErrorClient struct {
	changingLetterClient
	err error
}

func (c *regionsErrorClient) GenerateRegionsForInterest(string) ([]models.Region, error) {
	return nil, c.err
}

func TestInterestErrorsTellUnclearInterestsFromAIOutages(t *testing.T) {
	setWith := func(err error) error {
		ai := NewAIService(noCacheTestConfig{}, nil, nil, &regionsErrorClient{err: err})
		return NewLocationService(nil, ai, nil).SetExplorationPreference("session", "castles")
	}

	unclear := fmt.Errorf("%w: no regions", openai.ErrRegionsNotUnderstood)
	if err := setWith(unclear); !errors.Is(err, ErrInterestNotUnderstood) {
		t.Fatalf("unclear interest error = %v, want ErrInterestNotUnderstood", err)
	}

	outage := errors.New("upstream 503")
	err := setWith(outage)
	if errors.Is(err, ErrInterestNotUnderstood) || !errors.Is(err, outage) {
		t.Fatalf("AI outage error = %v, want the upstream failure, not an unclear interest", err)
	}
}
