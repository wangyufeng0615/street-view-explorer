package api

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/openai"
)

// GeoHandlers handles the geo guessing game endpoints.
type GeoHandlers struct {
	aiClient     openai.Client
	googleAPIKey string
	httpClient   *http.Client
}

// NewGeoHandlers creates a new GeoHandlers instance.
// Accepts an optional *http.Client; if nil, falls back to default with timeout.
func NewGeoHandlers(aiClient openai.Client, googleAPIKey string, httpClient ...*http.Client) *GeoHandlers {
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
		aiClient:     aiClient,
		googleAPIKey: googleAPIKey,
		httpClient:   c,
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
	c.Header("Cache-Control", "public, max-age=86400")
	c.Status(http.StatusOK)
	io.Copy(c.Writer, resp.Body)
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
