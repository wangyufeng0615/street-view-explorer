package api

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/openai"
	"github.com/my-streetview-project/backend/internal/services"
)

// GeoHandlers handles the geo guessing game endpoints.
type GeoHandlers struct {
	aiClient        openai.Client
	googleAPIKey    string
	httpClient      *http.Client
	locationService *services.LocationService
	battleService   *services.GeoBattleService
}

// NewGeoHandlers creates a new GeoHandlers instance.
// Accepts an optional *http.Client; if nil, falls back to default with timeout.
func NewGeoHandlers(
	aiClient openai.Client,
	googleAPIKey string,
	locationService *services.LocationService,
	battleService *services.GeoBattleService,
	httpClient ...*http.Client,
) *GeoHandlers {
	var c *http.Client
	if len(httpClient) > 0 && httpClient[0] != nil {
		// Wrap with timeout if the provided client doesn't have one
		c = httpClient[0]
		if c.Timeout == 0 {
			c = &http.Client{Transport: c.Transport, Timeout: 15 * time.Second}
		}
	} else {
		c = &http.Client{Timeout: 15 * time.Second}
	}
	return &GeoHandlers{
		aiClient:        aiClient,
		googleAPIKey:    googleAPIKey,
		httpClient:      c,
		locationService: locationService,
		battleService:   battleService,
	}
}

// SatelliteImage proxies a Google Maps Static API satellite image.
// This avoids browser-side tile loading issues (e.g. in China).
func (gh *GeoHandlers) SatelliteImage(c *gin.Context) {
	latStr := c.Query("lat")
	lngStr := c.Query("lng")
	zoomStr := c.Query("zoom")

	if latStr == "" || lngStr == "" || zoomStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "lat, lng, zoom required"})
		return
	}

	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil || lat < -90 || lat > 90 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid lat"})
		return
	}
	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil || lng < -180 || lng > 180 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid lng"})
		return
	}
	zoom, err := strconv.Atoi(zoomStr)
	if err != nil || zoom < 1 || zoom > 21 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid zoom"})
		return
	}

	gh.proxySatelliteImage(c, lat, lng, zoom, "public, max-age=86400")
}

type geoAIGuessRequest struct {
	Lat  *float64 `json:"lat"`
	Lng  *float64 `json:"lng"`
	Zoom *int     `json:"zoom"`
}

// AIGuess fetches a satellite image for the given coordinates and asks AI to guess the location.
func (gh *GeoHandlers) AIGuess(c *gin.Context) {
	var req geoAIGuessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid request body"})
		return
	}

	if req.Lat == nil || req.Lng == nil || req.Zoom == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "lat, lng, zoom are required"})
		return
	}

	lat, lng, zoom := *req.Lat, *req.Lng, *req.Zoom

	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Coordinates out of range"})
		return
	}
	if zoom < 1 || zoom > 21 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Zoom must be 1-21"})
		return
	}

	imageURL := fmt.Sprintf(
		"https://maps.googleapis.com/maps/api/staticmap?center=%.6f,%.6f&zoom=%d&size=600x400&maptype=satellite&key=%s",
		lat, lng, zoom, gh.googleAPIKey,
	)

	resp, err := gh.httpClient.Get(imageURL)
	if err != nil {
		log.Printf("[GEO] Failed to fetch satellite image: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to fetch satellite image"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[GEO] Google Static Maps returned status %d", resp.StatusCode)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to fetch satellite image"})
		return
	}

	imageBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[GEO] Failed to read satellite image: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to read satellite image"})
		return
	}

	imageBase64 := base64.StdEncoding.EncodeToString(imageBytes)

	guessLat, guessLng, reasoning, err := gh.aiClient.GuessLocationFromImage(c.Request.Context(), imageBase64, zoom)
	if err != nil {
		log.Printf("[GEO] AI guess failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "AI guess failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"lat":       guessLat,
			"lng":       guessLng,
			"reasoning": reasoning,
		},
	})
}

func (gh *GeoHandlers) proxySatelliteImage(c *gin.Context, lat, lng float64, zoom int, cacheControl string) {
	imageURL := fmt.Sprintf(
		"https://maps.googleapis.com/maps/api/staticmap?center=%.6f,%.6f&zoom=%d&size=800x600&maptype=satellite&key=%s",
		lat, lng, zoom, gh.googleAPIKey,
	)

	resp, err := gh.httpClient.Get(imageURL)
	if err != nil {
		log.Printf("[GEO] satellite image fetch failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": "image fetch failed"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[GEO] Google Static Maps status %d", resp.StatusCode)
		c.Status(resp.StatusCode)
		io.Copy(c.Writer, resp.Body)
		return
	}

	c.Header("Content-Type", resp.Header.Get("Content-Type"))
	c.Header("Cache-Control", cacheControl)
	c.Status(http.StatusOK)
	io.Copy(c.Writer, resp.Body)
}

func (gh *GeoHandlers) geoBattleStatusCode(err error) int {
	switch {
	case errors.Is(err, services.ErrGeoBattleInvalidNickname),
		errors.Is(err, services.ErrGeoBattleInvalidCode):
		return http.StatusBadRequest
	case errors.Is(err, services.ErrGeoBattleRoomNotFound):
		return http.StatusNotFound
	case errors.Is(err, services.ErrGeoBattleNotInRoom):
		return http.StatusForbidden
	case errors.Is(err, services.ErrGeoBattleRoomFull),
		errors.Is(err, services.ErrGeoBattleRoomClosed),
		errors.Is(err, services.ErrGeoBattleAlreadyQueued),
		errors.Is(err, services.ErrGeoBattleNotQueued),
		errors.Is(err, services.ErrGeoBattleAlreadyGuessed),
		errors.Is(err, services.ErrGeoBattleAlreadyInRoom),
		errors.Is(err, services.ErrGeoBattleInvalidPhase),
		errors.Is(err, services.ErrGeoBattleImageNotReady):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

func (gh *GeoHandlers) geoBattleSessionID(c *gin.Context) (string, error) {
	sessionIDValue, exists := c.Get("sessionID")
	if !exists {
		return "", fmt.Errorf("missing session id")
	}

	sessionID, ok := sessionIDValue.(string)
	if !ok || sessionID == "" {
		return "", fmt.Errorf("missing session id")
	}

	return sessionID, nil
}
