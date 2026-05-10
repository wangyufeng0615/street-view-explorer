package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/api"
	"github.com/my-streetview-project/backend/internal/config"
	"github.com/my-streetview-project/backend/internal/openai"
	"github.com/my-streetview-project/backend/internal/repositories"
	mysentry "github.com/my-streetview-project/backend/internal/sentry"
	"github.com/my-streetview-project/backend/internal/services"
	"github.com/my-streetview-project/backend/internal/utils"
)

func main() {
	// 检查是否是健康检查命令（需要在flag.Parse之前）
	if len(os.Args) > 1 && os.Args[1] == "health" {
		os.Exit(0)
	}

	// 解析命令行参数
	proxyURL := flag.String("proxy", "", "HTTP代理URL，例如：http://localhost:10086")
	proxyType := flag.String("proxy-type", "http", "代理类型: http 或 socks5")
	proxyUser := flag.String("proxy-user", "", "代理认证用户名")
	proxyPass := flag.String("proxy-pass", "", "代理认证密码")
	openaiProxy := flag.String("openai-proxy", "", "AI专用代理URL")
	mapsProxy := flag.String("maps-proxy", "", "Google Maps专用代理URL")
	voiceProvider := flag.String("voice-provider", "", "Atlas Voice 发声服务: openai 或 doubao")
	doubaoTTSAPIKey := flag.String("doubao-tts-api-key", "", "豆包语音合成新版控制台 API Key")
	doubaoTTSAppID := flag.String("doubao-tts-app-id", "", "豆包语音合成 App ID / App Key")
	doubaoTTSAccessKey := flag.String("doubao-tts-access-key", "", "豆包语音合成 Access Token / Access Key")
	doubaoTTSToken := flag.String("doubao-tts-token", "", "豆包语音合成 Access Token，等同于 --doubao-tts-access-key")
	doubaoTTSSpeaker := flag.String("doubao-tts-speaker", "", "豆包语音合成音色 speaker / voice_type")
	doubaoTTSResourceID := flag.String("doubao-tts-resource-id", "", "豆包语音合成 Resource ID，默认 volc.service_type.10029")
	doubaoTTSSpeechRate := flag.Int("doubao-tts-speech-rate", 0, "豆包语音合成语速，-50 到 100，默认 0")
	skipProxyCheck := flag.Bool("skip-proxy-check", false, "跳过代理健康检查")
	flag.Parse()

	// 加载配置
	cfg := config.New()
	cfg.SetSkipProxyCheck(*skipProxyCheck)

	// Initialize Sentry
	sentryCfg := mysentry.NewConfig()
	if err := mysentry.Init(sentryCfg); err != nil {
		log.Printf("Failed to initialize Sentry: %v", err)
	}
	defer sentry.Flush(2 * time.Second)

	// 如果指定了代理，设置环境变量
	if *proxyURL != "" {
		os.Setenv("PROXY_URL", *proxyURL)
		os.Setenv("PROXY_TYPE", *proxyType)
		if *proxyUser != "" {
			os.Setenv("PROXY_USER", *proxyUser)
			os.Setenv("PROXY_PASS", *proxyPass)
		}
		log.Printf("使用代理: %s (类型: %s)", *proxyURL, *proxyType)

		if !cfg.SkipProxyCheck() {
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
		os.Setenv("AI_PROXY_URL", *openaiProxy)
		log.Printf("AI使用专用代理: %s", *openaiProxy)

		if !cfg.SkipProxyCheck() {
			err := utils.CheckProxyHealth(*openaiProxy, 5*time.Second)
			if err != nil {
				log.Printf("警告: AI代理健康检查失败: %v", err)
			} else {
				log.Printf("AI代理健康检查通过")
			}
		}
	}
	if *mapsProxy != "" {
		os.Setenv("MAPS_PROXY_URL", *mapsProxy)
		log.Printf("Google Maps使用专用代理: %s", *mapsProxy)

		if !cfg.SkipProxyCheck() {
			err := utils.CheckProxyHealth(*mapsProxy, 5*time.Second)
			if err != nil {
				log.Printf("警告: Google Maps代理健康检查失败: %v", err)
			} else {
				log.Printf("Google Maps代理健康检查通过")
			}
		}
	}
	if *voiceProvider != "" {
		os.Setenv("ATLAS_VOICE_PROVIDER", *voiceProvider)
		log.Printf("Atlas Voice 发声服务: %s", *voiceProvider)
	}
	if *doubaoTTSAPIKey != "" {
		os.Setenv("DOUBAO_TTS_API_KEY", *doubaoTTSAPIKey)
	}
	if *doubaoTTSAppID != "" {
		os.Setenv("DOUBAO_TTS_APP_ID", *doubaoTTSAppID)
	}
	if *doubaoTTSAccessKey != "" {
		os.Setenv("DOUBAO_TTS_ACCESS_KEY", *doubaoTTSAccessKey)
	}
	if *doubaoTTSToken != "" {
		os.Setenv("DOUBAO_TTS_TOKEN", *doubaoTTSToken)
	}
	if *doubaoTTSSpeaker != "" {
		os.Setenv("DOUBAO_TTS_SPEAKER", *doubaoTTSSpeaker)
	}
	if *doubaoTTSResourceID != "" {
		os.Setenv("DOUBAO_TTS_RESOURCE_ID", *doubaoTTSResourceID)
	}
	if *doubaoTTSSpeechRate != 0 {
		os.Setenv("DOUBAO_TTS_SPEECH_RATE", fmt.Sprintf("%d", *doubaoTTSSpeechRate))
	}

	// 初始化地理数据（必须在服务启动时完成）
	log.Println("正在初始化地理数据...")
	if err := utils.InitializeGeoData(); err != nil {
		log.Fatalf("初始化地理数据失败: %v", err)
	}

	// 初始化 SQLite 数据库
	log.Printf("正在初始化 SQLite 数据库 (%s)...", cfg.SQLitePath())
	repo, err := repositories.NewSQLiteRepository(cfg)
	if err != nil {
		log.Fatalf("初始化 SQLite 数据库失败: %v", err)
	}
	defer repo.Close()

	// 初始化服务 — Global 模式 (Google Maps + OpenRouter default model)
	googleMaps, err := services.NewMapsService(cfg.GoogleMapsAPIKey())
	if err != nil {
		log.Fatalf("初始化 Google Maps 服务失败: %v", err)
	}

	globalAIClient := openai.NewClient(cfg.OpenAIAPIKey())
	aiService := services.NewAIService(cfg, repo, googleMaps, globalAIClient)
	locationService := services.NewLocationService(repo, aiService, googleMaps)
	geoBattleService := services.NewGeoBattleService(locationService)

	// 设置 Gin 路由
	if cfg.SecurityConfig().RateLimit.Enabled {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()

	// 添加中间件
	r.Use(gin.Recovery())
	r.Use(mysentry.Middleware(false))
	r.Use(api.RequestLoggingMiddleware())
	r.Use(api.ErrorHandler())

	// 根据配置启用限流（SQLiteRepository 同时实现了 RateLimiter 接口）
	if cfg.SecurityConfig().RateLimit.Enabled {
		r.Use(api.RateLimitMiddleware(repo))
	}

	r.Use(api.InputValidationMiddleware())
	r.Use(api.SessionMiddleware())

	if cfg.SecurityConfig().RateLimit.Enabled {
		r.Use(api.UserRateLimitMiddleware(repo))
	}

	// 添加健康检查接口
	r.GET("/health", func(c *gin.Context) {
		proxyStatus := "disabled"
		if cfg.ProxyURL() != "" {
			if !cfg.SkipProxyCheck() {
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
				"storage":            "sqlite",
				"rate_limit_enabled": cfg.SecurityConfig().RateLimit.Enabled,
				"cors_origins":       cfg.SecurityConfig().CORS.AllowedOrigins,
				"proxy_enabled":      cfg.ProxyURL() != "",
				"proxy_type":         os.Getenv("PROXY_TYPE"),
				"proxy_status":       proxyStatus,
				"ai_proxy":           os.Getenv("AI_PROXY_URL") != "",
				"maps_proxy":         os.Getenv("MAPS_PROXY_URL") != "",
				"voice_provider":     os.Getenv("ATLAS_VOICE_PROVIDER"),
			},
		})
	})

	// Add Sentry test endpoint
	r.GET("/test/sentry", mysentry.TestSentry())

	// 设置路由
	handlers := api.NewHandlers(locationService, aiService)
	agentHandlers := api.NewAgentHandlers(repo, repo, handlers.GlobalServices(), cfg.GoogleMapsAPIKey(), googleMaps.HTTPClient())
	geoHandlers := api.NewGeoHandlers(globalAIClient, cfg.GoogleMapsAPIKey(), locationService, geoBattleService, googleMaps.HTTPClient())
	realtimeHandlers := api.NewRealtimeHandlers()
	api.SetupRoutes(r, handlers, agentHandlers, realtimeHandlers, geoHandlers)

	addr := cfg.ServerAddress()
	logger := utils.SystemLogger()

	logger.Info("server_starting", "Starting HTTP server", map[string]interface{}{
		"address":       addr,
		"storage":       "sqlite",
		"sqlite_path":   cfg.SQLitePath(),
		"rate_limit":    cfg.SecurityConfig().RateLimit.Enabled,
		"proxy_enabled": cfg.ProxyURL() != "",
	})

	fmt.Printf("服务器运行在 %s\n", addr)
	if err := r.Run(addr); err != nil {
		logger.Error("server_failed", "Server failed to start", err, map[string]interface{}{
			"address": addr,
		})
		log.Fatalf("服务器运行失败: %v", err)
	}
}
