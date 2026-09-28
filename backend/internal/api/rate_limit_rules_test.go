package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// countingRateLimiter is an in-memory limiter that also supports refunds.
type countingRateLimiter struct {
	mu     sync.Mutex
	counts map[string]int
}

func newCountingRateLimiter() *countingRateLimiter {
	return &countingRateLimiter{counts: make(map[string]int)}
}

func (l *countingRateLimiter) CheckAndIncrement(key string, maxRequests int, _ time.Duration) (bool, int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.counts[key]++
	return l.counts[key] <= maxRequests, maxRequests - l.counts[key], nil
}

func (l *countingRateLimiter) GetCount(key string) (int64, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return int64(l.counts[key]), nil
}

func (l *countingRateLimiter) RefundContext(_ context.Context, key string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.counts[key] > 0 {
		l.counts[key]--
	}
	return nil
}

func (l *countingRateLimiter) count(key string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.counts[key]
}

func TestRateLimitRulesForCostlyEndpoints(t *testing.T) {
	tests := []struct {
		method    string
		route     string
		wantScope string
		wantMax   int
	}{
		{http.MethodPost, "/api/v1/geo/online/rooms", "/api/v1/geo/online/rooms", 20},
		{http.MethodPost, "/api/v1/geo/online/rooms/join", "/api/v1/geo/online/rooms/join", 20},
		{http.MethodPost, "/api/v1/geo/online/rooms/:roomId/ready", "/api/v1/geo/online/rooms/:roomId/ready", 20},
		{http.MethodPost, "/api/v1/geo/online/matchmaking", "POST /api/v1/geo/online/matchmaking", 20},
		// Matchmaking status is polled every few seconds and must not share the join limit.
		{http.MethodGet, "/api/v1/geo/online/matchmaking", "/api/v1/geo/online/matchmaking", 200},
		{http.MethodGet, "/api/v1/geo/online/rooms/:roomId", "/api/v1/geo/online/rooms/:roomId", 200},
		{http.MethodGet, "/api/v1/locations/search", "/api/v1/locations/search", 45},
		{http.MethodGet, "/api/v1/realtime/ws", "/api/v1/realtime/ws", 20},
		{http.MethodGet, "/api/v1/locations/:panoId/description", "/api/v1/locations/:panoId/description", 12},
	}
	for _, test := range tests {
		rule := rateLimitRuleFor(test.method, test.route)
		if rule.scope != test.wantScope || rule.maxRequests != test.wantMax || rule.window != time.Minute {
			t.Fatalf("%s %s: rule = %+v, want scope %q max %d per minute", test.method, test.route, rule, test.wantScope, test.wantMax)
		}
	}
	if !isCostSensitiveEndpoint("/api/v1/geo/online/rooms/join") {
		t.Fatal("room join should fail closed when the limiter is unavailable")
	}
}

func TestOnlineRoomCreateIsLimitedPerIP(t *testing.T) {
	limiter := newCountingRateLimiter()
	router := gin.New()
	router.Use(RateLimitMiddleware(limiter))
	router.POST("/api/v1/geo/online/rooms", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.GET("/api/v1/geo/online/matchmaking", func(c *gin.Context) { c.Status(http.StatusOK) })

	var last int
	for range 21 {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/geo/online/rooms", nil))
		last = response.Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("21st room create status = %d, want 429", last)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/geo/online/matchmaking", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("matchmaking polling status = %d, want 200", response.Code)
	}
}

func TestDescriptionBudgetPerIPShareProtectsGlobalBudget(t *testing.T) {
	limiter := newCountingRateLimiter()
	handlers := NewHandlers(nil, nil, limiter)

	reserve := func() (int, *descriptionBudgetReservation, bool) {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
		c.Request.RemoteAddr = "203.0.113.7:1234"
		reservation, ok := handlers.reserveDescriptionBudget(c, false)
		return response.Code, reservation, ok
	}

	for range descriptionIPBudgetStandard {
		if code, _, ok := reserve(); !ok {
			t.Fatalf("request within IP share rejected with %d", code)
		}
	}
	code, _, ok := reserve()
	if ok || code != http.StatusTooManyRequests {
		t.Fatalf("over IP share: ok=%v status=%d, want 429", ok, code)
	}
	if got := limiter.count("global_ratelimit:description:standard"); got != descriptionIPBudgetStandard {
		t.Fatalf("global count = %d, want %d; rejected IP requests must not spend global budget", got, descriptionIPBudgetStandard)
	}
}

func TestDescriptionBudgetRefundsUpstreamFailuresOnly(t *testing.T) {
	limiter := newCountingRateLimiter()
	handlers := NewHandlers(nil, nil, limiter)
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	reservation, ok := handlers.reserveDescriptionBudget(c, true)
	if !ok {
		t.Fatal("reservation failed")
	}
	reservation.refundOnUpstreamFailure(c, context.Canceled)
	if got := limiter.count("global_ratelimit:description:detailed"); got != 1 {
		t.Fatalf("cancelled request refunded budget: count=%d", got)
	}
	reservation.refundOnUpstreamFailure(c, context.DeadlineExceeded)
	if got := limiter.count("global_ratelimit:description:detailed"); got != 0 {
		t.Fatalf("upstream failure not refunded: count=%d", got)
	}
}

func TestPreferenceUserLimitDoesNotSpendGlobalBudget(t *testing.T) {
	limiter := newCountingRateLimiter()
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("sessionID", "session-a"); c.Next() })
	router.Use(UserRateLimitMiddleware(limiter))
	router.POST("/api/v1/preferences/exploration", func(c *gin.Context) { c.Status(http.StatusOK) })

	for range 70 {
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/v1/preferences/exploration", nil))
	}
	if got := limiter.count("global_ratelimit:preference"); got != 60 {
		t.Fatalf("global preference count = %d, want 60", got)
	}
}
