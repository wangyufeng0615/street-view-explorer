package utils

import "log"

// Simple wrapper around log, could integrate with Datadog logs or other logging frameworks
func Info(msg string) {
	log.Println("[INFO]", msg)
}

func Error(msg string) {
	log.Println("[ERROR]", msg)
}
