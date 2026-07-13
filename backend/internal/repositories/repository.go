package repositories

import (
	"errors"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

var ErrLocationNotFound = errors.New("位置不存在")

// Repository 数据存储接口
type Repository interface {
	// 位置相关
	SaveLocation(location models.Location) error
	GetLocationByPanoID(panoID string) (*models.Location, error)

	// 探索偏好相关
	SaveExplorationPreference(sessionID string, pref models.ExplorationPreference) error
	GetExplorationPreference(sessionID string) (*models.ExplorationPreference, error)
	DeleteExplorationPreference(sessionID string) error

	// 访问记录相关
	RecordVisit(sessionID string, loc models.Location, source string) error
	GetVisitHistory(sessionID string, limit, offset int) ([]models.VisitRecord, int64, int64, error)
	GetGlobalVisitHistory(limit, offset int, sources ...string) ([]models.VisitRecord, int64, int64, error)

	// Agent Journey 相关
	CreateJourney(journey models.AgentJourney) error
	GetJourney(id string) (*models.AgentJourney, error)
	GetJourneysByToken(token string) ([]models.AgentJourney, error)
	UpdateJourneyStatus(id, token, status string) error
	SaveJourneyLetter(id, token, letter string) error
	SaveJourneyStop(stop models.AgentJourneyStop) error
	GetJourneyStops(journeyID string) ([]models.AgentJourneyStop, error)
	GetTotalPlacesByToken(token string) (int64, error)
}

// RateLimiter 限流器接口
type RateLimiter interface {
	CheckAndIncrement(key string, maxRequests int, window time.Duration) (allowed bool, remaining int, err error)
	GetCount(key string) (int64, error)
}
