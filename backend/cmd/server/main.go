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
	aiService := services.NewAIService(cfg, repo)
	locationService := services.NewLocationService(repo, aiService)

	// Setup Gin router
	r := gin.Default()

	// Add CORS middleware
	r.Use(api.CORSMiddleware())

	// Setup routes
	api.SetupRoutes(r, locationService, aiService)

	addr := ":8080" // 默认端口
	fmt.Printf("Server running on %s\n", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}
