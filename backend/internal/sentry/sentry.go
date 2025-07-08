package sentry

import (
	"fmt"
	"log"
	"os"

	"github.com/getsentry/sentry-go"
)

// Config holds Sentry configuration
type Config struct {
	DSN              string
	Environment      string
	Release          string
	TracesSampleRate float64
	Enabled          bool
}

// NewConfig creates Sentry configuration from environment variables
func NewConfig() *Config {
	enabled := os.Getenv("SENTRY_ENABLED") != "false" // Default to enabled
	sampleRate := 1.0
	if rate := os.Getenv("SENTRY_SAMPLE_RATE"); rate != "" {
		var err error
		sampleRate, err = parseFloat(rate)
		if err != nil {
			sampleRate = 1.0
		}
	}

	return &Config{
		DSN:              os.Getenv("SENTRY_DSN"),
		Environment:      getEnvOrDefault("GO_ENV", "development"), // 使用GO_ENV替代SENTRY_ENVIRONMENT
		Release:          getEnvOrDefault("SENTRY_RELEASE", "unknown"),
		TracesSampleRate: sampleRate,
		Enabled:          enabled,
	}
}

// Init initializes Sentry SDK
func Init(cfg *Config) error {
	if !cfg.Enabled {
		log.Printf("Sentry is disabled")
		return nil
	}

	if cfg.DSN == "" {
		log.Printf("Sentry DSN not provided, Sentry will not be initialized")
		return nil
	}

	err := sentry.Init(sentry.ClientOptions{
		Dsn:              cfg.DSN,
		Environment:      cfg.Environment,
		Release:          cfg.Release,
		TracesSampleRate: cfg.TracesSampleRate,
		AttachStacktrace: true,
		SendDefaultPII:   true,

		// BeforeSend hook to add custom data or filter events
		BeforeSend: func(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
			// Add server metadata
			if event.Contexts == nil {
				event.Contexts = make(map[string]sentry.Context)
			}
			event.Contexts["app"] = sentry.Context{
				"name":    "streetview-backend",
				"version": cfg.Release,
				"type":    "go-gin-api",
			}

			return event
		},
	})

	if err != nil {
		return err
	}

	log.Printf("Sentry initialized: environment=%s, release=%s", cfg.Environment, cfg.Release)
	return nil
}

// CaptureError captures an error with additional context
func CaptureError(err error, contexts map[string]interface{}) {
	if err == nil {
		return
	}

	sentry.WithScope(func(scope *sentry.Scope) {
		// Add custom context
		for key, value := range contexts {
			scope.SetContext(key, sentry.Context{
				"data": value,
			})
		}

		sentry.CaptureException(err)
	})
}

// CaptureMessage captures a message event
func CaptureMessage(message string, level sentry.Level, contexts map[string]interface{}) {
	sentry.WithScope(func(scope *sentry.Scope) {
		// Set level
		scope.SetLevel(level)

		// Add custom context
		for key, value := range contexts {
			scope.SetContext(key, sentry.Context{
				"data": value,
			})
		}

		sentry.CaptureMessage(message)
	})
}

// Helper functions
func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func parseFloat(s string) (float64, error) {
	if s == "" {
		return 0, nil
	}
	var f float64
	_, err := fmt.Sscanf(s, "%f", &f)
	return f, err
}
