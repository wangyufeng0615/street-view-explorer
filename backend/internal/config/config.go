package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config interface {
	ServerAddress() string
	RedisAddress() string
	OpenAIAPIKey() string
	GoogleMapsAPIKey() string
	EnableOpenAI() bool
	EnableGoogleAPI() bool
}

type config struct {
	serverAddress    string
	redisAddress     string
	openAIAPIKey     string
	googleMapsAPIKey string
	enableOpenAI     bool
	enableGoogleAPI  bool
}

func (c *config) ServerAddress() string {
	return c.serverAddress
}

func (c *config) RedisAddress() string {
	return c.redisAddress
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

func New() Config {
	// 尝试加载 .env 文件
	if err := godotenv.Load(); err != nil {
		log.Printf("警告: 无法加载 .env 文件: %v", err)
	}

	cfg := &config{
		serverAddress:    getEnvOrDefault("SERVER_ADDRESS", ":8080"),
		redisAddress:     getEnvOrDefault("REDIS_ADDRESS", "localhost:6379"),
		openAIAPIKey:     getEnvOrDefault("OPENAI_API_KEY", ""),
		googleMapsAPIKey: getEnvOrDefault("GOOGLE_API_KEY", ""),
		enableOpenAI:     getEnvOrDefault("ENABLE_OPENAI", "true") == "true",
		enableGoogleAPI:  getEnvOrDefault("ENABLE_GOOGLE_API", "true") == "true",
	}

	log.Printf("加载配置:\n"+
		"Server Address: %s\n"+
		"Redis Address: %s\n"+
		"Enable OpenAI: %v\n"+
		"Enable Google API: %v",
		cfg.serverAddress,
		cfg.redisAddress,
		cfg.enableOpenAI,
		cfg.enableGoogleAPI)

	return cfg
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
