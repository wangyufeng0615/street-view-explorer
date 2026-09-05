package api

import (
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
)

func TestTrustedProxyChainRejectsForgedClientPrefix(t *testing.T) {
	for _, tc := range []struct{ trusted, remote, forwarded, want string }{
		{"", "198.51.100.2:1", "203.0.113.3", "198.51.100.2"},
		{"172.18.0.0/16", "172.18.0.3:1", "203.0.113.3, 198.51.100.2, 172.18.0.1", "198.51.100.2"},
	} {
		r := gin.New()
		if err := ConfigureTrustedProxies(r, tc.trusted); err != nil {
			t.Fatal(err)
		}
		r.GET("/", func(c *gin.Context) { c.String(200, c.ClientIP()) })
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = tc.remote
		req.Header.Set("X-Forwarded-For", tc.forwarded)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Body.String() != tc.want {
			t.Fatalf("got %s want %s", w.Body.String(), tc.want)
		}
	}
	if ConfigureTrustedProxies(gin.New(), "not-a-cidr") == nil {
		t.Fatal("invalid CIDR accepted")
	}
}

func TestRealtimeConnectionSlotsReleasedAndBounded(t *testing.T) {
	h := NewRealtimeHandlers()
	a, ok := h.reserveRealtimeConnection("a")
	if !ok {
		t.Fatal("first rejected")
	}
	b, ok := h.reserveRealtimeConnection("a")
	if !ok {
		t.Fatal("second rejected")
	}
	if _, ok := h.reserveRealtimeConnection("a"); ok {
		t.Fatal("per-IP cap bypassed")
	}
	a()
	a()
	b()
	if h.activeConnections != 0 || len(h.connections) != 0 {
		t.Fatal("slots leaked")
	}
	var releases []func()
	for i := 0; i < realtimeMaxConnections; i++ {
		release, ok := h.reserveRealtimeConnection(string(rune('a' + i)))
		if !ok {
			t.Fatal("global slots unavailable")
		}
		releases = append(releases, release)
	}
	if _, ok := h.reserveRealtimeConnection("overflow"); ok {
		t.Fatal("global cap bypassed")
	}
	for _, release := range releases {
		release()
	}
}
