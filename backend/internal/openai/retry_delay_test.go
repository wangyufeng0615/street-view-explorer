package openai

import (
	"testing"
	"time"
)

func TestRetryDelayCapsUpstreamRetryAfter(t *testing.T) {
	if got := retryDelay(1, 30*time.Second); got != maxRetryAfter {
		t.Fatalf("retryDelay(30s hint) = %v, want %v", got, maxRetryAfter)
	}
	if got := retryDelay(1, 500*time.Millisecond); got != 500*time.Millisecond {
		t.Fatalf("retryDelay(500ms hint) = %v, want 500ms", got)
	}
}
