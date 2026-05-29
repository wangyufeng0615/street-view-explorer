package repositories

import (
	"database/sql"
	"fmt"
	"sync"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
	_ "modernc.org/sqlite"
)

// SQLiteRepository SQLite 实现的数据存储 + 限流器
type SQLiteRepository struct {
	db *sql.DB
	mu sync.RWMutex // 保护写操作的序列化
}

// SQLiteConfig SQLite 配置接口
type SQLiteConfig interface {
	SQLitePath() string
}

// NewSQLiteRepository 创建 SQLite 存储实例
func NewSQLiteRepository(cfg SQLiteConfig) (*SQLiteRepository, error) {
	dbPath := cfg.SQLitePath()
	if dbPath == "" {
		dbPath = "data/streetview.db"
	}

	// WAL 模式 + 合理的连接参数
	dsn := fmt.Sprintf("%s?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL&_foreign_keys=ON", dbPath)

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 数据库失败: %w", err)
	}

	// SQLite 单写多读，限制连接数
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	// 验证连接
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("SQLite 连接验证失败: %w", err)
	}

	repo := &SQLiteRepository{db: db}

	// 自动建表
	if err := repo.migrate(); err != nil {
		return nil, fmt.Errorf("SQLite 建表失败: %w", err)
	}

	// 启动定期清理过期 rate limit 记录
	go repo.cleanupLoop()

	return repo, nil
}

// migrate 创建数据库表
func (r *SQLiteRepository) migrate() error {
	schema := `
		CREATE TABLE IF NOT EXISTS locations (
			pano_id TEXT PRIMARY KEY,
			latitude REAL NOT NULL,
			longitude REAL NOT NULL,
			formatted_address TEXT DEFAULT '',
			country TEXT DEFAULT '',
			city TEXT DEFAULT '',
			is_mock INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

	CREATE TABLE IF NOT EXISTS exploration_preferences (
		session_id TEXT PRIMARY KEY,
		interest TEXT DEFAULT '',
		regions TEXT DEFAULT '[]',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS rate_limits (
		key TEXT PRIMARY KEY,
		count INTEGER DEFAULT 0,
		expires_at DATETIME NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);

	CREATE TABLE IF NOT EXISTS visit_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		session_id TEXT NOT NULL,
		pano_id TEXT NOT NULL,
		latitude REAL NOT NULL,
		longitude REAL NOT NULL,
		country TEXT DEFAULT '',
		city TEXT DEFAULT '',
		formatted_address TEXT DEFAULT '',
		source TEXT DEFAULT 'random',
		visited_at DATETIME DEFAULT (datetime('now'))
	);

	CREATE INDEX IF NOT EXISTS idx_visit_history_session ON visit_history(session_id);
	CREATE INDEX IF NOT EXISTS idx_visit_history_visited_at ON visit_history(visited_at);
	CREATE INDEX IF NOT EXISTS idx_visit_history_session_pano ON visit_history(session_id, pano_id);
	CREATE INDEX IF NOT EXISTS idx_visit_history_session_visited_at ON visit_history(session_id, visited_at DESC, id DESC);

	CREATE TABLE IF NOT EXISTS agent_journeys (
		id TEXT PRIMARY KEY,
		token TEXT NOT NULL,
		start_lat REAL NOT NULL,
		start_lng REAL NOT NULL,
		total_stops INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		letter TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_agent_journeys_token ON agent_journeys(token);

	CREATE TABLE IF NOT EXISTS agent_journey_stops (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		journey_id TEXT NOT NULL,
		stop_number INTEGER NOT NULL,
		lat REAL NOT NULL,
		lng REAL NOT NULL,
		pano_id TEXT DEFAULT '',
		photo_heading INTEGER DEFAULT 0,
		location_info TEXT DEFAULT '',
		ai_description TEXT DEFAULT '',
		journal_entry TEXT DEFAULT '',
		next_reasoning TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (journey_id) REFERENCES agent_journeys(id)
	);

	CREATE INDEX IF NOT EXISTS idx_agent_stops_journey ON agent_journey_stops(journey_id);
	`

	_, err := r.db.Exec(schema)
	return err
}

// cleanupLoop 定期清理过期的 rate limit 记录
func (r *SQLiteRepository) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		r.db.Exec("DELETE FROM rate_limits WHERE expires_at < datetime('now')")
	}
}

// Close 关闭数据库连接
func (r *SQLiteRepository) Close() error {
	return r.db.Close()
}

// ==================== 位置相关方法 ====================

