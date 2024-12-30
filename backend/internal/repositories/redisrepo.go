package repositories

import (
	"errors"
	"math/rand"
	"time"

	"github.com/my-streetview-project/backend/internal/models"

	"context"
	"fmt"
	"strconv"

	"encoding/json"

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
		Addr:            cfg.RedisAddress(),
		DB:              0,
		PoolSize:        10,
		MinIdleConns:    5,
		ConnMaxLifetime: time.Hour,
		ConnMaxIdleTime: 30 * time.Minute,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("Redis连接失败: %w", err)
	}

	return &RedisRepository{client: rdb}, nil
}

func (r *RedisRepository) GetRandomLocation() (models.Location, error) {
	ctx := context.Background()
	// Example: get all members from `locations` set and randomly pick one
	locs, err := r.client.SMembers(ctx, "locations").Result()
	if err != nil || len(locs) == 0 {
		return models.Location{}, errors.New("no locations available or redis error")
	}

	rand.Seed(time.Now().UnixNano())
	chosen := locs[rand.Intn(len(locs))]
	return r.GetLocationByID(chosen)
}

func (r *RedisRepository) GetLocationByID(locationID string) (models.Location, error) {
	ctx := context.Background()
	key := fmt.Sprintf("location:%s", locationID)
	fields, err := r.client.HGetAll(ctx, key).Result()
	if err != nil || len(fields) == 0 {
		return models.Location{}, errors.New("location not found")
	}

	// 从 data 字段中解析完整的位置信息
	var loc models.Location
	if data, ok := fields["data"]; ok {
		if err := json.Unmarshal([]byte(data), &loc); err != nil {
			return models.Location{}, fmt.Errorf("解析位置数据失败: %w", err)
		}
		// 确保使用最新的点赞数
		if likes, err := strconv.Atoi(fields["likes"]); err == nil {
			loc.Likes = likes
		}
		return loc, nil
	}

	return models.Location{}, errors.New("invalid location data")
}

func (r *RedisRepository) IncrementLike(locationID string) (int, error) {
	ctx := context.Background()
	locKey := fmt.Sprintf("location:%s", locationID)

	newLikes, err := r.client.HIncrBy(ctx, locKey, "likes", 1).Result()
	if err != nil {
		return 0, err
	}

	// Update leaderboard score
	_, err = r.client.ZAdd(ctx, "location_likes", redis.Z{
		Score:  float64(newLikes),
		Member: locationID,
	}).Result()
	if err != nil {
		return 0, err
	}

	return int(newLikes), nil
}

func (r *RedisRepository) GetLeaderboard(page, pageSize int) ([]models.Location, error) {
	ctx := context.Background()
	start := int64((page - 1) * pageSize)
	stop := start + int64(pageSize) - 1

	ids, err := r.client.ZRevRange(ctx, "location_likes", start, stop).Result()
	if err != nil {
		return nil, err
	}

	var results []models.Location
	for _, id := range ids {
		loc, err := r.GetLocationByID(id)
		if err == nil {
			results = append(results, loc)
		}
	}
	return results, nil
}

func (r *RedisRepository) GetAllLikes() ([]models.Location, error) {
	ctx := context.Background()
	// Get all from ZSET
	ids, err := r.client.ZRange(ctx, "location_likes", 0, -1).Result()
	if err != nil {
		return nil, err
	}

	var results []models.Location
	for _, id := range ids {
		loc, err := r.GetLocationByID(id)
		if err == nil {
			results = append(results, loc)
		}
	}
	return results, nil
}

func (r *RedisRepository) SetAIDescription(locationID, desc string) error {
	ctx := context.Background()
	key := fmt.Sprintf("ai_description:%s", locationID)
	return r.client.HSet(ctx, key, "desc", desc).Err()
}

func (r *RedisRepository) GetAIDescription(locationID string) (string, error) {
	ctx := context.Background()
	key := fmt.Sprintf("ai_description:%s", locationID)
	return r.client.HGet(ctx, key, "desc").Result()
}
