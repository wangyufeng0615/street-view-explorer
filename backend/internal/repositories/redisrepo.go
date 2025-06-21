package repositories

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

type RedisConfig interface {
	RedisAddress() string
}

type RedisRepository struct {
	client *redis.Client
}

func NewRedisRepository(cfg RedisConfig) (Repository, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr: cfg.RedisAddress(),
		DB:   0,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("Redis连接失败: %w", err)
	}

	return &RedisRepository{client: rdb}, nil
}

// SaveLocation 保存位置信息到 Redis
func (r *RedisRepository) SaveLocation(location models.Location) error {
	ctx := context.Background()

	// 设置创建时间
	if location.CreatedAt.IsZero() {
		location.CreatedAt = time.Now()
	}

	// 序列化位置信息
	data, err := json.Marshal(location)
	if err != nil {
		return fmt.Errorf("序列化位置信息失败: %w", err)
	}

	// 使用 pano_id 作为键
	key := fmt.Sprintf("location:%s", location.PanoID)

	// 保存完整的位置信息
	err = r.client.Set(ctx, key, data, 0).Err()
	if err != nil {
		return fmt.Errorf("保存位置信息失败: %w", err)
	}

	// 添加到国家和城市的索引中
	if location.Country != "" {
		r.client.SAdd(ctx, fmt.Sprintf("country:%s", location.Country), location.PanoID)
	}
	if location.City != "" {
		r.client.SAdd(ctx, fmt.Sprintf("city:%s", location.City), location.PanoID)
	}

	return nil
}

// GetLocationByPanoID 通过全景图ID获取位置信息
func (r *RedisRepository) GetLocationByPanoID(panoID string) (models.Location, error) {
	ctx := context.Background()
	key := fmt.Sprintf("location:%s", panoID)

	data, err := r.client.Get(ctx, key).Bytes()
	if err != nil {
		return models.Location{}, fmt.Errorf("获取位置信息失败: %w", err)
	}

	var location models.Location
	if err := json.Unmarshal(data, &location); err != nil {
		return models.Location{}, fmt.Errorf("解析位置信息失败: %w", err)
	}

	// 更新访问信息
	location.LastAccessedAt = time.Now()
	location.AccessCount++
	r.SaveLocation(location)

	return location, nil
}


// SaveExplorationPreference 保存用户的探索偏好
func (r *RedisRepository) SaveExplorationPreference(sessionID string, pref models.ExplorationPreference) error {
	ctx := context.Background()
	key := fmt.Sprintf("exploration_preference:%s", sessionID)

	// 将偏好转换为 JSON
	data, err := json.Marshal(pref)
	if err != nil {
		return fmt.Errorf("序列化探索偏好失败: %w", err)
	}

	// 保存到 Redis，不设置过期时间
	if err := r.client.Set(ctx, key, data, 0).Err(); err != nil {
		return fmt.Errorf("保存探索偏好失败: %w", err)
	}

	return nil
}

// GetExplorationPreference 获取用户的探索偏好
func (r *RedisRepository) GetExplorationPreference(sessionID string) (*models.ExplorationPreference, error) {
	ctx := context.Background()
	key := fmt.Sprintf("exploration_preference:%s", sessionID)

	// 从 Redis 获取数据
	data, err := r.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, nil // 没有找到探索偏好
	}
	if err != nil {
		return nil, fmt.Errorf("获取探索偏好失败: %w", err)
	}

	// 解析 JSON 数据
	var pref models.ExplorationPreference
	if err := json.Unmarshal([]byte(data), &pref); err != nil {
		return nil, fmt.Errorf("解析探索偏好失败: %w", err)
	}

	return &pref, nil
}

// DeleteExplorationPreference 删除用户的探索偏好
func (r *RedisRepository) DeleteExplorationPreference(sessionID string) error {
	ctx := context.Background()
	key := fmt.Sprintf("exploration_preference:%s", sessionID)

	if err := r.client.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("删除探索偏好失败: %w", err)
	}

	return nil
}


// GetRedisClient returns the underlying redis client.
func (r *RedisRepository) GetRedisClient() *redis.Client {
	return r.client
}
