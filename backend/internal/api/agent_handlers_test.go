package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/repositories"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func setupTestAgentHandlers(t *testing.T) (*AgentHandlers, *gin.Engine) {
	t.Helper()
	repo, err := repositories.NewSQLiteRepository(testSQLiteConfig{
		path: filepath.Join(t.TempDir(), "agent-test.db"),
	})
	if err != nil {
		t.Fatalf("NewSQLiteRepository() error = %v", err)
	}
	t.Cleanup(func() { repo.Close() })

	ah := NewAgentHandlers(repo, repo, nil, "")

	r := gin.New()
	agent := r.Group("/api/v1/agent")
	{
		agent.POST("/journeys", ah.CreateJourney)
		agent.GET("/journeys", ah.ListJourneys)
		agent.GET("/journeys/:id", ah.GetJourney)
		agent.PUT("/journeys/:id/status", ah.UpdateJourneyStatus)
		agent.POST("/journeys/:id/stops", ah.SaveJourneyStop)
		agent.GET("/journeys/:id/stops", ah.GetJourneyStops)
		agent.POST("/journeys/:id/letter", ah.SaveJourneyLetter)
	}

	return ah, r
}

type testSQLiteConfig struct {
	path string
}

func (c testSQLiteConfig) SQLitePath() string {
	return c.path
}

func doJSON(r *gin.Engine, method, path string, body interface{}, headers ...string) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func parseResp(t *testing.T, w *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse response: %v\nBody: %s", err, w.Body.String())
	}
	return resp
}

// ==================== Tests ====================

func TestCreateJourney(t *testing.T) {
	_, r := setupTestAgentHandlers(t)

	w := doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat":   48.8566,
		"start_lng":   2.3522,
		"total_stops": 5,
		"token":       "test-token-123",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}

	resp := parseResp(t, w)
	if resp["success"] != true {
		t.Fatalf("success = %v, want true", resp["success"])
	}

	data := resp["data"].(map[string]interface{})
	if data["journey_id"] == "" {
		t.Fatal("journey_id should not be empty")
	}
	if data["token"] != "test-token-123" {
		t.Fatalf("token = %v, want test-token-123", data["token"])
	}
}

func TestCreateJourneyValidation(t *testing.T) {
	_, r := setupTestAgentHandlers(t)

	// Missing token
	w := doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 48.8566, "start_lng": 2.3522, "total_stops": 5,
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing token: status = %d, want 400", w.Code)
	}

	// Invalid coordinates
	w = doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 999, "start_lng": 2.3522, "total_stops": 5, "token": "t",
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid coords: status = %d, want 400", w.Code)
	}

	// stops out of range
	w = doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 48.0, "start_lng": 2.0, "total_stops": 100, "token": "t",
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("stops>20: status = %d, want 400", w.Code)
	}

	// Invalid token characters
	w = doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 48.0, "start_lng": 2.0, "total_stops": 5, "token": "bad token!",
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid token chars: status = %d, want 400", w.Code)
	}

	// Token too long
	w = doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 48.0, "start_lng": 2.0, "total_stops": 5, "token": strings.Repeat("a", maxAgentTokenLength+1),
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("token too long: status = %d, want 400", w.Code)
	}
}

