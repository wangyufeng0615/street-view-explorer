package repositories

import (
	"context"
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

func TestRateLimitCleanupComparesInstantsAcrossTimeZones(t *testing.T) {
	r := reviewRepository(t)
	now := time.Now()
	// Times reach the repository in whatever zone the caller uses; the stored
	// form must still sort chronologically and agree with datetime('now').
	expiredAhead := now.Add(-time.Minute).In(time.FixedZone("UTC+14", 14*3600))
	liveBehind := now.Add(time.Minute).In(time.FixedZone("UTC-12", -12*3600))
	if _, err := r.db.Exec("INSERT INTO rate_limits (key, count, expires_at) VALUES ('expired', 1, ?), ('live', 1, ?)",
		rateLimitTime(expiredAhead), rateLimitTime(liveBehind)); err != nil {
		t.Fatal(err)
	}

	if err := r.cleanupExpiredRateLimits(now); err != nil {
		t.Fatal(err)
	}
	var keys []string
	rows, err := r.db.Query("SELECT key FROM rate_limits ORDER BY key")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			t.Fatal(err)
		}
		keys = append(keys, key)
	}
	if len(keys) != 1 || keys[0] != "live" {
		t.Fatalf("remaining keys = %v, want [live]", keys)
	}
	if count, err := r.GetCount("live"); err != nil || count != 1 {
		t.Fatalf("GetCount(live) = %d, %v; want 1", count, err)
	}
	var sqliteSaysExpired bool
	if err := r.db.QueryRow("SELECT ? < datetime('now')", rateLimitTime(expiredAhead)).Scan(&sqliteSaysExpired); err != nil || !sqliteSaysExpired {
		t.Fatalf("stored form does not compare with datetime('now'): expired=%v err=%v", sqliteSaysExpired, err)
	}
}

func TestRateLimitWindowExpires(t *testing.T) {
	r := reviewRepository(t)
	if allowed, _, err := r.CheckAndIncrement("window", 1, 20*time.Millisecond); err != nil || !allowed {
		t.Fatalf("first: allowed=%v err=%v", allowed, err)
	}
	if allowed, _, _ := r.CheckAndIncrement("window", 1, 20*time.Millisecond); allowed {
		t.Fatal("second request inside the window was allowed")
	}
	time.Sleep(40 * time.Millisecond)
	if allowed, _, err := r.CheckAndIncrement("window", 1, 20*time.Millisecond); err != nil || !allowed {
		t.Fatalf("after window: allowed=%v err=%v, want allowed", allowed, err)
	}
}

func TestRateLimitContextAndRefund(t *testing.T) {
	r := reviewRepository(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if allowed, _, err := r.CheckAndIncrementContext(ctx, "cancelled", 1, time.Minute); err == nil || allowed {
		t.Fatalf("cancelled context: allowed=%v err=%v", allowed, err)
	}

	for range 2 {
		if _, _, err := r.CheckAndIncrement("refund", 1, time.Minute); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.RefundContext(context.Background(), "refund"); err != nil {
		t.Fatal(err)
	}
	allowed, _, err := r.CheckAndIncrement("refund", 2, time.Minute)
	if err != nil || !allowed {
		t.Fatalf("after refund: allowed=%v err=%v, want allowed", allowed, err)
	}
}

func TestVisitStatsCacheIsInvalidatedByNewVisits(t *testing.T) {
	r := reviewRepository(t)
	record := func(pano string) {
		if err := r.RecordVisit("a", models.Location{PanoID: pano}, models.VisitSourceRandom); err != nil {
			t.Fatal(err)
		}
	}
	record("p1")
	if _, total, _, err := r.GetFootprints(10, 0, models.VisitSourceRandom); err != nil || total != 1 {
		t.Fatalf("total=%d err=%v", total, err)
	}
	// A cached total must not hide rows written since.
	record("p2")
	if _, total, unique, err := r.GetFootprints(10, 0, models.VisitSourceRandom); err != nil || total != 2 || unique != 2 {
		t.Fatalf("total=%d unique=%d err=%v", total, unique, err)
	}
	// Without writes, repeated reads are served from the cache.
	if _, err := r.db.Exec("INSERT INTO visit_history (session_id, pano_id, latitude, longitude, source) VALUES ('b', 'p3', 0, 0, 'random')"); err != nil {
		t.Fatal(err)
	}
	if _, total, _, err := r.GetGlobalVisitHistory(10, 0, models.VisitSourceRandom); err != nil || total != 3 {
		t.Fatalf("history total=%d err=%v (first read loads fresh)", total, err)
	}
	if _, total, _, err := r.GetFootprints(10, 0, models.VisitSourceRandom); err != nil || total != 2 {
		t.Fatalf("footprints total=%d err=%v, want cached 2", total, err)
	}
}

func TestMigrateDropsLegacyRateLimitRows(t *testing.T) {
	r := reviewRepository(t)
	shanghai := time.FixedZone("CST", 8*3600)
	// The pre-rateLimitTime driver binding stored time.Time via t.String().
	legacy := time.Now().Add(time.Hour).In(shanghai)
	if _, err := r.db.Exec("INSERT INTO rate_limits (key, count, expires_at) VALUES ('legacy', 300, ?), ('current', 1, ?)",
		legacy.String(), rateLimitTime(time.Now().Add(time.Hour))); err != nil {
		t.Fatal(err)
	}

	if err := r.migrate(); err != nil {
		t.Fatal(err)
	}
	if count, err := r.GetCount("legacy"); err != nil || count != 0 {
		t.Fatalf("GetCount(legacy) = %d, %v; want legacy row dropped", count, err)
	}
	if count, err := r.GetCount("current"); err != nil || count != 1 {
		t.Fatalf("GetCount(current) = %d, %v; want 1", count, err)
	}
}
