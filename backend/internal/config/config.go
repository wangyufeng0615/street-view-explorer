package config

import (
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config interface {
	ServerAddress() string
	RedisAddress() string
	RedisPassword() string
	OpenAIAPIKey() string
	GoogleMapsAPIKey() string
	EnableOpenAI() bool
	EnableGoogleAPI() bool
	SecurityConfig() *SecurityConfig
	ProxyURL() string
	ProxyType() string
	ProxyAuth() (string, string)
	OpenAIProxyURL() string
	MapsProxyURL() string
}

type config struct {
	serverAddress    string
	redisAddress     string
	redisPassword    string
	openAIAPIKey     string
	googleMapsAPIKey string
	enableOpenAI     bool
	enableGoogleAPI  bool
	securityConfig   *SecurityConfig
	proxyURL         string
	proxyType        string
	proxyUser        string
	proxyPass        string
	openaiProxyURL   string
	mapsProxyURL     string
}

type SecurityConfig struct {
	RateLimit struct {
		Enabled       bool
		MaxRequests   int
		WindowSeconds int
	}
	CORS struct {
		AllowedOrigins []string
		MaxAge         int
	}
	Session struct {
		Timeout int
		Secure  bool
	}
}

func (c *config) ServerAddress() string {
	return c.serverAddress
}

func (c *config) RedisAddress() string {
	return c.redisAddress
}

func (c *config) RedisPassword() string {
	return c.redisPassword
}

func (c *config) OpenAIAPIKey() string {
	return c.openAIAPIKey
}

func (c *config) GoogleMapsAPIKey() string {
	return c.googleMapsAPIKey
}

func (c *config) EnableOpenAI() bool {
	return c.enableOpenAI
}

func (c *config) EnableGoogleAPI() bool {
	return c.enableGoogleAPI
}

func (c *config) SecurityConfig() *SecurityConfig {
	return c.securityConfig
}

func (c *config) ProxyURL() string {
	return c.proxyURL
}

func (c *config) ProxyType() string {
	return c.proxyType
}

func (c *config) ProxyAuth() (string, string) {
	return c.proxyUser, c.proxyPass
}

func (c *config) OpenAIProxyURL() string {
	// 如果设置了OpenAI专用代理，则使用它，否则使用通用代理
	if c.openaiProxyURL != "" {
		return c.openaiProxyURL
	}
	return c.proxyURL
}

func (c *config) MapsProxyURL() string {
	// 如果设置了Maps专用代理，则使用它，否则使用通用代理
	if c.mapsProxyURL != "" {
		return c.mapsProxyURL
	}
	return c.proxyURL
}

func New() Config {
	// 加载 .env 文件
	if err := godotenv.Load(); err != nil {
		// 忽略错误，因为在生产环境中通常不使用 .env 文件
	}

	cfg := &config{
		serverAddress:    getEnvOrDefault("SERVER_ADDRESS", ":8080"),
		redisAddress:     getEnvOrDefault("REDIS_ADDRESS", "localhost:6379"),
		redisPassword:    os.Getenv("REDIS_PASSWORD"),
		openAIAPIKey:     os.Getenv("OPENAI_API_KEY"),
		googleMapsAPIKey: os.Getenv("GOOGLE_API_KEY"),
		enableOpenAI:     getEnvOrDefault("ENABLE_OPENAI", "true") == "true",
		enableGoogleAPI:  getEnvOrDefault("ENABLE_GOOGLE_API", "true") == "true",
		proxyURL:         os.Getenv("PROXY_URL"),
		proxyType:        getEnvOrDefault("PROXY_TYPE", "http"),
		proxyUser:        os.Getenv("PROXY_USER"),
		proxyPass:        os.Getenv("PROXY_PASS"),
		openaiProxyURL:   os.Getenv("OPENAI_PROXY_URL"),
		mapsProxyURL:     os.Getenv("MAPS_PROXY_URL"),
	}

	// 加载安全配置
	cfg.securityConfig = &SecurityConfig{
		RateLimit: struct {
			Enabled       bool
			MaxRequests   int
			WindowSeconds int
		}{
			Enabled:       getEnvOrDefault("RATE_LIMIT_ENABLED", "true") == "true",
			MaxRequests:   getEnvAsIntOrDefault("RATE_LIMIT_MAX_REQUESTS", 100),
			WindowSeconds: getEnvAsIntOrDefault("RATE_LIMIT_WINDOW_SECONDS", 60),
		},
		CORS: struct {
			AllowedOrigins []string
			MaxAge         int
		}{
			AllowedOrigins: strings.Split(getEnvOrDefault("CORS_ALLOWED_ORIGINS", "http://localhost:3000"), ","),
			MaxAge:         getEnvAsIntOrDefault("CORS_MAX_AGE", 86400),
		},
		Session: struct {
			Timeout int
			Secure  bool
		}{
			Timeout: getEnvAsIntOrDefault("SESSION_TIMEOUT", 3600),
			Secure:  getEnvOrDefault("SESSION_SECURE", "true") == "true",
		},
	}

	return cfg
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsIntOrDefault(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}
