package repositories

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

func reviewRepository(t *testing.T) *SQLiteRepository {
	t.Helper()
	r, err := NewSQLiteRepository(testSQLiteConfig{path: filepath.Join(t.TempDir(), "review.db")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

func TestSQLitePragmasApplyToReplacementConnections(t *testing.T) {
	r := reviewRepository(t)
	for range 2 {
		for pragma, want := range map[string]string{"journal_mode": "wal", "busy_timeout": "5000", "synchronous": "1", "foreign_keys": "1"} {
			var got string
			if err := r.db.QueryRow("PRAGMA " + pragma).Scan(&got); err != nil {
				t.Fatal(err)
			}
			if got != want {
				t.Fatalf("%s=%s, want %s", pragma, got, want)
			}
		}
		r.db.SetMaxIdleConns(0)
		r.db.SetMaxIdleConns(1)
	}
}

func TestRateLimitFailsClosedOnCommitFailure(t *testing.T) {
	r := reviewRepository(t)
	_, err := r.db.Exec(`CREATE TABLE parent(id INTEGER PRIMARY KEY);
 CREATE TABLE pending(parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);
 CREATE TRIGGER fail_rate_commit AFTER INSERT ON rate_limits BEGIN INSERT INTO pending VALUES(42); END;`)
	if err != nil {
		t.Fatal(err)
	}
	allowed, _, err := r.CheckAndIncrement("test", 10, time.Minute)
	if err == nil || allowed {
		t.Fatalf("allowed=%v error=%v; commit must fail closed", allowed, err)
	}
	var count int
	if err := r.db.QueryRow("SELECT COUNT(*) FROM rate_limits").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed commit left %d uncommitted rate limits on pooled connection", count)
	}
}

func TestRecentVisitsAndFootprintsPreserveOldDistinctPlaces(t *testing.T) {
	r := reviewRepository(t)
	for _, pano := range []string{"old", "new", "new", "new"} {
		if err := r.RecordVisit("a", models.Location{PanoID: pano, Latitude: 1, Longitude: 2}, models.VisitSourceRandom); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.RecordVisit("b", models.Location{PanoID: "shared"}, models.VisitSourceShared); err != nil {
		t.Fatal(err)
	}
	recent, err := r.GetRecentVisits("a", "", 2)
	if err != nil || len(recent) != 2 || recent[0].PanoID != "new" {
		t.Fatalf("recent=%v error=%v", recent, err)
	}
	visits, total, unique, err := r.GetFootprints(2, 0, models.VisitSourceRandom)
	if err != nil || len(visits) != 2 || total != 4 || unique != 2 || visits[1].PanoID != "old" {
		t.Fatalf("footprints=%v total=%d unique=%d error=%v", visits, total, unique, err)
	}
	for _, v := range visits {
		if v.SessionID != "" {
			t.Fatal("session leaked")
		}
	}
}
