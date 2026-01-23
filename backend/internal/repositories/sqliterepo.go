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
		ai_description_en TEXT DEFAULT '',
		ai_description_zh TEXT DEFAULT '',
		ai_description_en_at DATETIME,
		ai_description_zh_at DATETIME,
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
		       ai_description_en, ai_description_zh, ai_description_en_at, ai_description_zh_at,
		       is_mock, created_at
		FROM locations WHERE pano_id = ?
	`, panoID)

	var loc models.Location
	var isMock int
	var descENAt, descZHAt sql.NullTime

	err := row.Scan(
		&loc.PanoID, &loc.Latitude, &loc.Longitude,
		&loc.FormattedAddress, &loc.Country, &loc.City,
		&loc.AIDescriptionEN, &loc.AIDescriptionZH,
		&descENAt, &descZHAt,
		&isMock, &loc.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("位置不存在: %s", panoID)
	}
	if err != nil {
		return nil, fmt.Errorf("获取位置信息失败: %w", err)
	}

	loc.IsMock = isMock != 0
	if descENAt.Valid {
		loc.AIDescriptionENAt = &descENAt.Time
	}
	if descZHAt.Valid {
		loc.AIDescriptionZHAt = &descZHAt.Time
	}

	return &loc, nil
}

func (r *SQLiteRepository) UpdateAIDescription(panoID, language, description string) error {
	now := time.Now()

	var query string
	switch language {
	case "en":
		query = "UPDATE locations SET ai_description_en = ?, ai_description_en_at = ? WHERE pano_id = ?"
	case "zh":
		query = "UPDATE locations SET ai_description_zh = ?, ai_description_zh_at = ? WHERE pano_id = ?"
	default:
		return fmt.Errorf("不支持的语言: %s", language)
	}

	_, err := r.db.Exec(query, description, now, panoID)
	if err != nil {
		return fmt.Errorf("更新 AI 描述失败: %w", err)
	}
	return nil
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

// ==================== 辅助函数 ====================

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
