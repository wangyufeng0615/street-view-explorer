package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/repositories"
)

// AgentHandlers holds dependencies for agent-related endpoints.
type AgentHandlers struct {
	repo         repositories.Repository
	limiter      repositories.RateLimiter
	global       *ModeServices
	googleAPIKey string
}

func NewAgentHandlers(repo repositories.Repository, limiter repositories.RateLimiter, global *ModeServices, googleAPIKey string) *AgentHandlers {
	return &AgentHandlers{repo: repo, limiter: limiter, global: global, googleAPIKey: googleAPIKey}
}

// ==================== Token helpers ====================

const maxAgentTokenLength = 128

var agentTokenRegex = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// extractToken reads the bearer token from Authorization header or ?token= query.
func extractToken(c *gin.Context) string {
	if auth := c.GetHeader("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	return strings.TrimSpace(c.Query("token"))
}

func clientIP(c *gin.Context) string {
	return c.ClientIP()
}

func validateAgentToken(token string) error {
	if token == "" {
		return fmt.Errorf("Token is required")
	}
	if len(token) > maxAgentTokenLength {
		return fmt.Errorf("Token is too long")
	}
	if !agentTokenRegex.MatchString(token) {
		return fmt.Errorf("Token contains invalid characters")
	}
	return nil
}

func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ==================== Handlers ====================

// CreateJourney — POST /agent/journeys
func (ah *AgentHandlers) CreateJourney(c *gin.Context) {
	var req struct {
		StartLat   float64 `json:"start_lat"`
		StartLng   float64 `json:"start_lng"`
		TotalStops int     `json:"total_stops"`
		Token      string  `json:"token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid request body"})
		return
	}

	req.Token = strings.TrimSpace(req.Token)
	if err := validateAgentToken(req.Token); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if req.StartLat < -90 || req.StartLat > 90 || req.StartLng < -180 || req.StartLng > 180 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid coordinates"})
		return
	}
	if req.TotalStops < 1 || req.TotalStops > 20 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "total_stops must be 1-20"})
		return
	}

	// Rate limit: 10 journeys/hour per token
	if ah.limiter != nil {
		allowed, _, _ := ah.limiter.CheckAndIncrement("agent_create:"+req.Token, 10, time.Hour)
		if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "Too many journeys created, try again later"})
			return
		}
	}

	now := time.Now()
	journey := models.AgentJourney{
		ID:         generateID(),
		Token:      req.Token,
		StartLat:   req.StartLat,
		StartLng:   req.StartLng,
		TotalStops: req.TotalStops,
		Status:     models.JourneyStatusPending,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	if err := ah.repo.CreateJourney(journey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"journey_id": journey.ID,
			"token":      journey.Token,
		},
	})
}

// ListJourneys — GET /agent/journeys?token=X
func (ah *AgentHandlers) ListJourneys(c *gin.Context) {
	token := extractToken(c)
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Token is required"})
		return
	}
	if err := validateAgentToken(token); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	journeys, err := ah.repo.GetJourneysByToken(token)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	if journeys == nil {
		journeys = []models.AgentJourney{}
	}

	// Count total unique places visited by this traveler
	totalPlaces, _ := ah.repo.GetTotalPlacesByToken(token)

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"journeys":     journeys,
		"total_places": totalPlaces,
	}})
}

// GetJourney — GET /agent/journeys/:id
func (ah *AgentHandlers) GetJourney(c *gin.Context) {
	id := c.Param("id")
	token := extractToken(c)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "Token is required"})
		return
	}
	if err := validateAgentToken(token); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	journey, err := ah.repo.GetJourney(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if journey == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Journey not found"})
		return
	}

	if journey.Token != token {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "Token mismatch"})
		return
	}

	stops, err := ah.repo.GetJourneyStops(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if stops == nil {
		stops = []models.AgentJourneyStop{}
	}

	// Don't expose token in response
	journey.Token = ""

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"journey": journey,
			"stops":   stops,
		},
	})
}

// UpdateJourneyStatus — PUT /agent/journeys/:id/status
func (ah *AgentHandlers) UpdateJourneyStatus(c *gin.Context) {
	id := c.Param("id")
	token := extractToken(c)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "Token is required"})
		return
	}
	if err := validateAgentToken(token); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid request body"})
		return
	}

	if req.Status != models.JourneyStatusInProgress && req.Status != models.JourneyStatusCompleted {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Status must be 'in_progress' or 'completed'"})
		return
	}

	if err := ah.repo.UpdateJourneyStatus(id, token, req.Status); err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "不匹配") {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AgentExplore — GET /agent/explore?lat=X&lng=Y&token=T
func (ah *AgentHandlers) AgentExplore(c *gin.Context) {
	token := extractToken(c)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "Token is required"})
		return
	}
	if err := validateAgentToken(token); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	latStr := c.Query("lat")
	lngStr := c.Query("lng")
	language := c.DefaultQuery("lang", "en")

	if latStr == "" || lngStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Missing lat or lng parameter"})
		return
	}

	lat, err := parseCoordinate(latStr, -90, 90)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid lat parameter"})
		return
	}
	lng, err := parseCoordinate(lngStr, -180, 180)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid lng parameter"})
		return
	}

	if ah.limiter != nil {
		// Per-token: 60 explores/hour
		allowed, _, _ := ah.limiter.CheckAndIncrement("agent_explore:"+token, 60, time.Hour)
		if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "Rate limit exceeded, try again later"})
			return
		}
		// Per-IP global: 200 explores/hour (prevents token rotation abuse)
		allowed, _, _ = ah.limiter.CheckAndIncrement("agent_explore_ip:"+clientIP(c), 200, time.Hour)
		if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "Rate limit exceeded"})
			return
		}
	}

	loc, err := ah.global.LocationService.LookupLocation(lat, lng, language)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "No street view found near these coordinates. Try adjusting lat/lng to a location closer to roads or populated areas. Do NOT call streetview API without a valid pano_id from a successful explore response.",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"pano_id":           loc.PanoID,
			"latitude":          loc.Latitude,
			"longitude":         loc.Longitude,
			"formatted_address": loc.FormattedAddress,
			"country":           loc.Country,
			"city":              loc.City,
		},
	})
}

// SaveJourneyStop — POST /agent/journeys/:id/stops
func (ah *AgentHandlers) SaveJourneyStop(c *gin.Context) {
	id := c.Param("id")
	token := extractToken(c)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "Token is required"})
		return
	}
	if err := validateAgentToken(token); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	// Verify journey ownership
	journey, err := ah.repo.GetJourney(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if journey == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Journey not found"})
		return
	}
	if journey.Token != token {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "Token mismatch"})
		return
	}

	var req struct {
		StopNumber    int     `json:"stop_number"`
		Lat           float64 `json:"lat"`
		Lng           float64 `json:"lng"`
		PanoID        string  `json:"pano_id"`
		PhotoHeading  int     `json:"photo_heading"`
		LocationInfo  string  `json:"location_info"`
		AIDescription string  `json:"ai_description"`
		JournalEntry  string  `json:"journal_entry"`
		NextReasoning string  `json:"next_reasoning"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid request body"})
		return
	}

	if req.StopNumber < 1 || req.StopNumber > journey.TotalStops {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid stop_number"})
		return
	}

	// Validate coordinates
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid coordinates"})
		return
	}

	// Limit field sizes
	if len(req.JournalEntry) > 10000 || len(req.AIDescription) > 10000 || len(req.NextReasoning) > 5000 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Field content too long"})
		return
	}

	stop := models.AgentJourneyStop{
		JourneyID:     id,
		StopNumber:    req.StopNumber,
		Lat:           req.Lat,
		Lng:           req.Lng,
		PanoID:        req.PanoID,
		PhotoHeading:  req.PhotoHeading,
		LocationInfo:  req.LocationInfo,
		AIDescription: req.AIDescription,
		JournalEntry:  req.JournalEntry,
		NextReasoning: req.NextReasoning,
		CreatedAt:     time.Now(),
	}

	if err := ah.repo.SaveJourneyStop(stop); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetJourneyStops — GET /agent/journeys/:id/stops
