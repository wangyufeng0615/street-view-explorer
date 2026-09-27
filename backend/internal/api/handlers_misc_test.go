package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/services"
)

func setupVisitAndPreferenceHandlers(t *testing.T, sessionID string) (*gin.Engine, *repositories.SQLiteRepository) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	repo, err := repositories.NewSQLiteRepository(testSQLiteConfig{
		path: filepath.Join(t.TempDir(), "visits-test.db"),
	})
	if err != nil {
		t.Fatalf("NewSQLiteRepository() error = %v", err)
	}
	t.Cleanup(func() { repo.Close() })

	handlers := NewHandlers(services.NewLocationService(repo, nil, nil), nil)
	r := gin.New()
	if sessionID != "" {
		r.Use(func(c *gin.Context) { c.Set("sessionID", sessionID) })
	}
	r.GET("/visits", handlers.GetVisitHistory)
	r.POST("/preferences", handlers.SetExplorationPreference)
	r.POST("/preferences/remove", handlers.DeleteExplorationPreference)
	return r, repo
}

type visitHistoryResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
	Data    struct {
		Visits       []models.VisitRecord `json:"visits"`
		Total        int64                `json:"total"`
		TotalVisits  int64                `json:"total_visits"`
		UniquePlaces int64                `json:"unique_places"`
	} `json:"data"`
}

func getVisitHistory(t *testing.T, r *gin.Engine, query string) (int, visitHistoryResponse) {
	t.Helper()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/visits"+query, nil))
	var body visitHistoryResponse
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", w.Body.String(), err)
	}
	return w.Code, body
}

func TestGetVisitHistoryIsSharedAcrossSessionsAndFiltersBySource(t *testing.T) {
	r, repo := setupVisitAndPreferenceHandlers(t, "viewer")
	visits := []struct {
		session string
		pano    string
		source  string
	}{
		{"session-a", "pano-1", models.VisitSourceRandom},
		{"session-b", "pano-1", models.VisitSourceRandom},
		{"session-b", "pano-2", models.VisitSourceLookup},
	}
	for _, v := range visits {
		loc := models.Location{PanoID: v.pano, Latitude: 1, Longitude: 2}
		if err := repo.RecordVisit(v.session, loc, v.source); err != nil {
			t.Fatalf("RecordVisit: %v", err)
		}
	}

	code, all := getVisitHistory(t, r, "")
	if code != http.StatusOK || !all.Success {
		t.Fatalf("status=%d body=%+v", code, all)
	}
	if len(all.Data.Visits) != 3 || all.Data.TotalVisits != 3 || all.Data.Total != all.Data.TotalVisits {
		t.Fatalf("all visits = %d total=%d, want 3 from every session", len(all.Data.Visits), all.Data.TotalVisits)
	}

	_, lookups := getVisitHistory(t, r, "?source="+models.VisitSourceLookup)
	if len(lookups.Data.Visits) != 1 || lookups.Data.Visits[0].PanoID != "pano-2" {
		t.Fatalf("lookup visits = %+v", lookups.Data.Visits)
	}

	_, footprints := getVisitHistory(t, r, "?distinct=1")
	if len(footprints.Data.Visits) != 1 || footprints.Data.Visits[0].PanoID != "pano-1" {
		t.Fatalf("distinct footprints default to random source and dedupe panoramas: %+v", footprints.Data.Visits)
	}

	_, paged := getVisitHistory(t, r, "?limit=1&offset=1")
	if len(paged.Data.Visits) != 1 || paged.Data.TotalVisits != 3 {
		t.Fatalf("paged visits = %d total=%d", len(paged.Data.Visits), paged.Data.TotalVisits)
	}
}

func TestGetVisitHistoryRejectsUnknownSource(t *testing.T) {
	r, _ := setupVisitAndPreferenceHandlers(t, "viewer")
	code, body := getVisitHistory(t, r, "?source=nope")
	if code != http.StatusBadRequest || body.Success {
		t.Fatalf("status=%d body=%+v, want 400", code, body)
	}
}

func TestExplorationPreferenceHandlersRequireSession(t *testing.T) {
	r, _ := setupVisitAndPreferenceHandlers(t, "")
	for _, path := range []string{"/preferences", "/preferences/remove"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"interest":"castles"}`)))
		if w.Code != http.StatusInternalServerError {
			t.Fatalf("%s without session status = %d, want 500", path, w.Code)
		}
	}
}

func TestSetExplorationPreferenceRejectsMissingInterest(t *testing.T) {
	r, _ := setupVisitAndPreferenceHandlers(t, "session-a")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/preferences", strings.NewReader(`{}`)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestDeleteExplorationPreferenceUsesRequestLanguage(t *testing.T) {
	r, repo := setupVisitAndPreferenceHandlers(t, "session-a")
	if err := repo.SaveExplorationPreference("session-a", models.ExplorationPreference{Interest: "castles"}); err != nil {
		t.Fatalf("SaveExplorationPreference: %v", err)
	}

	for lang, want := range map[string]string{"en": "Exploration preference successfully deleted", "zh": "探索偏好已成功删除"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/preferences/remove?lang="+lang, nil))
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), want) {
			t.Fatalf("lang=%s status=%d body=%s", lang, w.Code, w.Body.String())
		}
	}
	pref, err := repo.GetExplorationPreference("session-a")
	if err != nil || pref != nil {
		t.Fatalf("preference after delete = %+v err=%v, want nil", pref, err)
	}
}

func TestParseIntParam(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		query        string
		defaultValue int
		want         int
	}{
		{"", 1000, 1000},
		{"?n=25", 1000, 25},
		{"?n=%2025%20", 1000, 25},
		{"?n=abc", 1000, 1000},
		{"?n=0", 1000, 1000},
		{"?n=-3", 1000, 1000},
		{"?n=0", 0, 0},
		{"?n=-1", 0, 0},
		{"?n=7", 0, 7},
	}
	for _, tt := range tests {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/"+tt.query, nil)
		if got := parseIntParam(c, "n", tt.defaultValue); got != tt.want {
			t.Errorf("parseIntParam(%q, default %d) = %d, want %d", tt.query, tt.defaultValue, got, tt.want)
		}
	}
}

func TestNormalizeVisitSource(t *testing.T) {
	tests := map[string]string{
		models.VisitSourceShared:        models.VisitSourceShared,
		" " + models.VisitSourceMapPick: models.VisitSourceMapPick,
		models.VisitSourceRandom:        models.VisitSourceLookup,
		"":                              models.VisitSourceLookup,
		"anything-else":                 models.VisitSourceLookup,
	}
	for input, want := range tests {
		if got := normalizeVisitSource(input); got != want {
			t.Errorf("normalizeVisitSource(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestWantsDescriptionStream(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for query, want := range map[string]bool{"": false, "?stream=1": true, "?stream=TRUE": true, "?stream=%20true": true, "?stream=0": false, "?stream=yes": false} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/"+query, nil)
		if got := wantsDescriptionStream(c); got != want {
			t.Errorf("wantsDescriptionStream(%q) = %v, want %v", query, got, want)
		}
	}
}
