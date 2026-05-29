package api

import (
	"net/http"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/services"
)

func setupDescriptionHandlers(t *testing.T) *gin.Engine {
	t.Helper()

	repo, err := repositories.NewSQLiteRepository(testSQLiteConfig{
		path: filepath.Join(t.TempDir(), "description-test.db"),
	})
	if err != nil {
		t.Fatalf("NewSQLiteRepository() error = %v", err)
	}
	t.Cleanup(func() { repo.Close() })

	locationService := services.NewLocationService(repo, nil, nil)
	handlers := NewHandlers(locationService, nil)

	r := gin.New()
	r.GET("/api/v1/locations/:panoId/description", handlers.GetLocationDescription)
	r.GET("/api/v1/locations/:panoId/detailed-description", handlers.GetLocationDetailedDescription)
	return r
}

func TestGetLocationDescriptionMissingLocationReturnsNotFound(t *testing.T) {
	r := setupDescriptionHandlers(t)

	w := doJSON(r, "GET", "/api/v1/locations/does.not.exist/description?lang=en", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body: %s", w.Code, w.Body.String())
	}

	resp := parseResp(t, w)
	if resp["success"] != false {
		t.Fatalf("success = %v, want false", resp["success"])
	}
}

func TestGetLocationDetailedDescriptionMissingLocationReturnsNotFound(t *testing.T) {
	r := setupDescriptionHandlers(t)

	w := doJSON(r, "GET", "/api/v1/locations/does.not.exist/detailed-description?lang=en", nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body: %s", w.Code, w.Body.String())
	}

	resp := parseResp(t, w)
	if resp["success"] != false {
		t.Fatalf("success = %v, want false", resp["success"])
	}
}
