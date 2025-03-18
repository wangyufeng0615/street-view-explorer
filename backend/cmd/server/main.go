package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/my-streetview-project/backend/internal/api"
	"github.com/my-streetview-project/backend/internal/config"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/services"
	"github.com/my-streetview-project/backend/internal/utils"
)

func main() {
	// 解析命令行参数
	proxyURL := flag.String("proxy", "", "HTTP代理URL，例如：http://localhost:10086")
	proxyType := flag.String("proxy-type", "http", "代理类型: http 或 socks5")
	proxyUser := flag.String("proxy-user", "", "代理认证用户名")
	proxyPass := flag.String("proxy-pass", "", "代理认证密码")
	openaiProxy := flag.String("openai-proxy", "", "OpenAI专用代理URL")
	mapsProxy := flag.String("maps-proxy", "", "Google Maps专用代理URL")
	skipProxyCheck := flag.Bool("skip-proxy-check", false, "跳过代理健康检查")
	flag.Parse()

	// 如果指定了代理，设置环境变量
	if *proxyURL != "" {
		os.Setenv("PROXY_URL", *proxyURL)
		os.Setenv("PROXY_TYPE", *proxyType)
		if *proxyUser != "" {
			os.Setenv("PROXY_USER", *proxyUser)
			os.Setenv("PROXY_PASS", *proxyPass)
		}
		log.Printf("使用代理: %s (类型: %s)", *proxyURL, *proxyType)

		// 检查代理健康状态
		if !*skipProxyCheck {
			err := utils.CheckProxyHealth(*proxyURL, 5*time.Second)
			if err != nil {
				log.Printf("警告: 代理健康检查失败: %v", err)
				log.Printf("服务将继续启动，但可能无法正常访问外部API")
			} else {
				log.Printf("代理健康检查通过")
			}
		}
	}

	// 设置服务特定代理
	if *openaiProxy != "" {
		os.Setenv("OPENAI_PROXY_URL", *openaiProxy)
		log.Printf("OpenAI使用专用代理: %s", *openaiProxy)

		// 检查OpenAI专用代理健康状态
		if !*skipProxyCheck {
			err := utils.CheckProxyHealth(*openaiProxy, 5*time.Second)
			if err != nil {
				log.Printf("警告: OpenAI代理健康检查失败: %v", err)
			} else {
				log.Printf("OpenAI代理健康检查通过")
			}
		}
	}
	if *mapsProxy != "" {
		os.Setenv("MAPS_PROXY_URL", *mapsProxy)
		log.Printf("Google Maps使用专用代理: %s", *mapsProxy)

		// 检查Maps专用代理健康状态
		if !*skipProxyCheck {
			err := utils.CheckProxyHealth(*mapsProxy, 5*time.Second)
			if err != nil {
				log.Printf("警告: Google Maps代理健康检查失败: %v", err)
			} else {
				log.Printf("Google Maps代理健康检查通过")
			}
		}
	}

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
		// 检查代理状态
		proxyStatus := "disabled"
		if cfg.ProxyURL() != "" {
			if !*skipProxyCheck {
				err := utils.CheckProxyHealth(cfg.ProxyURL(), 2*time.Second)
				if err != nil {
					proxyStatus = "unhealthy"
				} else {
					proxyStatus = "healthy"
				}
			} else {
				proxyStatus = "enabled"
			}
		}

		c.JSON(200, gin.H{
			"status": "ok",
			"config": map[string]interface{}{
				"rate_limit_enabled": cfg.SecurityConfig().RateLimit.Enabled,
				"cors_origins":       cfg.SecurityConfig().CORS.AllowedOrigins,
				"proxy_enabled":      cfg.ProxyURL() != "",
				"proxy_type":         os.Getenv("PROXY_TYPE"),
				"proxy_status":       proxyStatus,
				"openai_proxy":       os.Getenv("OPENAI_PROXY_URL") != "",
				"maps_proxy":         os.Getenv("MAPS_PROXY_URL") != "",
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
