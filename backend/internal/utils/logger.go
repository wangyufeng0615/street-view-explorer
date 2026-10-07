package utils

import (
	"errors"
	"log"
	"time"

	mysentry "github.com/my-streetview-project/backend/internal/sentry"
)

type LogLevel string

const (
	INFO  LogLevel = "INFO"
	ERROR LogLevel = "ERROR"
)

type LogEntry struct {
	Timestamp string                 `json:"timestamp"`
	Level     LogLevel               `json:"level"`
	Service   string                 `json:"service,omitempty"`
	Action    string                 `json:"action,omitempty"`
	Message   string                 `json:"message,omitempty"`
	Duration  *string                `json:"duration,omitempty"`
	Fields    map[string]interface{} `json:"fields,omitempty"`
	Error     string                 `json:"error,omitempty"`
}

type Logger struct {
	service string
}

func NewLogger(service string) *Logger {
	return &Logger{service: service}
}

func (l *Logger) log(level LogLevel, action, message string, fields map[string]interface{}, err error) {
	entry := LogEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     level,
		Service:   l.service,
		Action:    action,
		Message:   message,
		Fields:    fields,
	}

	if err != nil {
		entry.Error = mysentry.RedactSensitiveString(errorDetail(err))
		log.Printf("[%s] %s:%s %s %v error=%q", level, l.service, action, message, fields, entry.Error)
		return
	}

	// Always use readable format for development
	log.Printf("[%s] %s:%s %s %v", level, l.service, action, message, fields)
}

// errorDetail returns the underlying cause for logs. AppError.Error() only
// carries the user-facing message, which hides why an upstream call failed.
func errorDetail(err error) string {
	var appErr *AppError
	if errors.As(err, &appErr) && appErr.InternalMsg != "" {
		return appErr.InternalMsg
	}
	return err.Error()
}

func (l *Logger) Info(action, message string, fields ...map[string]interface{}) {
	var f map[string]interface{}
	if len(fields) > 0 {
		f = fields[0]
	}
	l.log(INFO, action, message, f, nil)
}

func (l *Logger) Error(action, message string, err error, fields ...map[string]interface{}) {
	var f map[string]interface{}
	if len(fields) > 0 {
		f = fields[0]
	}
	l.log(ERROR, action, message, f, err)
}

// Global logger instances
var (
	apiLogger      = NewLogger("api")
	locationLogger = NewLogger("location")
	aiLogger       = NewLogger("ai")
	mapsLogger     = NewLogger("maps")
	systemLogger   = NewLogger("system")
)

func APILogger() *Logger      { return apiLogger }
func LocationLogger() *Logger { return locationLogger }
func AILogger() *Logger       { return aiLogger }
func MapsLogger() *Logger     { return mapsLogger }
func SystemLogger() *Logger   { return systemLogger }
