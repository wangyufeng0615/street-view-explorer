package main

import (
	"fmt"
	"log"

	"github.com/my-streetview-project/backend/internal/api"
	"github.com/my-streetview-project/backend/internal/config"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/services"

	"github.com/gin-gonic/gin"
)

func main() {
	// Load configuration
	cfg := config.New()

	// Initialize Redis repository
	repo, err := repositories.NewRedisRepository(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize repository: %v", err)
	}

	// Initialize services
	aiService, err := services.NewAIService(cfg, repo)
	if err != nil {
		log.Fatalf("初始化 AI 服务失败: %v", err)
	}

	// Initialize Maps service
	mapsService, err := services.NewMapsService(cfg.GoogleMapsAPIKey())
	if err != nil {
		log.Fatalf("初始化 Maps 服务失败: %v", err)
	}

	locationService := services.NewLocationService(repo, aiService, mapsService)

	// Setup Gin router
	r := gin.Default()

	// Add CORS middleware
	r.Use(api.CORSMiddleware())

	// 添加健康检查接口
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Setup routes
	handlers := api.NewHandlers(locationService, aiService)
	api.SetupRoutes(r, handlers)

	addr := cfg.ServerAddress()
	fmt.Printf("Server running on %s\n", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}
