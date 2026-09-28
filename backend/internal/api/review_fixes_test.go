package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/services"
	"github.com/my-streetview-project/backend/internal/utils"
)

func TestSatelliteImageRejectsNaNCoordinates(t *testing.T) {
	handler := NewGeoHandlers(nil, "key", nil, nil)
	router := gin.New()
	router.GET("/satellite", handler.SatelliteImage)
	for _, query := range []string{"lat=NaN&lng=0&zoom=5", "lat=0&lng=NaN&zoom=5", "lat=Inf&lng=0&zoom=5"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/satellite?"+query, nil))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400", query, response.Code)
		}
	}
}

func TestSubmitOnlineGuessRejectsInvalidCoordinatesAsBadRequest(t *testing.T) {
	handler := NewGeoHandlers(nil, "", nil, nil)
	router := gin.New()
	router.POST("/rooms/:roomId/guess", handler.SubmitOnlineGuess)
	for _, body := range []string{`{"lat":999,"lng":0}`, `{"lat":10}`, `{}`} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/rooms/r1/guess", strings.NewReader(body)))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400", body, response.Code)
		}
	}
}

func TestDescriptionErrorStatusDetectsWrappedTimeouts(t *testing.T) {
	wrapped := utils.SafeError(utils.ErrorTypeExternal, "AI 描述生成失败", fmt.Errorf("stream: %w", context.DeadlineExceeded))
	if got := descriptionErrorStatus(wrapped); got != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, want 504 for wrapped deadline", got)
	}
	if got := descriptionErrorStatus(errors.New("AI 描述生成失败")); got != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", got)
	}
}

func TestSearchNotFoundClassification(t *testing.T) {
	if !isSearchNotFound(nil, errors.New("未找到地点: nowhere")) {
		t.Fatal("unknown place should be not found")
	}
	if !isSearchNotFound(&services.PlaceResolution{Name: "x"}, errors.New("找到了地点，但附近没有可用街景")) {
		t.Fatal("place without Street View should be not found")
	}
	if isSearchNotFound(nil, errors.New("保存位置记录失败: database is locked")) {
		t.Fatal("database failure must not be reported as not found")
	}
}

func TestCreateJourneyRequiresMinimumTokenLength(t *testing.T) {
	_, router := setupTestAgentHandlers(t)
	response := doJSON(router, http.MethodPost, "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 1, "start_lng": 2, "total_stops": 3, "token": "abc123",
	})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("short token status = %d, want 400", response.Code)
	}
	response = doJSON(router, http.MethodPost, "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 1, "start_lng": 2, "total_stops": 3, "token": "a3f8c1d",
	})
	if response.Code != http.StatusOK {
		t.Fatalf("documented 7-char traveler ID status = %d, want 200", response.Code)
	}
}

func TestVisitHistoryRejectsDeepOffset(t *testing.T) {
	handlers := NewHandlers(nil, nil)
	router := gin.New()
	router.GET("/visits", handlers.GetVisitHistory)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/visits?offset=%d", maxVisitHistoryOffset+1), nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
}
