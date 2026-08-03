package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type stubRateLimiter struct {
	allowed     bool
	err         error
	maxRequests int
	key         string
}

func (s *stubRateLimiter) CheckAndIncrement(key string, maxRequests int, _ time.Duration) (bool, int, error) {
	s.key = key
	s.maxRequests = maxRequests
	return s.allowed, 0, s.err
}

func (s *stubRateLimiter) GetCount(string) (int64, error) {
	return 0, s.err
}

func TestPaidDescriptionRateLimitFailsClosed(t *testing.T) {
	limiter := &stubRateLimiter{allowed: true, err: errors.New("database unavailable")}
	router := gin.New()
	router.Use(RateLimitMiddleware(limiter))
	called := false
	router.GET("/api/v1/locations/:panoId/description", func(c *gin.Context) {
		called = true
		c.Status(http.StatusOK)
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/locations/pano/description", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	if called {
		t.Fatal("paid handler ran after its rate limiter failed")
	}
}

func TestDescriptionEndpointsUseDedicatedLimits(t *testing.T) {
	tests := []struct {
		path      string
		route     string
		wantLimit int
	}{
		{path: "/api/v1/locations/pano/description", route: "/api/v1/locations/:panoId/description", wantLimit: 12},
		{path: "/api/v1/locations/pano/detailed-description", route: "/api/v1/locations/:panoId/detailed-description", wantLimit: 6},
	}

	for _, test := range tests {
		t.Run(test.route, func(t *testing.T) {
			limiter := &stubRateLimiter{allowed: true}
			router := gin.New()
			router.Use(RateLimitMiddleware(limiter))
			router.GET(test.route, func(c *gin.Context) { c.Status(http.StatusOK) })
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", response.Code)
			}
			if limiter.maxRequests != test.wantLimit {
				t.Fatalf("maxRequests = %d, want %d", limiter.maxRequests, test.wantLimit)
			}
		})
	}
}

func TestGlobalDescriptionBudgetFailsClosed(t *testing.T) {
	limiter := &stubRateLimiter{allowed: true, err: errors.New("database unavailable")}
	handlers := NewHandlers(nil, nil, limiter)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)

	if handlers.reserveDescriptionBudget(context, false) {
		t.Fatal("reserveDescriptionBudget returned true after limiter error")
	}
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.Code)
	}
}
