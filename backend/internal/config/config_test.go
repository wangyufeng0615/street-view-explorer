package config

import (
	"os"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	// 清理环境变量
	os.Clearenv()

	t.Run("missing required vars", func(t *testing.T) {
		_, err := LoadConfig()
		if err == nil {
			t.Error("应该返回错误当必需的环境变量未设置")
		}
	})

	t.Run("with all required vars", func(t *testing.T) {
		os.Setenv("REDIS_ADDRESS", "localhost:6379")
		os.Setenv("OPENAI_API_KEY", "test-key")

		cfg, err := LoadConfig()
		if err != nil {
			t.Errorf("不应该返回错误: %v", err)
		}

		if cfg.RedisAddress() != "localhost:6379" {
			t.Errorf("RedisAddress 不正确")
		}
		if cfg.OpenAIAPIKey() != "test-key" {
			t.Errorf("OpenAIAPIKey 不正确")
		}
		if cfg.ServerAddress() != ":8080" {
			t.Errorf("ServerAddress 默认值不正确")
		}
	})
}
