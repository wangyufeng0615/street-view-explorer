package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/services"
	"github.com/my-streetview-project/backend/internal/utils"
)

func TestPrefetchRegistryIsSingleUsePerSession(t *testing.T) {
	r := newPrefetchRegistry()
	r.add("s1", "pano-a")

	if r.take("s2", "pano-a") {
		t.Fatal("another session must not record this prefetch")
	}
	if !r.take("s1", "pano-a") {
		t.Fatal("owning session should record its prefetch")
	}
	if r.take("s1", "pano-a") {
		t.Fatal("a prefetch can be recorded only once")
	}
	if r.take("s1", "never-prefetched") {
		t.Fatal("unknown panorama must be rejected")
	}
}

func TestPrefetchRegistryExpiresAndCapsEntries(t *testing.T) {
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	r := newPrefetchRegistry()
	r.now = func() time.Time { return now }

	r.add("s1", "pano-1")
	now = now.Add(time.Second)
	r.add("s1", "pano-2")
	now = now.Add(time.Second)
	r.add("s1", "pano-3") // evicts the oldest (pano-1)
	if r.take("s1", "pano-1") {
		t.Fatalf("oldest entry should be evicted beyond %d per session", prefetchPerSession)
	}
	if !r.take("s1", "pano-3") {
		t.Fatal("newest entry should be kept")
	}

	now = now.Add(prefetchTTL)
	if r.take("s1", "pano-2") {
		t.Fatal("expired prefetch must be rejected")
	}

	var nilRegistry *prefetchRegistry
	nilRegistry.add("s1", "pano-x")
	if nilRegistry.take("s1", "pano-x") {
		t.Fatal("nil registry must reject")
	}
}

type prefetchTestSQLiteConfig struct{ path string }

func (c prefetchTestSQLiteConfig) SQLitePath() string { return c.path }

type prefetchTestMaps struct{ calls atomic.Int32 }

func (p *prefetchTestMaps) FindRandomStreetView(_ context.Context, lat, lng float64, _ int) (bool, float64, float64, string) {
	return true, lat, lng, fmt.Sprintf("pano-%d", p.calls.Add(1))
}
func (p *prefetchTestMaps) FindNearbyStreetView(context.Context, float64, float64) (bool, float64, float64, string) {
	return false, 0, 0, ""
}
func (p *prefetchTestMaps) FindNearestStreetView(context.Context, float64, float64) (bool, float64, float64, string) {
	return false, 0, 0, ""
}
func (p *prefetchTestMaps) GetLocationInfo(context.Context, float64, float64, string) (map[string]string, error) {
	return map[string]string{"country": "Testland", "city": "Test City", "formatted_address": "Test Street"}, nil
}
func (p *prefetchTestMaps) GeocodeAddress(context.Context, string) (float64, float64, string, error) {
	return 0, 0, "", nil
}
func (p *prefetchTestMaps) SearchPlace(context.Context, string, string) (*services.PlaceCandidate, error) {
	return nil, nil
}
func (p *prefetchTestMaps) GetStreetViewFrame(context.Context, string, services.StreetViewView) (*services.StreetViewFrame, error) {
	return nil, nil
}

var prefetchGeoOnce sync.Once

func setupPrefetchRouter(t *testing.T) (*gin.Engine, *repositories.SQLiteRepository) {
	t.Helper()
	prefetchGeoOnce.Do(func() {
		if err := utils.InitializeGeoData(); err != nil {
			t.Fatalf("InitializeGeoData: %v", err)
		}
	})
	gin.SetMode(gin.TestMode)
	repo, err := repositories.NewSQLiteRepository(prefetchTestSQLiteConfig{path: filepath.Join(t.TempDir(), "prefetch.db")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	h := NewHandlers(services.NewLocationService(repo, nil, &prefetchTestMaps{}), nil)
	r := gin.New()
	// Mirrors the session middleware: the X-Session-ID header becomes the session.
	r.Use(func(c *gin.Context) { c.Set("sessionID", c.GetHeader("X-Session-ID")) })
	r.GET("/locations/random", h.GetRandomLocation)
	r.POST("/locations/:panoId/visit", h.RecordPrefetchedVisit)
	return r, repo
}

func prefetchRequest(t *testing.T, r *gin.Engine, method, path, session string) (int, map[string]interface{}) {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("X-Session-ID", session)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, body
}

func countRandomVisits(t *testing.T, repo *repositories.SQLiteRepository) int64 {
	t.Helper()
	_, total, _, err := repo.GetGlobalVisitHistory(10, 0, models.VisitSourceRandom)
	if err != nil {
		t.Fatal(err)
	}
	return total
}

func TestPrefetchedRandomLocationDefersFootprintUntilShown(t *testing.T) {
	r, repo := setupPrefetchRouter(t)
	session := "prefetch-session-0123456789abcdef0123456789"
	other := "other-session-0123456789abcdef0123456789abc"
	// A preference region keeps generation on the fake provider's path
	// (global random also checks the result's country, which the fake lacks).
	region := models.Region{}
	region.Coordinates.North, region.Coordinates.South = 1, 0
	region.Coordinates.East, region.Coordinates.West = 1, 0
	if err := repo.SaveExplorationPreference(session, models.ExplorationPreference{Interest: "test", Regions: []models.Region{region}, CreatedAt: time.Now(), LastUsedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}

	code, body := prefetchRequest(t, r, http.MethodGet, "/locations/random?lang=en&prefetch=1", session)
	if code != http.StatusOK {
		t.Fatalf("prefetch status=%d body=%v", code, body)
	}
	pano := body["data"].(map[string]interface{})["location"].(map[string]interface{})["pano_id"].(string)
	if n := countRandomVisits(t, repo); n != 0 {
		t.Fatalf("prefetch must not write a footprint, got %d", n)
	}

	if code, _ := prefetchRequest(t, r, http.MethodPost, "/locations/"+pano+"/visit", other); code != http.StatusNotFound {
		t.Fatalf("another session recording the prefetch: status=%d, want 404", code)
	}
	if code, body := prefetchRequest(t, r, http.MethodPost, "/locations/"+pano+"/visit", session); code != http.StatusOK {
		t.Fatalf("record prefetched visit: status=%d body=%v", code, body)
	}
	if n := countRandomVisits(t, repo); n != 1 {
		t.Fatalf("shown prefetch should write exactly one footprint, got %d", n)
	}
	if code, _ := prefetchRequest(t, r, http.MethodPost, "/locations/"+pano+"/visit", session); code != http.StatusNotFound {
		t.Fatalf("second record: status=%d, want 404", code)
	}
	if n := countRandomVisits(t, repo); n != 1 {
		t.Fatalf("footprint count after replay = %d, want 1", n)
	}

	// A normal random request still records immediately.
	if code, _ := prefetchRequest(t, r, http.MethodGet, "/locations/random?lang=en", session); code != http.StatusOK {
		t.Fatalf("random status=%d", code)
	}
	if n := countRandomVisits(t, repo); n != 2 {
		t.Fatalf("normal random should record, got %d", n)
	}
}
