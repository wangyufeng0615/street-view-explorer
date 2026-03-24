package repositories

import (
	"path/filepath"
	"testing"

	"github.com/my-streetview-project/backend/internal/models"
)

type testSQLiteConfig struct {
	path string
}

func (c testSQLiteConfig) SQLitePath() string {
	return c.path
}

func TestGetVisitHistoryReturnsVisitAndUniqueCounts(t *testing.T) {
	repo, err := NewSQLiteRepository(testSQLiteConfig{
		path: filepath.Join(t.TempDir(), "visit-history.db"),
	})
	if err != nil {
		t.Fatalf("NewSQLiteRepository() error = %v", err)
	}
	defer repo.Close()

	sessionID := "session-123"

	visitsToInsert := []models.Location{
		{
			PanoID:           "pano-a",
			Latitude:         10.1,
			Longitude:        20.2,
			Country:          "A",
			City:             "Alpha",
			FormattedAddress: "Alpha Street",
		},
		{
			PanoID:           "pano-a",
			Latitude:         10.1,
			Longitude:        20.2,
			Country:          "A",
			City:             "Alpha",
			FormattedAddress: "Alpha Street",
		},
		{
			PanoID:           "pano-b",
			Latitude:         30.3,
			Longitude:        40.4,
			Country:          "B",
			City:             "Beta",
			FormattedAddress: "Beta Road",
		},
	}

	sources := []string{
		models.VisitSourceRandom,
		models.VisitSourceShared,
		models.VisitSourceLookup,
	}

	for i, loc := range visitsToInsert {
		if err := repo.RecordVisit(sessionID, loc, sources[i]); err != nil {
			t.Fatalf("RecordVisit() error = %v", err)
		}
	}

	visits, totalVisits, uniquePlaces, err := repo.GetVisitHistory(sessionID, 10, 0)
	if err != nil {
		t.Fatalf("GetVisitHistory() error = %v", err)
	}

	if totalVisits != 3 {
		t.Fatalf("totalVisits = %d, want 3", totalVisits)
	}

	if uniquePlaces != 2 {
		t.Fatalf("uniquePlaces = %d, want 2", uniquePlaces)
	}

	if len(visits) != 3 {
		t.Fatalf("len(visits) = %d, want 3", len(visits))
	}

	if visits[0].PanoID != "pano-b" {
		t.Fatalf("visits[0].PanoID = %q, want pano-b", visits[0].PanoID)
	}

	if visits[0].Source != models.VisitSourceLookup {
		t.Fatalf("visits[0].Source = %q, want %q", visits[0].Source, models.VisitSourceLookup)
	}

	for _, visit := range visits {
		if visit.SessionID != "" {
			t.Fatalf("visit.SessionID = %q, want empty string", visit.SessionID)
		}
	}
}
