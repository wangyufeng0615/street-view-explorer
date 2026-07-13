package services

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/utils"
)

var randomServiceGeoOnce sync.Once
var randomServiceGeoErr error

func requireRandomServiceGeoData(t *testing.T) {
	t.Helper()
	randomServiceGeoOnce.Do(func() { randomServiceGeoErr = utils.InitializeGeoData() })
	if randomServiceGeoErr != nil {
		t.Fatalf("InitializeGeoData() error = %v", randomServiceGeoErr)
	}
}

type randomTestSQLiteConfig struct{ path string }

func (c randomTestSQLiteConfig) SQLitePath() string { return c.path }

type randomTestMapProvider struct {
	delay       time.Duration
	fail        bool
	repeatUntil int32
	calls       atomic.Int32
}

func (p *randomTestMapProvider) FindRandomStreetView(ctx context.Context, lat, lng float64, _ int) (bool, float64, float64, string) {
	call := p.calls.Add(1)
	if p.delay > 0 {
		select {
		case <-time.After(p.delay):
		case <-ctx.Done():
			return false, 0, 0, ""
		}
	}
	if p.fail {
		return false, 0, 0, ""
	}
	panoID := fmt.Sprintf("pano-%d", call)
	if call <= p.repeatUntil {
		panoID = "pano-repeat"
	}
	return true, lat, lng, panoID
}

func (p *randomTestMapProvider) FindNearbyStreetView(context.Context, float64, float64) (bool, float64, float64, string) {
	return false, 0, 0, ""
}

func (p *randomTestMapProvider) FindNearestStreetView(context.Context, float64, float64) (bool, float64, float64, string) {
	return false, 0, 0, ""
}

func (p *randomTestMapProvider) GetLocationInfo(context.Context, float64, float64, string) (map[string]string, error) {
	return map[string]string{
		"country":           "Testland",
		"country_code":      "",
		"city":              "Test City",
		"formatted_address": "Test Street",
	}, nil
}

func (p *randomTestMapProvider) GeocodeAddress(context.Context, string) (float64, float64, string, error) {
	return 0, 0, "", nil
}

func (p *randomTestMapProvider) SearchPlace(context.Context, string, string) (*PlaceCandidate, error) {
	return nil, nil
}

func (p *randomTestMapProvider) GetStreetViewFrame(context.Context, string, StreetViewView) (*StreetViewFrame, error) {
	return nil, nil
}

func newRandomTestService(t *testing.T, provider MapProvider) (*LocationService, *repositories.SQLiteRepository) {
	t.Helper()
	repo, err := repositories.NewSQLiteRepository(randomTestSQLiteConfig{path: filepath.Join(t.TempDir(), "random.db")})
	if err != nil {
		t.Fatalf("NewSQLiteRepository() error = %v", err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	return NewLocationService(repo, nil, provider), repo
}

func testPreferenceRegion() []models.Region {
	region := models.Region{}
	region.Coordinates.North = 1
	region.Coordinates.South = 0
	region.Coordinates.East = 1
	region.Coordinates.West = 0
	return []models.Region{region}
}

func TestRandomCandidatesResolveInParallel(t *testing.T) {
	provider := &randomTestMapProvider{delay: 120 * time.Millisecond}
	service, _ := newRandomTestService(t, provider)

	started := time.Now()
	location, err := service.generateRandomLocation(context.Background(), testPreferenceRegion(), "en", "session-parallel", "")
	elapsed := time.Since(started)
	if err != nil {
		t.Fatalf("generateRandomLocation() error = %v", err)
	}
	if location.PanoID == "" {
		t.Fatal("expected a panorama")
	}
	if provider.calls.Load() != randomCandidateCount {
		t.Fatalf("FindRandomStreetView calls = %d, want %d speculative candidates", provider.calls.Load(), randomCandidateCount)
	}
	if elapsed >= 500*time.Millisecond {
		t.Fatalf("parallel resolution took %v; retries appear serialized", elapsed)
	}
}

func TestRandomCandidatesPreferNovelPanoFromSessionHistory(t *testing.T) {
	provider := &randomTestMapProvider{repeatUntil: randomCandidateCount - 1}
	service, repo := newRandomTestService(t, provider)
	if err := repo.RecordVisit("session-repeat", models.Location{
		PanoID: "pano-repeat", Latitude: 0.5, Longitude: 0.5,
	}, models.VisitSourceRandom); err != nil {
		t.Fatalf("RecordVisit() error = %v", err)
	}

	location, err := service.generateRandomLocation(context.Background(), testPreferenceRegion(), "en", "session-repeat", "")
	if err != nil {
		t.Fatalf("generateRandomLocation() error = %v", err)
	}
	if location.PanoID == "pano-repeat" {
		t.Fatalf("returned recently visited pano %q despite a novel candidate", location.PanoID)
	}
}

func TestRandomCandidatesUseVerifiedReservoirWhenLiveLookupsFail(t *testing.T) {
	requireRandomServiceGeoData(t)
	provider := &randomTestMapProvider{fail: true}
	service, repo := newRandomTestService(t, provider)
	verified := models.Location{
		PanoID: "pano-verified", Latitude: 35.1, Longitude: 139.1,
		Country: "Japan", CountryCode: "JP", City: "Tokyo",
	}
	if err := repo.RecordVisit("other-session", verified, models.VisitSourceRandom); err != nil {
		t.Fatalf("RecordVisit() error = %v", err)
	}

	location, err := service.generateRandomLocation(context.Background(), nil, "en", "session-fallback", "")
	if err != nil {
		t.Fatalf("generateRandomLocation() error = %v", err)
	}
	if location.PanoID != verified.PanoID || location.SelectionStrategy != "verified_reservoir" {
		t.Fatalf("fallback = %#v, want verified reservoir location", location)
	}
}

func TestRandomLocationPenaltyUsesPanoAndDistance(t *testing.T) {
	recent := []models.VisitRecord{{PanoID: "old", Latitude: 10, Longitude: 20}}
	if got := randomLocationPenalty(models.Location{PanoID: "old", Latitude: 0, Longitude: 0}, recent); got != 2 {
		t.Fatalf("exact pano penalty = %d, want 2", got)
	}
	if got := randomLocationPenalty(models.Location{PanoID: "new", Latitude: 10.01, Longitude: 20.01}, recent); got != 1 {
		t.Fatalf("nearby penalty = %d, want 1", got)
	}
	if got := randomLocationPenalty(models.Location{PanoID: "new", Latitude: 30, Longitude: 40}, recent); got != 0 {
		t.Fatalf("novel penalty = %d, want 0", got)
	}
}