func (ah *AgentHandlers) GetJourneyStops(c *gin.Context) {
	id := c.Param("id")
	token := extractToken(c)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "Token is required"})
		return
	}
	if err := validateAgentToken(token); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	// Verify ownership
	journey, err := ah.repo.GetJourney(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if journey == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Journey not found"})
		return
	}
	if journey.Token != token {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "Token mismatch"})
		return
	}

	stops, err := ah.repo.GetJourneyStops(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if stops == nil {
		stops = []models.AgentJourneyStop{}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"stops": stops}})
}

// SaveJourneyLetter — POST /agent/journeys/:id/letter
func (ah *AgentHandlers) SaveJourneyLetter(c *gin.Context) {
	id := c.Param("id")
	token := extractToken(c)
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "Token is required"})
		return
	}
	if err := validateAgentToken(token); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	var req struct {
		Letter string `json:"letter"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid request body"})
		return
	}

	if req.Letter == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Letter content is required"})
		return
	}

	if len(req.Letter) > 10*1024*1024 { // 10MB
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Letter content too long"})
		return
	}

	if err := ah.repo.SaveJourneyLetter(id, token, req.Letter); err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "不匹配") {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetPublicLetter — GET /agent/journeys/:id/public-letter (no auth required)
func (ah *AgentHandlers) GetPublicLetter(c *gin.Context) {
	id := c.Param("id")

	journey, err := ah.repo.GetJourney(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	if journey == nil || journey.Letter == "" {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "Letter not found"})
		return
	}

	// Only return letter + photo info for each stop (no journal/reasoning)
	stops, _ := ah.repo.GetJourneyStops(id)
	type publicStop struct {
		StopNumber   int    `json:"stop_number"`
		PanoID       string `json:"pano_id"`
		PhotoHeading int    `json:"photo_heading"`
		LocationInfo string `json:"location_info"`
	}
	var photos []publicStop
	for _, s := range stops {
		if s.PanoID != "" {
			photos = append(photos, publicStop{
				StopNumber:   s.StopNumber,
				PanoID:       s.PanoID,
				PhotoHeading: s.PhotoHeading,
				LocationInfo: s.LocationInfo,
			})
		}
	}
	if photos == nil {
		photos = []publicStop{}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"letter":     journey.Letter,
			"start_lat":  journey.StartLat,
			"start_lng":  journey.StartLng,
			"created_at": journey.CreatedAt,
			"photos":     photos,
		},
	})
}

// StreetViewImage — GET /agent/streetview?pano_id=X&heading=Y&token=T
// Proxies Google Street View Static API image so the AI can see the actual street view.
// Auth: either token (for AI agents) or journey_id (for public letter viewing).
func (ah *AgentHandlers) StreetViewImage(c *gin.Context) {
	token := extractToken(c)
	journeyID := c.Query("journey_id")

	if token == "" && journeyID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "Token or journey_id is required"})
		return
	}

	// Auth path: token (AI agents) or journey_id (public letter readers)
	if token != "" {
		if err := validateAgentToken(token); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
			return
		}
	} else {
		// journey_id auth: only allow for journeys with completed letters
		journey, err := ah.repo.GetJourney(journeyID)
		if err != nil || journey == nil || journey.Letter == "" {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "Invalid journey_id or letter not published"})
			return
		}
	}

	panoID := c.Query("pano_id")
	if panoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "pano_id is required. Make sure your explore call returned success=true with a valid pano_id before calling streetview."})
		return
	}
	if len(panoID) > 100 || !panoIDRegex.MatchString(panoID) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid pano_id format. Use the exact pano_id string returned by the explore API."})
		return
	}

	if ah.googleAPIKey == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": "Street view image service not available"})
		return
	}

	// Validate numeric parameters
	headingNum, err := strconv.Atoi(c.DefaultQuery("heading", "0"))
	if err != nil || headingNum < 0 || headingNum > 360 {
		headingNum = 0
	}
	pitchNum, err := strconv.Atoi(c.DefaultQuery("pitch", "0"))
	if err != nil || pitchNum < -90 || pitchNum > 90 {
		pitchNum = 0
	}
	fovNum, err := strconv.Atoi(c.DefaultQuery("fov", "90"))
	if err != nil || fovNum < 10 || fovNum > 120 {
		fovNum = 90
	}

	if ah.limiter != nil {
		// Per-token rate limit (only when using token auth)
		if token != "" {
			allowed, _, _ := ah.limiter.CheckAndIncrement("agent_sv_img:"+token, 120, time.Hour)
			if !allowed {
				c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "Rate limit exceeded"})
				return
			}
		}
		// Per-IP global: 300 images/hour (always applied)
		allowed, _, _ := ah.limiter.CheckAndIncrement("agent_sv_img_ip:"+clientIP(c), 300, time.Hour)
		if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": "Rate limit exceeded"})
			return
		}
	}

	// Build Google Street View Static API URL with safe parameters
	svURL := fmt.Sprintf(
		"https://maps.googleapis.com/maps/api/streetview?size=640x480&pano=%s&heading=%d&pitch=%d&fov=%d&key=%s",
		url.QueryEscape(panoID), headingNum, pitchNum, fovNum, ah.googleAPIKey,
	)

	resp, err := http.Get(svURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": "Failed to fetch street view image"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": "Google API returned error"})
		return
	}

	// Stream the image back
	c.Header("Content-Type", resp.Header.Get("Content-Type"))
	c.Header("Cache-Control", "public, max-age=86400") // cache 24h
	c.Status(http.StatusOK)
	io.Copy(c.Writer, resp.Body)
}