func TestFullJourneyLifecycle(t *testing.T) {
	_, r := setupTestAgentHandlers(t)
	token := "lifecycle-token"

	// 1. Create journey
	w := doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 35.6762, "start_lng": 139.6503, "total_stops": 3, "token": token,
	})
	resp := parseResp(t, w)
	journeyID := resp["data"].(map[string]interface{})["journey_id"].(string)

	// 2. Update status to in_progress
	w = doJSON(r, "PUT", "/api/v1/agent/journeys/"+journeyID+"/status",
		map[string]interface{}{"status": "in_progress"},
		"Authorization", "Bearer "+token,
	)
	if w.Code != http.StatusOK {
		t.Fatalf("update status: %d; body: %s", w.Code, w.Body.String())
	}

	// 3. Save two stops
	for i := 1; i <= 2; i++ {
		w = doJSON(r, "POST", "/api/v1/agent/journeys/"+journeyID+"/stops",
			map[string]interface{}{
				"stop_number":    i,
				"lat":            35.6762 + float64(i),
				"lng":            139.6503,
				"pano_id":        "pano-test",
				"journal_entry":  "Entry for stop " + string(rune('0'+i)),
				"ai_description": "Atlas saw something beautiful",
				"next_reasoning": "I want to go north",
			},
			"Authorization", "Bearer "+token,
		)
		if w.Code != http.StatusOK {
			t.Fatalf("save stop %d: %d; body: %s", i, w.Code, w.Body.String())
		}
	}

	// 4. Get stops
	w = doJSON(r, "GET", "/api/v1/agent/journeys/"+journeyID+"/stops?token="+token, nil)
	resp = parseResp(t, w)
	stops := resp["data"].(map[string]interface{})["stops"].([]interface{})
	if len(stops) != 2 {
		t.Fatalf("stops count = %d, want 2", len(stops))
	}

	// 5. Save letter
	w = doJSON(r, "POST", "/api/v1/agent/journeys/"+journeyID+"/letter",
		map[string]interface{}{"letter": "Dear human, it was a wonderful journey..."},
		"Authorization", "Bearer "+token,
	)
	if w.Code != http.StatusOK {
		t.Fatalf("save letter: %d; body: %s", w.Code, w.Body.String())
	}

	// 6. Get journey — should be completed with letter
	w = doJSON(r, "GET", "/api/v1/agent/journeys/"+journeyID+"?token="+token, nil)
	resp = parseResp(t, w)
	journey := resp["data"].(map[string]interface{})["journey"].(map[string]interface{})
	if journey["status"] != models.JourneyStatusCompleted {
		t.Fatalf("status = %v, want completed", journey["status"])
	}
	if journey["letter"] != "Dear human, it was a wonderful journey..." {
		t.Fatalf("letter mismatch")
	}

	// 7. List journeys by token
	w = doJSON(r, "GET", "/api/v1/agent/journeys?token="+token, nil)
	resp = parseResp(t, w)
	journeys := resp["data"].(map[string]interface{})["journeys"].([]interface{})
	if len(journeys) != 1 {
		t.Fatalf("journeys count = %d, want 1", len(journeys))
	}
}

func TestTokenMismatchForbidden(t *testing.T) {
	_, r := setupTestAgentHandlers(t)

	// Create with one token
	w := doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 10, "start_lng": 20, "total_stops": 3, "token": "owner-token",
	})
	resp := parseResp(t, w)
	journeyID := resp["data"].(map[string]interface{})["journey_id"].(string)

	// Try to update with wrong token
	w = doJSON(r, "PUT", "/api/v1/agent/journeys/"+journeyID+"/status",
		map[string]interface{}{"status": "in_progress"},
		"Authorization", "Bearer wrong-token",
	)
	if w.Code != http.StatusForbidden {
		t.Fatalf("wrong token update: status = %d, want 403", w.Code)
	}

	// Try to save stop with wrong token
	w = doJSON(r, "POST", "/api/v1/agent/journeys/"+journeyID+"/stops",
		map[string]interface{}{"stop_number": 1, "lat": 10, "lng": 20, "journal_entry": "hi"},
		"Authorization", "Bearer wrong-token",
	)
	if w.Code != http.StatusForbidden {
		t.Fatalf("wrong token stop: status = %d, want 403", w.Code)
	}

	// Try to save letter with wrong token
	w = doJSON(r, "POST", "/api/v1/agent/journeys/"+journeyID+"/letter",
		map[string]interface{}{"letter": "stolen letter"},
		"Authorization", "Bearer wrong-token",
	)
	if w.Code != http.StatusForbidden {
		t.Fatalf("wrong token letter: status = %d, want 403", w.Code)
	}
}

