package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func doubaoTestRouter(t *testing.T, upstream http.HandlerFunc) *gin.Engine {
	t.Helper()
	server := httptest.NewServer(upstream)
	t.Cleanup(server.Close)
	t.Setenv("DOUBAO_TTS_ENDPOINT", server.URL)
	t.Setenv("DOUBAO_TTS_API_KEY", "test-doubao-key")
	t.Setenv("DOUBAO_TTS_PROXY_URL", "")
	t.Setenv("AI_PROXY_URL", "")
	t.Setenv("PROXY_URL", "")
	router := gin.New()
	router.POST("/tts", NewRealtimeHandlers().SynthesizeDoubaoTTS)
	return router
}

func TestDoubaoTTSStreamOutlivesPerChunkIdleTimeout(t *testing.T) {
	previous := doubaoTTSIdleTimeout
	doubaoTTSIdleTimeout = 150 * time.Millisecond
	t.Cleanup(func() { doubaoTTSIdleTimeout = previous })

	// The whole stream takes longer than the idle timeout, but chunks keep
	// arriving, so it must complete.
	router := doubaoTestRouter(t, func(w http.ResponseWriter, r *http.Request) {
		for range 6 {
			fmt.Fprintln(w, `{"code":0,"data":"AAAA"}`)
			w.(http.Flusher).Flush()
			time.Sleep(60 * time.Millisecond)
		}
		fmt.Fprintln(w, `{"code":20000000,"message":"ok"}`)
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/tts", strings.NewReader(`{"text":"hello"}`)))
	body := response.Body.String()
	if strings.Count(body, "audio_delta") != 6 || !strings.Contains(body, `"type":"done"`) {
		t.Fatalf("stream truncated: %s", body)
	}
}

func TestDoubaoTTSStreamStopsWhenUpstreamStalls(t *testing.T) {
	previous := doubaoTTSIdleTimeout
	doubaoTTSIdleTimeout = 100 * time.Millisecond
	t.Cleanup(func() { doubaoTTSIdleTimeout = previous })

	router := doubaoTestRouter(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, `{"code":0,"data":"AAAA"}`)
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	})
	startedAt := time.Now()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/tts", strings.NewReader(`{"text":"hello"}`)))
	if elapsed := time.Since(startedAt); elapsed > 2*time.Second {
		t.Fatalf("stalled stream held the request for %s", elapsed)
	}
	if body := response.Body.String(); !strings.Contains(body, "stalled") {
		t.Fatalf("missing stall error line: %s", body)
	}
}
