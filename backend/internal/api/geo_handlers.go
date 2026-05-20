package api

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	_ "image/gif"
	_ "image/jpeg"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/openai"
	"github.com/my-streetview-project/backend/internal/services"
)

const (
	geoSatelliteImageDefaultWidth  = 640
	geoSatelliteImageDefaultHeight = 480
	geoSatelliteImageScale         = 2
	geoSatelliteImageMinSide       = 120
	geoSatelliteImageMaxSide       = 640
	geoMinZoom                     = 2
	geoMaxZoom                     = 14
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
	if err != nil || zoom < geoMinZoom || zoom > geoMaxZoom {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid zoom"})
		return
	}
	width, height, err := geoSatelliteImageSizeFromValues(c.Query("width"), c.Query("height"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": PublicErrorMessage(err)})
		return
	}

	gh.proxySatelliteImage(c, lat, lng, zoom, width, height, "public, max-age=86400")
}

type geoAIGuessRequest struct {
	Lat      *float64 `json:"lat"`
	Lng      *float64 `json:"lng"`
	Zoom     *int     `json:"zoom"`
	Width    *int     `json:"width"`
	Height   *int     `json:"height"`
	Language string   `json:"lang"`
}

func normalizeGeoLanguage(language string) string {
	language = strings.ToLower(strings.TrimSpace(language))
	if strings.HasPrefix(language, "zh") {
		return "zh"
	}
	return "en"
}

func geoSatelliteImageSizeFromValues(widthValue, heightValue string) (int, int, error) {
	if widthValue == "" && heightValue == "" {
		return geoSatelliteImageDefaultWidth, geoSatelliteImageDefaultHeight, nil
	}
	if widthValue == "" || heightValue == "" {
		return 0, 0, fmt.Errorf("width and height must be provided together")
	}
	width, err := strconv.Atoi(widthValue)
	if err != nil {
		return 0, 0, fmt.Errorf("invalid width")
	}
	height, err := strconv.Atoi(heightValue)
	if err != nil {
		return 0, 0, fmt.Errorf("invalid height")
	}
	return validateGeoSatelliteImageSize(width, height)
}

func geoSatelliteImageSizeFromRequest(widthValue, heightValue *int) (int, int, error) {
	if widthValue == nil && heightValue == nil {
		return geoSatelliteImageDefaultWidth, geoSatelliteImageDefaultHeight, nil
	}
	if widthValue == nil || heightValue == nil {
		return 0, 0, fmt.Errorf("width and height must be provided together")
	}
	return validateGeoSatelliteImageSize(*widthValue, *heightValue)
}

func validateGeoSatelliteImageSize(width, height int) (int, int, error) {
	if width < geoSatelliteImageMinSide || width > geoSatelliteImageMaxSide {
		return 0, 0, fmt.Errorf("invalid width")
	}
	if height < geoSatelliteImageMinSide || height > geoSatelliteImageMaxSide {
		return 0, 0, fmt.Errorf("invalid height")
	}
	return width, height, nil
}

func geoSatelliteImageURL(apiKey string, lat, lng float64, zoom int, width, height int) string {
	return fmt.Sprintf(
		"https://maps.googleapis.com/maps/api/staticmap?center=%.6f,%.6f&zoom=%d&size=%dx%d&scale=%d&maptype=satellite&key=%s",
		lat,
		lng,
		zoom,
		width,
		height,
		geoSatelliteImageScale,
		apiKey,
	)
}

func (gh *GeoHandlers) redactMapError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if gh.googleAPIKey != "" {
		message = strings.ReplaceAll(message, gh.googleAPIKey, "[redacted]")
	}
	return message
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
	language := normalizeGeoLanguage(req.Language)

	if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Coordinates out of range"})
		return
	}
	if zoom < geoMinZoom || zoom > geoMaxZoom {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Zoom must be 2-14"})
		return
	}
	width, height, err := geoSatelliteImageSizeFromRequest(req.Width, req.Height)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": PublicErrorMessage(err)})
		return
	}

	imageURL := geoSatelliteImageURL(gh.googleAPIKey, lat, lng, zoom, width, height)

	resp, err := gh.httpClient.Get(imageURL)
	if err != nil {
		log.Printf("[GEO] Failed to fetch satellite image: %s", gh.redactMapError(err))
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

	aiImageBytes, err := annotateGeoAICenterReticle(imageBytes)
	if err != nil {
		log.Printf("[GEO] Failed to annotate AI satellite image, falling back to raw image: %v", err)
		aiImageBytes = imageBytes
	}

	imageBase64 := base64.StdEncoding.EncodeToString(aiImageBytes)

	guessLat, guessLng, reasoning, err := gh.aiClient.GuessLocationFromImage(c.Request.Context(), imageBase64, zoom, language)
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

func annotateGeoAICenterReticle(imageBytes []byte) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(imageBytes))
	if err != nil {
		return nil, err
	}

	bounds := img.Bounds()
	if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
		return nil, fmt.Errorf("invalid image bounds")
	}

	rgba := image.NewRGBA(bounds)
	draw.Draw(rgba, bounds, img, bounds.Min, draw.Src)

	cx := bounds.Min.X + bounds.Dx()/2
	cy := bounds.Min.Y + bounds.Dy()/2
	drawGeoAICenterReticle(rgba, cx, cy)

	var buf bytes.Buffer
	if err := png.Encode(&buf, rgba); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func drawGeoAICenterReticle(img *image.RGBA, cx, cy int) {
	white := color.RGBA{R: 255, G: 255, B: 255, A: 245}
	red := color.RGBA{R: 230, G: 40, B: 40, A: 255}

	drawThickLine(img, cx-22, cy, cx-5, cy, 5, white)
	drawThickLine(img, cx+5, cy, cx+22, cy, 5, white)
	drawThickLine(img, cx, cy-22, cx, cy-5, 5, white)
	drawThickLine(img, cx, cy+5, cx, cy+22, 5, white)

	drawThickLine(img, cx-21, cy, cx-6, cy, 3, red)
	drawThickLine(img, cx+6, cy, cx+21, cy, 3, red)
	drawThickLine(img, cx, cy-21, cx, cy-6, 3, red)
	drawThickLine(img, cx, cy+6, cx, cy+21, 3, red)

	drawCircleOutline(img, cx, cy, 7, 2, white)
	drawCircleOutline(img, cx, cy, 6, 2, red)
	setPixelIfInBounds(img, cx, cy, red)
}

