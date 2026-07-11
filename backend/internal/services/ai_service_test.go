package services

import (
	"context"
	"fmt"
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

type changingLetterClient struct {
	calls int
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

func (c *changingLetterClient) GenerateLocationDescription(float64, float64, map[string]string, *openai.SceneImage, string) (string, []openai.Citation, error) {
	return c.next(nil)
}

func (c *changingLetterClient) GenerateDetailedLocationDescription(float64, float64, map[string]string, *openai.SceneImage, string) (string, []openai.Citation, error) {
	return c.next(nil)
}

func (c *changingLetterClient) StreamLocationDescription(_ context.Context, _ float64, _ float64, _ map[string]string, _ *openai.SceneImage, _ string, onDelta func(string) error) (string, []openai.Citation, error) {
	return c.next(onDelta)
}

func (c *changingLetterClient) StreamDetailedLocationDescription(_ context.Context, _ float64, _ float64, _ map[string]string, _ *openai.SceneImage, _ string, onDelta func(string) error) (string, []openai.Citation, error) {
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

	first, firstCitations, err := service.GetDescriptionForLocation(location, "zh", StreetViewView{})
	if err != nil {
		t.Fatalf("first description: %v", err)
	}
	second, secondCitations, err := service.GetDescriptionForLocation(location, "zh", StreetViewView{})
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
