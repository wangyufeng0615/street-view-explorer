package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func TestRealtimeOversizedFrameNeverReachesUpstream(t *testing.T) {
	upstreamDone := make(chan int, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		total := 0
		for {
			_, body, err := conn.ReadMessage()
			if err != nil {
				break
			}
			total += len(body)
		}
		upstreamDone <- total
	}))
	defer upstream.Close()
	t.Setenv("OPENAI_API_KEY", "test-key")
	t.Setenv("AI_PROXY_URL", "")
	t.Setenv("PROXY_URL", "")
	t.Setenv("OPENAI_REALTIME_WS_URL", "ws"+strings.TrimPrefix(upstream.URL, "http"))
	h := NewRealtimeHandlers()
	router := gin.New()
	router.GET("/ws", h.ConnectWebSocket)
	server := httptest.NewServer(router)
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_ = conn.WriteMessage(websocket.TextMessage, []byte(strings.Repeat("x", realtimeMaxMessageBytes+1)))
	select {
	case total := <-upstreamDone:
		if total != 0 {
			t.Fatalf("upstream received %d oversized bytes", total)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("oversized connection was not closed")
	}
}
