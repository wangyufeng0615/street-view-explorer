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

func TestRandomCandidatesAllowRecentPanoAsSoftFallback(t *testing.T) {
	provider := &randomTestMapProvider{repeatUntil: randomCandidateCount}
	service, repo := newRandomTestService(t, provider)
	if err := repo.RecordVisit("session-soft-repeat", models.Location{
		PanoID: "pano-repeat", Latitude: 0.5, Longitude: 0.5,
	}, models.VisitSourceRandom); err != nil {
		t.Fatalf("RecordVisit() error = %v", err)
	}

	location, err := service.generateRandomLocation(context.Background(), testPreferenceRegion(), "en", "session-soft-repeat", "")
	if err != nil {
		t.Fatalf("generateRandomLocation() error = %v", err)
	}
	if location.PanoID != "pano-repeat" {
		t.Fatalf("soft fallback pano = %q, want recently visited pano", location.PanoID)
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
	if got := randomLocationPenalty(models.Location{PanoID: "new", Latitude: 10.35, Longitude: 20}, recent); got != 1 {
		t.Fatalf("nearby penalty = %d, want 1", got)
	}
	if got := randomLocationPenalty(models.Location{PanoID: "new", Latitude: 10.55, Longitude: 20}, recent); got != 0 {
		t.Fatalf("location outside soft avoidance radius penalty = %d, want 0", got)
	}
	if got := randomLocationPenalty(models.Location{PanoID: "new", Latitude: 30, Longitude: 40}, recent); got != 0 {
		t.Fatalf("novel penalty = %d, want 0", got)
	}
}

func TestValidateRegionsKeepsAntimeridianRegionAndDropsInvalidOnes(t *testing.T) {
	region := func(north, south, west, east float64, info string) models.Region {
		var r models.Region
		r.Coordinates.North, r.Coordinates.South = north, south
		r.Coordinates.West, r.Coordinates.East = west, east
		r.RegionInfo = info
		return r
	}
	fiji := region(-15, -20, 177, -178, "Fiji")
	tooWide := region(10, 0, -170, 170, "Too wide")
	outOfRange := region(95, 0, 0, 10, "Out of range")

	valid, err := validateRegions([]models.Region{fiji, tooWide, outOfRange})
	if err != nil {
		t.Fatal(err)
	}
	if len(valid) != 1 || valid[0].RegionInfo != "Fiji" {
		t.Fatalf("valid regions = %+v, want only Fiji", valid)
	}
	if _, err := validateRegions([]models.Region{tooWide}); err == nil {
		t.Fatal("only invalid regions should fail validation")
	}
}

// localizingMapProvider answers reverse geocoding in the requested language so
// tests can tell a re-localized address from a stored one.
type localizingMapProvider struct {
	*randomTestMapProvider
	geocodeErr error
	languages  []string
}

func (p *localizingMapProvider) GetLocationInfo(_ context.Context, _, _ float64, language string) (map[string]string, error) {
	p.languages = append(p.languages, language)
	if p.geocodeErr != nil {
		return nil, p.geocodeErr
	}
	return map[string]string{
		"formatted_address": "Shibuya, Tokyo, Japan",
		"country":           "Japan",
		"country_code":      "jp",
		"city":              "",
	}, nil
}

func seedChineseReservoirVisit(t *testing.T, provider MapProvider) *LocationService {
	t.Helper()
	service, repo := newRandomTestService(t, provider)
	stored := models.Location{
		PanoID: "pano-zh", Latitude: 35.66, Longitude: 139.7,
		Country: "日本", CountryCode: "JP", City: "东京", FormattedAddress: "日本东京都涩谷区",
	}
	if err := repo.RecordVisit("other-session", stored, models.VisitSourceRandom); err != nil {
		t.Fatalf("RecordVisit() error = %v", err)
	}
	return service
}

func TestReservoirFallbackRelocalizesTheStoredAddress(t *testing.T) {
	requireRandomServiceGeoData(t)
	provider := &localizingMapProvider{randomTestMapProvider: &randomTestMapProvider{fail: true}}
	service := seedChineseReservoirVisit(t, provider)

	location, err := service.generateRandomLocation(context.Background(), nil, "en", "session-en", "")
	if err != nil {
		t.Fatalf("generateRandomLocation() error = %v", err)
	}
	if location.FormattedAddress != "Shibuya, Tokyo, Japan" || location.Country != "Japan" || location.CountryCode != "JP" {
		t.Fatalf("reservoir address = %#v, want the English address", location)
	}
	if location.City != "东京" {
		t.Fatalf("city = %q, want the stored city kept when geocoding leaves it empty", location.City)
	}
	if len(provider.languages) != 1 || provider.languages[0] != "en" {
		t.Fatalf("geocoding languages = %v, want [en]", provider.languages)
	}
}

func TestReservoirFallbackKeepsStoredAddressWhenGeocodingFails(t *testing.T) {
	requireRandomServiceGeoData(t)
	provider := &localizingMapProvider{
		randomTestMapProvider: &randomTestMapProvider{fail: true},
		geocodeErr:            fmt.Errorf("geocoding timeout"),
	}
	service := seedChineseReservoirVisit(t, provider)

	location, err := service.generateRandomLocation(context.Background(), nil, "en", "session-en", "")
	if err != nil {
		t.Fatalf("generateRandomLocation() error = %v", err)
	}
	if location.PanoID != "pano-zh" || location.FormattedAddress != "日本东京都涩谷区" {
		t.Fatalf("reservoir location = %#v, want the stored panorama and address", location)
	}
}

func TestLocalizedAddressReturnsOnlyAddressFields(t *testing.T) {
	provider := &localizingMapProvider{randomTestMapProvider: &randomTestMapProvider{}}
	service, _ := newRandomTestService(t, provider)

	address, err := service.LocalizedAddress(context.Background(), 35.66, 139.7, "en")
	if err != nil {
		t.Fatalf("LocalizedAddress() error = %v", err)
	}
	if address.FormattedAddress != "Shibuya, Tokyo, Japan" || address.CountryCode != "JP" || address.PanoID != "" {
		t.Fatalf("LocalizedAddress() = %#v", address)
	}
}

func TestOfficialStreetViewChecks(t *testing.T) {
	if !IsOfficialStreetView("© 2024 Google") || IsOfficialStreetView("© Viktor Posnov") {
		t.Fatal("copyright check should accept Google imagery only")
	}
	for id, want := range map[string]bool{
		"RVHISCP2VhnDsPJUbAybGQ":               true,
		"CAoSF0NJSE0wb2dLRUlDQWdNQ2d0Zl9GNVFF": false,
		"CIHM0ogKEICAgICE7NGm_QE":              false,
		"":                                     false,
	} {
		if got := IsOfficialPanoID(id); got != want {
			t.Fatalf("IsOfficialPanoID(%q) = %t, want %t", id, got, want)
		}
	}
}

func TestReservoirFallbackSkipsUserPhotospheres(t *testing.T) {
	requireRandomServiceGeoData(t)
	service, repo := newRandomTestService(t, &randomTestMapProvider{fail: true})
	photosphere := models.Location{PanoID: "CAoSF0NJSE0wb2dLRUlDQWdNQ2d0Zl9GNVFF", Latitude: 1, Longitude: 2}
	if err := repo.RecordVisit("other-session", photosphere, models.VisitSourceRandom); err != nil {
		t.Fatalf("RecordVisit() error = %v", err)
	}

	if _, err := service.generateRandomLocation(context.Background(), nil, "en", "session", ""); err == nil {
		t.Fatal("generateRandomLocation() reused a user photosphere from the reservoir")
	}
}

// countingGeocodeProvider records which panoramas got reverse-geocoded, which
// Google bills.
type countingGeocodeProvider struct {
	*randomTestMapProvider
	panoByCoord     sync.Map
	repeatGeocodes  atomic.Int32
	geocodeRequests atomic.Int32
}

func (p *countingGeocodeProvider) FindRandomStreetView(ctx context.Context, lat, lng float64, radius int) (bool, float64, float64, string) {
	ok, validLat, validLng, panoID := p.randomTestMapProvider.FindRandomStreetView(ctx, lat, lng, radius)
	if ok {
		p.panoByCoord.Store([2]float64{validLat, validLng}, panoID)
	}
	return ok, validLat, validLng, panoID
}

func (p *countingGeocodeProvider) GetLocationInfo(_ context.Context, lat, lng float64, _ string) (map[string]string, error) {
	p.geocodeRequests.Add(1)
	if panoID, _ := p.panoByCoord.Load([2]float64{lat, lng}); panoID == "pano-repeat" {
		p.repeatGeocodes.Add(1)
	}
	return map[string]string{"country": "Testland", "formatted_address": "Test Street"}, nil
}

func TestPenalizedCandidatesDoNotSpendGeocodingWhenAFreshOneWins(t *testing.T) {
	provider := &countingGeocodeProvider{randomTestMapProvider: &randomTestMapProvider{repeatUntil: 6}}
	service, repo := newRandomTestService(t, provider)
	// 已访问点放在测试区域之外很远，只有全景 ID 重复的候选才带惩罚
	seen := models.Location{PanoID: "pano-repeat", Latitude: 50, Longitude: 50}
	if err := repo.RecordVisit("session-cost", seen, models.VisitSourceRandom); err != nil {
		t.Fatalf("RecordVisit() error = %v", err)
	}

	location, err := service.generateRandomLocation(context.Background(), testPreferenceRegion(), "en", "session-cost", "")
	if err != nil {
		t.Fatalf("generateRandomLocation() error = %v", err)
	}
	if location.PanoID == "pano-repeat" {
		t.Fatal("picked the already visited panorama while fresh ones were available")
	}
	if provider.geocodeRequests.Load() == 0 {
		t.Fatal("the fresh panorama was never reverse-geocoded")
	}
	// 重复候选先等一会儿再查地址；新鲜候选一成功就取消它们，一次都不该查
	if got := provider.repeatGeocodes.Load(); got != 0 {
		t.Fatalf("reverse-geocoded the already visited panorama %d times", got)
	}
}
