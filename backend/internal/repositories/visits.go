package repositories

import (
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

const visitColumns = `id, session_id, pano_id, latitude, longitude, country, country_code, city,
 formatted_address, source, selection_strategy, target_country_code,
 origin_latitude, origin_longitude, snap_distance_km, search_radius_m, selection_attempt, visited_at`

// Internal candidate queries never compute all-history statistics.
func (r *SQLiteRepository) GetRecentVisits(sessionID, source string, limit int) ([]models.VisitRecord, error) {
	query := "SELECT " + visitColumns + " FROM visit_history WHERE 1=1"
	args := []any{}
	if sessionID != "" {
		query += " AND session_id = ?"
		args = append(args, sessionID)
	}
	if source != "" {
		query += " AND source = ?"
		args = append(args, source)
	}
	query += " ORDER BY visited_at DESC, id DESC LIMIT ?"
	args = append(args, limit)
	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanVisitRows(rows)
}

// One latest visit per panorama, so repeat visits cannot crowd old places off the map.
func (r *SQLiteRepository) GetFootprints(limit, offset int, source string) ([]models.VisitRecord, int64, int64, error) {
	total, unique, err := r.cachedVisitStats("footprints:"+source, func() (int64, int64, error) {
		var total, unique int64
		err := r.db.QueryRow("SELECT COUNT(*), COUNT(DISTINCT pano_id) FROM visit_history WHERE source = ?", source).Scan(&total, &unique)
		return total, unique, err
	})
	if err != nil {
		return nil, 0, 0, err
	}
	rows, err := r.db.Query("SELECT "+visitColumns+` FROM visit_history WHERE id IN
 (SELECT MAX(id) FROM visit_history WHERE source = ? GROUP BY pano_id)
 ORDER BY visited_at DESC, id DESC LIMIT ? OFFSET ?`, source, limit, offset)
	if err != nil {
		return nil, 0, 0, err
	}
	defer rows.Close()
	visits, err := scanVisitRows(rows)
	return visits, total, unique, err
}

// visitStatsCacheTTL bounds how stale the public visit totals may be. Totals
// are full-table aggregates; recomputing them for every /visits request lets a
// burst of reads hold the single SQLite connection.
const visitStatsCacheTTL = 30 * time.Second

type visitStatsCacheEntry struct {
	total    int64
	unique   int64
	loadedAt time.Time
}

// cachedVisitStats returns cached totals for key, loading them when missing or
// older than visitStatsCacheTTL. RecordVisit invalidates the cache.
func (r *SQLiteRepository) cachedVisitStats(key string, load func() (int64, int64, error)) (int64, int64, error) {
	r.statsMu.Lock()
	entry, ok := r.statsCache[key]
	r.statsMu.Unlock()
	if ok && time.Since(entry.loadedAt) < visitStatsCacheTTL {
		return entry.total, entry.unique, nil
	}

	total, unique, err := load()
	if err != nil {
		return 0, 0, err
	}
	r.statsMu.Lock()
	if r.statsCache == nil {
		r.statsCache = make(map[string]visitStatsCacheEntry)
	}
	r.statsCache[key] = visitStatsCacheEntry{total: total, unique: unique, loadedAt: time.Now()}
	r.statsMu.Unlock()
	return total, unique, nil
}

func (r *SQLiteRepository) invalidateVisitStats() {
	r.statsMu.Lock()
	r.statsCache = nil
	r.statsMu.Unlock()
}