func TestGetNonexistentJourney(t *testing.T) {
	_, r := setupTestAgentHandlers(t)

	w := doJSON(r, "GET", "/api/v1/agent/journeys/nonexistent?token=sometoken", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}

func TestGetJourneyRequiresToken(t *testing.T) {
	_, r := setupTestAgentHandlers(t)

	// Create a journey
	w := doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 10, "start_lng": 20, "total_stops": 3, "token": "secret-tok",
	})
	resp := parseResp(t, w)
	journeyID := resp["data"].(map[string]interface{})["journey_id"].(string)

	// GET without token should fail
	w = doJSON(r, "GET", "/api/v1/agent/journeys/"+journeyID, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no token: status = %d, want 401", w.Code)
	}

	// GET /stops without token should fail
	w = doJSON(r, "GET", "/api/v1/agent/journeys/"+journeyID+"/stops", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("stops no token: status = %d, want 401", w.Code)
	}

	// GET /stops with wrong token should fail
	w = doJSON(r, "GET", "/api/v1/agent/journeys/"+journeyID+"/stops?token=wrong", nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("stops wrong token: status = %d, want 403", w.Code)
	}
}

func TestAgentEndpointsRejectMalformedToken(t *testing.T) {
	_, r := setupTestAgentHandlers(t)

	w := doJSON(r, "GET", "/api/v1/agent/journeys", nil, "Authorization", "Bearer bad token!")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("list malformed token: status = %d, want 400", w.Code)
	}

	w = doJSON(r, "GET", "/api/v1/agent/journeys?token="+strings.Repeat("a", maxAgentTokenLength+1), nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("list oversized token: status = %d, want 400", w.Code)
	}
}

func TestStopCoordinateValidation(t *testing.T) {
	_, r := setupTestAgentHandlers(t)
	token := "coord-val-token"

	w := doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 10, "start_lng": 20, "total_stops": 3, "token": token,
	})
	resp := parseResp(t, w)
	journeyID := resp["data"].(map[string]interface{})["journey_id"].(string)

	// Invalid lat
	w = doJSON(r, "POST", "/api/v1/agent/journeys/"+journeyID+"/stops",
		map[string]interface{}{"stop_number": 1, "lat": 999, "lng": 20},
		"Authorization", "Bearer "+token,
	)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid lat: status = %d, want 400", w.Code)
	}

	// Invalid lng
	w = doJSON(r, "POST", "/api/v1/agent/journeys/"+journeyID+"/stops",
		map[string]interface{}{"stop_number": 1, "lat": 10, "lng": -999},
		"Authorization", "Bearer "+token,
	)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid lng: status = %d, want 400", w.Code)
	}
}

func TestStopValidation(t *testing.T) {
	_, r := setupTestAgentHandlers(t)
	token := "val-token"

	// Create journey with 3 stops
	w := doJSON(r, "POST", "/api/v1/agent/journeys", map[string]interface{}{
		"start_lat": 10, "start_lng": 20, "total_stops": 3, "token": token,
	})
	resp := parseResp(t, w)
	journeyID := resp["data"].(map[string]interface{})["journey_id"].(string)

	// Invalid stop_number (0)
	w = doJSON(r, "POST", "/api/v1/agent/journeys/"+journeyID+"/stops",
		map[string]interface{}{"stop_number": 0, "lat": 10, "lng": 20},
		"Authorization", "Bearer "+token,
	)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("stop 0: status = %d, want 400", w.Code)
	}

	// Invalid stop_number (>total_stops)
	w = doJSON(r, "POST", "/api/v1/agent/journeys/"+journeyID+"/stops",
		map[string]interface{}{"stop_number": 4, "lat": 10, "lng": 20},
		"Authorization", "Bearer "+token,
	)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("stop 4: status = %d, want 400", w.Code)
	}
}

func TestLetterValidation(t *testing.T) {
	_, r := setupTestAgentHandlers(t)

	// Empty letter
	w := doJSON(r, "POST", "/api/v1/agent/journeys/someid/letter",
		map[string]interface{}{"letter": ""},
		"Authorization", "Bearer sometoken",
	)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty letter: status = %d, want 400", w.Code)
	}
}

func TestListJourneysEmpty(t *testing.T) {
	_, r := setupTestAgentHandlers(t)

	w := doJSON(r, "GET", "/api/v1/agent/journeys?token=no-journeys", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	resp := parseResp(t, w)
	journeys := resp["data"].(map[string]interface{})["journeys"].([]interface{})
	if len(journeys) != 0 {
		t.Fatalf("journeys count = %d, want 0", len(journeys))
	}
}
