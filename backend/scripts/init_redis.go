package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

// 从JSON文件加载位置数据
func loadLocationsFromFile(filePath string) ([]models.Location, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("读取数据文件失败: %w", err)
	}

	var locations []models.Location
	if err := json.Unmarshal(data, &locations); err != nil {
		return nil, fmt.Errorf("解析JSON数据失败: %w", err)
	}

	return locations, nil
}

func main() {
	// 命令行参数
	redisAddr := flag.String("redis", "", "Redis地址 (例如: localhost:6379)")
	dataFile := flag.String("data", "", "位置数据JSON文件路径")
	flag.Parse()

	// 如果未指定Redis地址，尝试从环境变量获取
	if *redisAddr == "" {
		*redisAddr = os.Getenv("REDIS_ADDRESS")
		if *redisAddr == "" {
			*redisAddr = "localhost:6379" // 默认地址
		}
	}

	// 如果未指定数据文件，使用默认路径
	if *dataFile == "" {
		*dataFile = filepath.Join("data", "locations.json")
	}

	// 加载位置数据
	locations, err := loadLocationsFromFile(*dataFile)
	if err != nil {
		log.Fatalf("加载位置数据失败: %v", err)
	}

	// 连接Redis
	rdb := redis.NewClient(&redis.Options{
		Addr: *redisAddr,
		DB:   0,
	})

	ctx := context.Background()

	// 测试连接
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis连接失败: %v", err)
	}

	log.Printf("成功连接到Redis: %s", *redisAddr)

	// 清理现有数据
	if err := rdb.FlushDB(ctx).Err(); err != nil {
		log.Fatalf("清理数据库失败: %v", err)
	}

	// 添加位置数据
	for _, loc := range locations {
		// 确保时间字段有值
		if loc.CreatedAt.IsZero() {
			loc.CreatedAt = time.Now()
		}

		// 序列化位置信息
		data, err := json.Marshal(loc)
		if err != nil {
			log.Printf("序列化位置数据失败 %s: %v", loc.PanoID, err)
			continue
		}

		// 保存位置数据
		key := fmt.Sprintf("location:%s", loc.PanoID)
		if err := rdb.Set(ctx, key, data, 0).Err(); err != nil {
			log.Printf("保存位置数据失败 %s: %v", loc.PanoID, err)
			continue
		}

		// 添加到国家索引
		if loc.Country != "" {
			if err := rdb.SAdd(ctx, fmt.Sprintf("country:%s", loc.Country), loc.PanoID).Err(); err != nil {
				log.Printf("添加国家索引失败 %s: %v", loc.PanoID, err)
			}
		}

		// 添加到城市索引
		if loc.City != "" {
			if err := rdb.SAdd(ctx, fmt.Sprintf("city:%s", loc.City), loc.PanoID).Err(); err != nil {
				log.Printf("添加城市索引失败 %s: %v", loc.PanoID, err)
			}
		}

		// 更新点赞排行榜
		if err := rdb.ZAdd(ctx, "leaderboard", redis.Z{
			Score:  float64(loc.Likes),
			Member: loc.PanoID,
		}).Err(); err != nil {
			log.Printf("更新排行榜失败 %s: %v", loc.PanoID, err)
		}
	}

	log.Printf("成功初始化 %d 个位置数据", len(locations))
}
