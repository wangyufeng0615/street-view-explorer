package sentry

import (
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	"github.com/getsentry/sentry-go"
)

const ErrorReportedKey = "sentry_error_reported"

var sensitiveParamRE = regexp.MustCompile(`(?i)(\b(?:key|api[_-]?key|apikey|token|access[_-]?token|secret|client[_-]?secret|password|dsn|authorization|app[_-]?id|appid|access[_-]?key)=)([^&\s"'<>]+)`)
var sensitiveAuthorizationRE = regexp.MustCompile(`(?i)(authorization[:=]\s*(?:bearer\s+)?)([^&\s"'<>]+)`)

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
	environment := getEnvOrDefault("GO_ENV", "development")
	sampleRate := defaultTracesSampleRate(environment)
	if rate := os.Getenv("SENTRY_SAMPLE_RATE"); rate != "" {
		var err error
		sampleRate, err = parseFloat(rate)
		if err != nil {
			sampleRate = defaultTracesSampleRate(environment)
		}
	}

	return &Config{
		DSN:              os.Getenv("SENTRY_DSN"),
		Environment:      environment, // 使用GO_ENV替代SENTRY_ENVIRONMENT
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
		SendDefaultPII:   false,

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

			RedactEvent(event)
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
				"data": RedactSensitiveValue(value),
			})
		}

		sentry.CaptureException(fmt.Errorf("%s", RedactSensitiveString(err.Error())))
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
				"data": RedactSensitiveValue(value),
			})
		}

		sentry.CaptureMessage(RedactSensitiveString(message))
	})
}

func RedactEvent(event *sentry.Event) {
	if event == nil {
		return
	}

	event.Message = RedactSensitiveString(event.Message)
	event.Transaction = RedactSensitiveString(event.Transaction)
	event.ServerName = ""
	event.User.Email = ""
	event.User.Username = ""
	event.User.IPAddress = ""

	if event.Request != nil {
		event.Request.URL = RedactSensitiveString(event.Request.URL)
		event.Request.Data = RedactSensitiveString(event.Request.Data)
		event.Request.QueryString = RedactSensitiveString(event.Request.QueryString)
		event.Request.Cookies = ""
		event.Request.Headers = redactStringMap(event.Request.Headers)
		event.Request.Env = redactStringMap(event.Request.Env)
	}

	for i := range event.Exception {
		event.Exception[i].Value = RedactSensitiveString(event.Exception[i].Value)
	}

	for key, value := range event.Contexts {
		event.Contexts[key] = RedactContext(value)
	}
	for key, value := range event.Extra {
		event.Extra[key] = RedactSensitiveValue(value)
	}
	for _, breadcrumb := range event.Breadcrumbs {
		if breadcrumb == nil {
			continue
		}
		breadcrumb.Message = RedactSensitiveString(breadcrumb.Message)
		for key, value := range breadcrumb.Data {
			breadcrumb.Data[key] = RedactSensitiveValue(value)
		}
	}
}

func RedactContext(context sentry.Context) sentry.Context {
	redacted := make(sentry.Context, len(context))
	for key, value := range context {
		if isSensitiveKey(key) {
			redacted[key] = "[redacted]"
			continue
		}
		redacted[key] = RedactSensitiveValue(value)
	}
	return redacted
}

func RedactSensitiveValue(value interface{}) interface{} {
	switch v := value.(type) {
	case string:
		return RedactSensitiveString(v)
	case fmt.Stringer:
		return RedactSensitiveString(v.String())
	case []string:
		redacted := make([]string, len(v))
		for i, item := range v {
			redacted[i] = RedactSensitiveString(item)
		}
		return redacted
	case []interface{}:
		redacted := make([]interface{}, len(v))
		for i, item := range v {
			redacted[i] = RedactSensitiveValue(item)
		}
		return redacted
	case map[string]string:
		return redactStringMap(v)
	case map[string][]string:
		redacted := make(map[string][]string, len(v))
		for key, items := range v {
			if isSensitiveKey(key) {
				redacted[key] = []string{"[redacted]"}
				continue
			}
			copied := make([]string, len(items))
			for i, item := range items {
				copied[i] = RedactSensitiveString(item)
			}
			redacted[key] = copied
		}
		return redacted
	case map[string]interface{}:
		redacted := make(map[string]interface{}, len(v))
		for key, item := range v {
			if isSensitiveKey(key) {
				redacted[key] = "[redacted]"
				continue
			}
			redacted[key] = RedactSensitiveValue(item)
		}
		return redacted
	default:
		return value
	}
}

func RedactSensitiveString(value string) string {
	if value == "" {
		return value
	}

	redacted := sensitiveAuthorizationRE.ReplaceAllString(value, "${1}[redacted]")
	redacted = sensitiveParamRE.ReplaceAllString(redacted, "${1}[redacted]")
	for _, envKey := range sensitiveEnvKeys() {
		secret := os.Getenv(envKey)
		if len(secret) < 6 {
			continue
		}
		redacted = strings.ReplaceAll(redacted, secret, "[redacted]")
	}
	return redacted
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

func defaultTracesSampleRate(environment string) float64 {
	if strings.EqualFold(environment, "production") {
		return 0.1
	}
	return 1.0
}

func redactStringMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}

	redacted := make(map[string]string, len(values))
	for key, value := range values {
		if isSensitiveKey(key) {
			redacted[key] = "[redacted]"
			continue
		}
		redacted[key] = RedactSensitiveString(value)
	}
	return redacted
}

func isSensitiveKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "-", "_"), " ", "_"))
	sensitiveParts := []string{
		"authorization",
		"cookie",
		"key",
		"password",
		"secret",
		"session",
		"token",
		"dsn",
	}
	for _, part := range sensitiveParts {
		if strings.Contains(normalized, part) {
			return true
		}
	}
	return false
}

func sensitiveEnvKeys() []string {
	return []string{
		"AI_API_KEY",
		"GOOGLE_API_KEY",
		"OPENAI_API_KEY",
		"REALTIME_API_KEY",
		"DOUBAO_TTS_API_KEY",
		"DOUBAO_TTS_TOKEN",
		"DOUBAO_TTS_ACCESS_KEY",
		"SENTRY_DSN",
	}
}
