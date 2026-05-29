package repositories

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

type testSQLiteConfig struct {
	path string
}

func (c testSQLiteConfig) SQLitePath() string {
	return c.path
}

func TestGetLocationByPanoIDNotFound(t *testing.T) {
	repo, err := NewSQLiteRepository(testSQLiteConfig{
		path: filepath.Join(t.TempDir(), "location-not-found.db"),
	})
	if err != nil {
		t.Fatalf("NewSQLiteRepository() error = %v", err)
	}
	defer repo.Close()

	_, err = repo.GetLocationByPanoID("does.not.exist")
	if !errors.Is(err, ErrLocationNotFound) {
		t.Fatalf("GetLocationByPanoID() error = %v, want ErrLocationNotFound", err)
	}
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
	if err := repo.RecordVisit("another-session", models.Location{
		PanoID:           "pano-other",
		Latitude:         50.5,
		Longitude:        60.6,
		Country:          "C",
		City:             "Gamma",
		FormattedAddress: "Gamma Avenue",
	}, models.VisitSourceRandom); err != nil {
		t.Fatalf("RecordVisit(other session) error = %v", err)
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
		if visit.PanoID == "pano-other" {
			t.Fatalf("GetVisitHistory leaked another session's visit")
		}
	}
}

func TestGetGlobalVisitHistoryReturnsVisitsAcrossSessions(t *testing.T) {
	repo, err := NewSQLiteRepository(testSQLiteConfig{
		path: filepath.Join(t.TempDir(), "global-visit-history.db"),
	})
	if err != nil {
		t.Fatalf("NewSQLiteRepository() error = %v", err)
	}
	defer repo.Close()

	records := []struct {
		sessionID string
		location  models.Location
	}{
		{
			sessionID: "session-a",
			location: models.Location{
				PanoID:           "pano-a",
				Latitude:         10.1,
				Longitude:        20.2,
				Country:          "A",
				City:             "Alpha",
				FormattedAddress: "Alpha Street",
			},
		},
		{
			sessionID: "session-b",
			location: models.Location{
				PanoID:           "pano-b",
				Latitude:         30.3,
				Longitude:        40.4,
				Country:          "B",
				City:             "Beta",
				FormattedAddress: "Beta Road",
			},
		},
		{
			sessionID: "session-b",
			location: models.Location{
				PanoID:           "pano-a",
				Latitude:         10.1,
				Longitude:        20.2,
				Country:          "A",
				City:             "Alpha",
				FormattedAddress: "Alpha Street",
			},
		},
	}

	for _, record := range records {
		if err := repo.RecordVisit(record.sessionID, record.location, models.VisitSourceRandom); err != nil {
			t.Fatalf("RecordVisit() error = %v", err)
		}
	}

	visits, totalVisits, uniquePlaces, err := repo.GetGlobalVisitHistory(10, 0)
	if err != nil {
		t.Fatalf("GetGlobalVisitHistory() error = %v", err)
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

	for _, visit := range visits {
		if visit.SessionID != "" {
			t.Fatalf("visit.SessionID = %q, want empty string", visit.SessionID)
		}
	}
}

// ==================== Agent Journey Repository Tests ====================

func newTestRepo(t *testing.T) *SQLiteRepository {
	t.Helper()
	repo, err := NewSQLiteRepository(testSQLiteConfig{
		path: filepath.Join(t.TempDir(), "agent-repo.db"),
	})
	if err != nil {
		t.Fatalf("NewSQLiteRepository() error = %v", err)
	}
	t.Cleanup(func() { repo.Close() })
	return repo
}

func TestCreateAndGetJourney(t *testing.T) {
	repo := newTestRepo(t)
	now := time.Now()

	journey := models.AgentJourney{
		ID: "j-001", Token: "tok-abc",
		StartLat: 48.8566, StartLng: 2.3522,
		TotalStops: 5, Status: models.JourneyStatusPending,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := repo.CreateJourney(journey); err != nil {
		t.Fatalf("CreateJourney error: %v", err)
	}

	got, err := repo.GetJourney("j-001")
	if err != nil {
		t.Fatalf("GetJourney error: %v", err)
	}
	if got == nil {
		t.Fatal("GetJourney returned nil")
	}
	if got.Token != "tok-abc" {
		t.Fatalf("Token = %q, want tok-abc", got.Token)
	}
	if got.TotalStops != 5 {
		t.Fatalf("TotalStops = %d, want 5", got.TotalStops)
	}
	if got.Status != models.JourneyStatusPending {
		t.Fatalf("Status = %q, want pending", got.Status)
	}
}

func TestGetJourneyNotFound(t *testing.T) {
	repo := newTestRepo(t)
	got, err := repo.GetJourney("nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Fatal("expected nil for nonexistent journey")
	}
}

func TestGetJourneysByToken(t *testing.T) {
	repo := newTestRepo(t)
	now := time.Now()

	for _, id := range []string{"j-a", "j-b"} {
		repo.CreateJourney(models.AgentJourney{
			ID: id, Token: "shared-tok",
			StartLat: 10, StartLng: 20, TotalStops: 3,
			Status: models.JourneyStatusPending, CreatedAt: now, UpdatedAt: now,
		})
	}
	// Different token
	repo.CreateJourney(models.AgentJourney{
		ID: "j-c", Token: "other-tok",
		StartLat: 10, StartLng: 20, TotalStops: 3,
		Status: models.JourneyStatusPending, CreatedAt: now, UpdatedAt: now,
	})

	journeys, err := repo.GetJourneysByToken("shared-tok")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if len(journeys) != 2 {
		t.Fatalf("count = %d, want 2", len(journeys))
	}
	// Token should be empty in response
	for _, j := range journeys {
		if j.Token != "" {
			t.Fatalf("Token should be empty in list response, got %q", j.Token)
		}
	}
}

func TestUpdateJourneyStatus(t *testing.T) {
	repo := newTestRepo(t)
	now := time.Now()
	repo.CreateJourney(models.AgentJourney{
		ID: "j-up", Token: "tok",
		StartLat: 10, StartLng: 20, TotalStops: 3,
		Status: models.JourneyStatusPending, CreatedAt: now, UpdatedAt: now,
	})

	if err := repo.UpdateJourneyStatus("j-up", "tok", models.JourneyStatusInProgress); err != nil {
		t.Fatalf("error: %v", err)
	}

	got, _ := repo.GetJourney("j-up")
	if got.Status != models.JourneyStatusInProgress {
		t.Fatalf("status = %q, want in_progress", got.Status)
	}

	// Wrong token should fail
	if err := repo.UpdateJourneyStatus("j-up", "wrong", models.JourneyStatusCompleted); err == nil {
		t.Fatal("expected error for wrong token")
	}
}

func TestSaveJourneyLetter(t *testing.T) {
	repo := newTestRepo(t)
	now := time.Now()
	repo.CreateJourney(models.AgentJourney{
		ID: "j-let", Token: "tok",
		StartLat: 10, StartLng: 20, TotalStops: 3,
		Status: models.JourneyStatusInProgress, CreatedAt: now, UpdatedAt: now,
	})

	if err := repo.SaveJourneyLetter("j-let", "tok", "Dear human..."); err != nil {
		t.Fatalf("error: %v", err)
	}

	got, _ := repo.GetJourney("j-let")
	if got.Letter != "Dear human..." {
		t.Fatalf("letter = %q", got.Letter)
	}
	if got.Status != models.JourneyStatusCompleted {
		t.Fatalf("status = %q, want completed", got.Status)
	}
}

func TestSaveAndGetJourneyStops(t *testing.T) {
	repo := newTestRepo(t)
	now := time.Now()
	repo.CreateJourney(models.AgentJourney{
		ID: "j-stops", Token: "tok",
		StartLat: 10, StartLng: 20, TotalStops: 3,
		Status: models.JourneyStatusInProgress, CreatedAt: now, UpdatedAt: now,
	})

	stops := []models.AgentJourneyStop{
		{JourneyID: "j-stops", StopNumber: 1, Lat: 10, Lng: 20, PanoID: "p1", JournalEntry: "First!", CreatedAt: now},
		{JourneyID: "j-stops", StopNumber: 2, Lat: 11, Lng: 21, PanoID: "p2", JournalEntry: "Second!", CreatedAt: now},
	}
	for _, s := range stops {
		if err := repo.SaveJourneyStop(s); err != nil {
			t.Fatalf("SaveJourneyStop error: %v", err)
		}
	}

	got, err := repo.GetJourneyStops("j-stops")
	if err != nil {
		t.Fatalf("GetJourneyStops error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("count = %d, want 2", len(got))
	}
	if got[0].StopNumber != 1 || got[1].StopNumber != 2 {
		t.Fatal("stops not in order")
	}
	if got[0].JournalEntry != "First!" {
		t.Fatalf("entry = %q", got[0].JournalEntry)
	}
}

func TestGetJourneyStopsEmpty(t *testing.T) {
	repo := newTestRepo(t)
	stops, err := repo.GetJourneyStops("nonexistent")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if stops != nil && len(stops) != 0 {
		t.Fatalf("expected empty stops, got %d", len(stops))
	}
}