func drawThickLine(img *image.RGBA, x1, y1, x2, y2, thickness int, col color.RGBA) {
	if x1 == x2 {
		for y := minInt(y1, y2); y <= maxInt(y1, y2); y++ {
			for dx := -thickness / 2; dx <= thickness/2; dx++ {
				setPixelIfInBounds(img, x1+dx, y, col)
			}
		}
		return
	}

	if y1 == y2 {
		for x := minInt(x1, x2); x <= maxInt(x1, x2); x++ {
			for dy := -thickness / 2; dy <= thickness/2; dy++ {
				setPixelIfInBounds(img, x, y1+dy, col)
			}
		}
	}
}

func drawCircleOutline(img *image.RGBA, cx, cy, radius, thickness int, col color.RGBA) {
	inner := radius - thickness
	innerSq := inner * inner
	outerSq := radius * radius
	for y := cy - radius; y <= cy+radius; y++ {
		for x := cx - radius; x <= cx+radius; x++ {
			dx := x - cx
			dy := y - cy
			distSq := dx*dx + dy*dy
			if distSq >= innerSq && distSq <= outerSq {
				setPixelIfInBounds(img, x, y, col)
			}
		}
	}
}

func setPixelIfInBounds(img *image.RGBA, x, y int, col color.RGBA) {
	if image.Pt(x, y).In(img.Bounds()) {
		img.SetRGBA(x, y, col)
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (gh *GeoHandlers) proxySatelliteImage(c *gin.Context, lat, lng float64, zoom int, width, height int, cacheControl string) {
	imageURL := geoSatelliteImageURL(gh.googleAPIKey, lat, lng, zoom, width, height)

	resp, err := gh.httpClient.Get(imageURL)
	if err != nil {
		log.Printf("[GEO] satellite image fetch failed: %s", gh.redactMapError(err))
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
