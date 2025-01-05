package main

import (
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/my-streetview-project/backend/internal/api"
	"github.com/my-streetview-project/backend/internal/config"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/services"
)

func main() {
	// 加载配置
	cfg := config.New()

	// 初始化 Redis 客户端
	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddress(),
		Password: cfg.RedisPassword(),
		DB:       0,
	})

	// 初始化 Redis 仓库
	repo, err := repositories.NewRedisRepository(cfg)
	if err != nil {
		log.Fatalf("初始化仓库失败: %v", err)
	}

	// 初始化服务
	aiService, err := services.NewAIService(cfg, repo)
	if err != nil {
		log.Fatalf("初始化 AI 服务失败: %v", err)
	}

	mapsService, err := services.NewMapsService(cfg.GoogleMapsAPIKey())
	if err != nil {
		log.Fatalf("初始化 Maps 服务失败: %v", err)
	}

	locationService := services.NewLocationService(repo, aiService, mapsService)

	// 设置 Gin 路由
	if cfg.SecurityConfig().RateLimit.Enabled {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()

	// 添加中间件
	r.Use(gin.Recovery())
	r.Use(gin.Logger())
	r.Use(api.ErrorHandler())
	r.Use(api.CORSMiddleware())

	// 根据配置启用限流
	if cfg.SecurityConfig().RateLimit.Enabled {
		r.Use(api.RateLimitMiddleware(redisClient))
	}

	r.Use(api.InputValidationMiddleware())
	r.Use(api.SessionMiddleware())

	// 添加健康检查接口
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status": "ok",
			"config": map[string]interface{}{
				"rate_limit_enabled": cfg.SecurityConfig().RateLimit.Enabled,
				"cors_origins":       cfg.SecurityConfig().CORS.AllowedOrigins,
			},
		})
	})

	// 设置路由
	handlers := api.NewHandlers(locationService, aiService)
	api.SetupRoutes(r, handlers)

	addr := cfg.ServerAddress()
	fmt.Printf("服务器运行在 %s\n", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("服务器运行失败: %v", err)
	}
}