func (r *SQLiteRepository) SaveLocation(location models.Location) error {
	if location.CreatedAt.IsZero() {
		location.CreatedAt = time.Now()
	}

	_, err := r.db.Exec(`
		INSERT INTO locations (pano_id, latitude, longitude, formatted_address, country, city, is_mock, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(pano_id) DO UPDATE SET
			latitude = excluded.latitude,
			longitude = excluded.longitude,
			formatted_address = excluded.formatted_address,
			country = excluded.country,
			city = excluded.city,
			is_mock = excluded.is_mock
	`,
		location.PanoID, location.Latitude, location.Longitude,
		location.FormattedAddress, location.Country, location.City,
		boolToInt(location.IsMock), location.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("保存位置信息失败: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) GetLocationByPanoID(panoID string) (*models.Location, error) {
	row := r.db.QueryRow(`
		SELECT pano_id, latitude, longitude, formatted_address, country, city,
		       is_mock, created_at
		FROM locations WHERE pano_id = ?
	`, panoID)

	var loc models.Location
	var isMock int

	err := row.Scan(
		&loc.PanoID, &loc.Latitude, &loc.Longitude,
		&loc.FormattedAddress, &loc.Country, &loc.City,
		&isMock, &loc.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("%w: %s", ErrLocationNotFound, panoID)
	}
	if err != nil {
		return nil, fmt.Errorf("获取位置信息失败: %w", err)
	}

	loc.IsMock = isMock != 0

	return &loc, nil
}

// ==================== 探索偏好相关方法 ====================

func (r *SQLiteRepository) SaveExplorationPreference(sessionID string, pref models.ExplorationPreference) error {
	if pref.CreatedAt.IsZero() {
		pref.CreatedAt = time.Now()
	}
	if pref.LastUsedAt.IsZero() {
		pref.LastUsedAt = time.Now()
	}

	regionsJSON, err := marshalJSON(pref.Regions)
	if err != nil {
		return fmt.Errorf("序列化区域数据失败: %w", err)
	}

	_, err = r.db.Exec(`
		INSERT INTO exploration_preferences (session_id, interest, regions, created_at, last_used_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET
			interest = excluded.interest,
			regions = excluded.regions,
			last_used_at = excluded.last_used_at
	`,
		sessionID, pref.Interest, regionsJSON, pref.CreatedAt, pref.LastUsedAt,
	)
	if err != nil {
		return fmt.Errorf("保存探索偏好失败: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) GetExplorationPreference(sessionID string) (*models.ExplorationPreference, error) {
	row := r.db.QueryRow(`
		SELECT interest, regions, created_at, last_used_at
		FROM exploration_preferences WHERE session_id = ?
	`, sessionID)

	var interest string
	var regionsJSON string
	var pref models.ExplorationPreference

	err := row.Scan(&interest, &regionsJSON, &pref.CreatedAt, &pref.LastUsedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("获取探索偏好失败: %w", err)
	}

	pref.Interest = interest
	if err := unmarshalJSON(regionsJSON, &pref.Regions); err != nil {
		return nil, nil // 解析失败视为无偏好
	}

	return &pref, nil
}

func (r *SQLiteRepository) DeleteExplorationPreference(sessionID string) error {
	_, err := r.db.Exec("DELETE FROM exploration_preferences WHERE session_id = ?", sessionID)
	if err != nil {
		return fmt.Errorf("删除探索偏好失败: %w", err)
	}
	return nil
}

// ==================== 限流相关方法 ====================

// CheckAndIncrement 检查并增加计数（实现 RateLimiter 接口）
func (r *SQLiteRepository) CheckAndIncrement(key string, maxRequests int, window time.Duration) (bool, int, error) {
	now := time.Now()
	expiresAt := now.Add(window)

	r.mu.Lock()
	defer r.mu.Unlock()

	// 先清理过期记录，再查询/插入，在同一个事务中
	tx, err := r.db.Begin()
	if err != nil {
		return true, 0, err
	}
	defer tx.Rollback()

	// 删除此 key 的过期记录
	tx.Exec("DELETE FROM rate_limits WHERE key = ? AND expires_at < ?", key, now)

	// 尝试插入或更新
	var count int
	err = tx.QueryRow("SELECT count FROM rate_limits WHERE key = ?", key).Scan(&count)
	if err == sql.ErrNoRows {
		// 新记录
		_, err = tx.Exec("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)", key, expiresAt)
		if err != nil {
			return true, 0, err
		}
		tx.Commit()
		return true, maxRequests - 1, nil
	}
	if err != nil {
		return true, 0, err
	}

	// 更新计数
	count++
	_, err = tx.Exec("UPDATE rate_limits SET count = ? WHERE key = ?", count, key)
	if err != nil {
		return true, 0, err
	}

	tx.Commit()

	remaining := maxRequests - count
	if remaining < 0 {
		remaining = 0
	}

	return count <= maxRequests, remaining, nil
}

// GetCount 获取当前计数（实现 RateLimiter 接口）
func (r *SQLiteRepository) GetCount(key string) (int64, error) {
	var count int64
	err := r.db.QueryRow(
		"SELECT count FROM rate_limits WHERE key = ? AND expires_at > datetime('now')",
		key,
	).Scan(&count)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return count, nil
}

// ==================== 访问记录相关方法 ====================

func (r *SQLiteRepository) RecordVisit(sessionID string, loc models.Location, source string) error {
	_, err := r.db.Exec(`
		INSERT INTO visit_history (session_id, pano_id, latitude, longitude, country, city, formatted_address, source)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		sessionID, loc.PanoID, loc.Latitude, loc.Longitude,
		loc.Country, loc.City, loc.FormattedAddress, source,
	)
	if err != nil {
		return fmt.Errorf("记录访问失败: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) GetVisitHistory(sessionID string, limit, offset int) ([]models.VisitRecord, int64, int64, error) {
	// 获取总访问次数
	var totalVisits int64
	err := r.db.QueryRow("SELECT COUNT(*) FROM visit_history WHERE session_id = ?", sessionID).Scan(&totalVisits)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("获取访问记录总数失败: %w", err)
	}

	// 获取唯一地点数
	var uniquePlaces int64
	err = r.db.QueryRow("SELECT COUNT(DISTINCT pano_id) FROM visit_history WHERE session_id = ?", sessionID).Scan(&uniquePlaces)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("获取唯一地点数失败: %w", err)
	}

	// 获取分页数据
	rows, err := r.db.Query(`
		SELECT id, session_id, pano_id, latitude, longitude, country, city, formatted_address, source, visited_at
		FROM visit_history
		WHERE session_id = ?
		ORDER BY visited_at DESC, id DESC
		LIMIT ? OFFSET ?
	`, sessionID, limit, offset)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("获取访问记录失败: %w", err)
	}
	defer rows.Close()

	visits, err := scanVisitRows(rows)
	if err != nil {
		return nil, 0, 0, err
	}

	return visits, totalVisits, uniquePlaces, nil
}

func (r *SQLiteRepository) GetGlobalVisitHistory(limit, offset int) ([]models.VisitRecord, int64, int64, error) {
	// 获取全站总访问次数
	var totalVisits int64
	err := r.db.QueryRow("SELECT COUNT(*) FROM visit_history").Scan(&totalVisits)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("获取全站访问记录总数失败: %w", err)
	}

	// 获取全站唯一地点数
	var uniquePlaces int64
	err = r.db.QueryRow("SELECT COUNT(DISTINCT pano_id) FROM visit_history").Scan(&uniquePlaces)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("获取全站唯一地点数失败: %w", err)
	}

	rows, err := r.db.Query(`
		SELECT id, session_id, pano_id, latitude, longitude, country, city, formatted_address, source, visited_at
		FROM visit_history
		ORDER BY visited_at DESC, id DESC
		LIMIT ? OFFSET ?
	`, limit, offset)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("获取全站访问记录失败: %w", err)
	}
	defer rows.Close()

	visits, err := scanVisitRows(rows)
	if err != nil {
		return nil, 0, 0, err
	}

	return visits, totalVisits, uniquePlaces, nil
}

func scanVisitRows(rows *sql.Rows) ([]models.VisitRecord, error) {
	var visits []models.VisitRecord
	for rows.Next() {
		var v models.VisitRecord
		if err := rows.Scan(&v.ID, &v.SessionID, &v.PanoID, &v.Latitude, &v.Longitude,
			&v.Country, &v.City, &v.FormattedAddress, &v.Source, &v.VisitedAt); err != nil {
			return nil, fmt.Errorf("扫描访问记录失败: %w", err)
		}
		v.SessionID = "" // 不返回 session_id 给前端
		visits = append(visits, v)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("遍历访问记录失败: %w", err)
	}

	return visits, nil
}

// ==================== Agent Journey 相关方法 ====================

func (r *SQLiteRepository) CreateJourney(journey models.AgentJourney) error {
	_, err := r.db.Exec(`
		INSERT INTO agent_journeys (id, token, start_lat, start_lng, total_stops, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		journey.ID, journey.Token, journey.StartLat, journey.StartLng,
		journey.TotalStops, journey.Status, journey.CreatedAt, journey.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("创建旅程失败: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) GetJourney(id string) (*models.AgentJourney, error) {
	row := r.db.QueryRow(`
		SELECT id, token, start_lat, start_lng, total_stops, status, letter, created_at, updated_at
		FROM agent_journeys WHERE id = ?
	`, id)

	var j models.AgentJourney
	err := row.Scan(&j.ID, &j.Token, &j.StartLat, &j.StartLng,
		&j.TotalStops, &j.Status, &j.Letter, &j.CreatedAt, &j.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("获取旅程失败: %w", err)
	}
	return &j, nil
}

func (r *SQLiteRepository) GetJourneysByToken(token string) ([]models.AgentJourney, error) {
	rows, err := r.db.Query(`
		SELECT id, token, start_lat, start_lng, total_stops, status, letter, created_at, updated_at
		FROM agent_journeys WHERE token = ?
		ORDER BY created_at DESC
	`, token)
	if err != nil {
		return nil, fmt.Errorf("获取旅程列表失败: %w", err)
	}
	defer rows.Close()

	var journeys []models.AgentJourney
	for rows.Next() {
		var j models.AgentJourney
		if err := rows.Scan(&j.ID, &j.Token, &j.StartLat, &j.StartLng,
			&j.TotalStops, &j.Status, &j.Letter, &j.CreatedAt, &j.UpdatedAt); err != nil {
			return nil, fmt.Errorf("扫描旅程记录失败: %w", err)
		}
		j.Token = "" // 不返回 token
		journeys = append(journeys, j)
	}
	return journeys, rows.Err()
}

func (r *SQLiteRepository) UpdateJourneyStatus(id, token, status string) error {
	result, err := r.db.Exec(`
		UPDATE agent_journeys SET status = ?, updated_at = ?
		WHERE id = ? AND token = ?
	`, status, time.Now(), id, token)
	if err != nil {
		return fmt.Errorf("更新旅程状态失败: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("旅程不存在或 token 不匹配")
	}
	return nil
}

func (r *SQLiteRepository) SaveJourneyLetter(id, token, letter string) error {
	result, err := r.db.Exec(`
		UPDATE agent_journeys SET letter = ?, status = ?, updated_at = ?
		WHERE id = ? AND token = ?
	`, letter, models.JourneyStatusCompleted, time.Now(), id, token)
	if err != nil {
		return fmt.Errorf("保存旅程信件失败: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("旅程不存在或 token 不匹配")
	}
	return nil
}

func (r *SQLiteRepository) SaveJourneyStop(stop models.AgentJourneyStop) error {
	_, err := r.db.Exec(`
		INSERT INTO agent_journey_stops (journey_id, stop_number, lat, lng, pano_id, photo_heading, location_info, ai_description, journal_entry, next_reasoning, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		stop.JourneyID, stop.StopNumber, stop.Lat, stop.Lng,
		stop.PanoID, stop.PhotoHeading, stop.LocationInfo, stop.AIDescription,
		stop.JournalEntry, stop.NextReasoning, stop.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("保存旅程站点失败: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) GetJourneyStops(journeyID string) ([]models.AgentJourneyStop, error) {
	rows, err := r.db.Query(`
		SELECT id, journey_id, stop_number, lat, lng, pano_id, photo_heading, location_info, ai_description, journal_entry, next_reasoning, created_at
		FROM agent_journey_stops WHERE journey_id = ?
		ORDER BY stop_number ASC
	`, journeyID)
	if err != nil {
		return nil, fmt.Errorf("获取旅程站点失败: %w", err)
	}
	defer rows.Close()

	var stops []models.AgentJourneyStop
	for rows.Next() {
		var s models.AgentJourneyStop
		if err := rows.Scan(&s.ID, &s.JourneyID, &s.StopNumber, &s.Lat, &s.Lng,
			&s.PanoID, &s.PhotoHeading, &s.LocationInfo, &s.AIDescription,
			&s.JournalEntry, &s.NextReasoning, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("扫描旅程站点失败: %w", err)
		}
		stops = append(stops, s)
	}
	return stops, rows.Err()
}

func (r *SQLiteRepository) GetTotalPlacesByToken(token string) (int64, error) {
	var count int64
	err := r.db.QueryRow(`
		SELECT COUNT(*) FROM agent_journey_stops
		WHERE journey_id IN (SELECT id FROM agent_journeys WHERE token = ?)
	`, token).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// ==================== 辅助函数 ====================

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
