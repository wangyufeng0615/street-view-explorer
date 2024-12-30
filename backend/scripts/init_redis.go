package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/redis/go-redis/v9"
)

type Location struct {
	LocationID  string  `json:"location_id"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Likes       int     `json:"likes"`
	Description string  `json:"description"`
}

// 从JSON文件加载位置数据
func loadLocationsFromFile(filePath string) ([]Location, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("读取数据文件失败: %w", err)
	}

	var locations []Location
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
		// 将位置ID添加到位置集合
		if err := rdb.SAdd(ctx, "locations", loc.LocationID).Err(); err != nil {
			log.Printf("添加位置ID失败 %s: %v", loc.LocationID, err)
			continue
		}

		// 存储位置详情
		locJSON, _ := json.Marshal(loc)
		if err := rdb.HSet(ctx,
			fmt.Sprintf("location:%s", loc.LocationID),
			"data", string(locJSON),
			"likes", loc.Likes,
		).Err(); err != nil {
			log.Printf("存储位置详情失败 %s: %v", loc.LocationID, err)
		}

		// 存储位置描述
		if loc.Description != "" {
			if err := rdb.HSet(ctx,
				fmt.Sprintf("ai_description:%s", loc.LocationID),
				"desc", loc.Description,
			).Err(); err != nil {
				log.Printf("存储位置描述失败 %s: %v", loc.LocationID, err)
			}
		}

		// 更新点赞排行榜
		if err := rdb.ZAdd(ctx, "location_likes", redis.Z{
			Score:  float64(loc.Likes),
			Member: loc.LocationID,
		}).Err(); err != nil {
			log.Printf("更新排行榜失败 %s: %v", loc.LocationID, err)
		}
	}

	log.Printf("成功初始化 %d 个位置数据", len(locations))
}
