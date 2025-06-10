package repositories

import (
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

type Repository interface {
	// 保存新的位置记录
	SaveLocation(location models.Location) error

	// 获取位置记录
	GetLocationByPanoID(panoID string) (models.Location, error)

	// AI 描述相关
	SaveAIDescription(panoID, description string, language string) error
	SaveAIDescriptionWithHistory(panoID, description string, language string, conversationHistory string) error
	GetAIDescription(panoID string) (string, error)

	// 探索偏好相关
	SaveExplorationPreference(sessionID string, pref models.ExplorationPreference) error
	GetExplorationPreference(sessionID string) (*models.ExplorationPreference, error)
	DeleteExplorationPreference(sessionID string) error

	// 获取 Redis 客户端
	GetRedisClient() *redis.Client
}
