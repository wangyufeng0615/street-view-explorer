package repositories

import (
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

// Repository 数据存储接口
type Repository interface {
	// 位置相关
	SaveLocation(location models.Location) error
	GetLocationByPanoID(panoID string) (*models.Location, error)

	// 探索偏好相关
	SaveExplorationPreference(sessionID string, pref models.ExplorationPreference) error
	GetExplorationPreference(sessionID string) (*models.ExplorationPreference, error)
	DeleteExplorationPreference(sessionID string) error
}

// RateLimiter 限流器接口
type RateLimiter interface {
	CheckAndIncrement(key string, maxRequests int, window time.Duration) (allowed bool, remaining int, err error)
	GetCount(key string) (int64, error)
}
