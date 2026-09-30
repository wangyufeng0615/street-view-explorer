package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/services"
	"github.com/my-streetview-project/backend/internal/utils"
)

// 获取随机位置
func (h *Handlers) GetRandomLocation(c *gin.Context) {
	sessionID := h.getSessionID(c)
	if sessionID == "" {
		return
	}

	svc := h.servicesForMode(c)

	// Get language from query parameter, default to "en" (align with frontend default)
	language := c.DefaultQuery("lang", "en")
	countryCode := ""
	for _, key := range []string{"country", "country_code", "countryCode"} {
		if raw := c.Query(key); raw != "" {
			normalized, ok := utils.NormalizeISOAlpha2CountryCode(raw)
			if !ok {
				c.JSON(http.StatusBadRequest, gin.H{
					"success": false,
					"error":   "country must be an ISO 3166-1 alpha-2 country code",
				})
				return
			}
			countryCode = normalized
			break
		}
	}

	// 获取随机位置（自动处理用户偏好）
	loc, err := svc.LocationService.GetRandomLocationWithContext(c.Request.Context(), sessionID, language, countryCode)
	if err != nil {
		status := http.StatusInternalServerError
		if countryCode != "" && strings.Contains(err.Error(), "不支持的国家代码") {
			status = http.StatusBadRequest
		}
		CaptureHandlerError(c, err, status, map[string]interface{}{
			"operation":    "get_random_location",
			"language":     language,
			"country_code": countryCode,
		})
		c.JSON(status, gin.H{
			"success": false,
			"error":   PublicErrorMessage(err),
		})
		return
	}

	// Skip visit recording for geo game rounds (source=geo_game). A home-page
	// prefetch (prefetch=1) defers the footprint until the place is shown; see
	// RecordPrefetchedVisit.
	source := c.DefaultQuery("source", "")
	if source != "geo_game" && c.Query("prefetch") == "1" {
		h.prefetched.add(sessionID, loc.PanoID)
	} else if source != "geo_game" {
		if err := svc.LocationService.RecordVisit(sessionID, loc, models.VisitSourceRandom); err != nil {
			CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
				"operation": "record_random_visit",
				"pano_id":   loc.PanoID,
				"source":    models.VisitSourceRandom,
			})
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   PublicErrorMessage(err),
			})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"location": loc,
		},
	})
}

// RecordPrefetchedVisit writes the random-exploration footprint for a place
// that this session prefetched and is now showing. Each prefetch can be
// recorded once, within prefetchTTL.
func (h *Handlers) RecordPrefetchedVisit(c *gin.Context) {
	sessionID := h.getSessionID(c)
	if sessionID == "" {
		return
	}
	panoID := c.Param("panoId")
	if !h.prefetched.take(sessionID, panoID) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "no pending prefetch for this location"})
		return
	}

	svc := h.servicesForMode(c)
	loc, err := svc.LocationService.GetLocation(panoID)
	if err == nil {
		err = svc.LocationService.RecordVisit(sessionID, *loc, models.VisitSourceRandom)
	}
	if err != nil {
		CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
			"operation": "record_prefetched_visit",
			"pano_id":   panoID,
		})
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": PublicErrorMessage(err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// LookupLocation 根据坐标查找位置
func (h *Handlers) LookupLocation(c *gin.Context) {
	latStr := c.Query("lat")
	lngStr := c.Query("lng")
	language := c.DefaultQuery("lang", "en")

	if latStr == "" || lngStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Missing lat or lng parameter",
		})
		return
	}

	lat, err := parseCoordinate(latStr, -90, 90)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid lat parameter",
		})
		return
	}
	lng, err := parseCoordinate(lngStr, -180, 180)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid lng parameter",
		})
		return
	}

	svc := h.servicesForMode(c)
	scope := strings.TrimSpace(c.DefaultQuery("scope", "nearby"))
	var loc *models.Location
	var lookupErr error
	if scope == "nearest" {
		loc, lookupErr = svc.LocationService.LookupNearestLocationWithContext(c.Request.Context(), lat, lng, language)
	} else {
		loc, lookupErr = svc.LocationService.LookupLocationWithContext(c.Request.Context(), lat, lng, language)
	}
	if lookupErr != nil {
		if errors.Is(lookupErr, services.ErrStreetViewNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"success": false,
				"error":   PublicErrorMessage(lookupErr),
			})
			return
		}
		CaptureHandlerError(c, lookupErr, http.StatusInternalServerError, map[string]interface{}{
			"operation": "lookup_location",
			"latitude":  lat,
			"longitude": lng,
			"language":  language,
			"scope":     scope,
		})
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   PublicErrorMessage(lookupErr),
		})
		return
	}

	sessionID := h.getOptionalSessionID(c)
	if sessionID != "" {
		source := normalizeVisitSource(c.DefaultQuery("source", models.VisitSourceLookup))
		if err := svc.LocationService.RecordVisit(sessionID, *loc, source); err != nil {
			CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
				"operation": "record_lookup_visit",
				"pano_id":   loc.PanoID,
				"source":    source,
			})
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   PublicErrorMessage(err),
			})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"location": loc,
		},
	})
}

// SearchLocation resolves a concrete place query and loads nearby Street View.
func (h *Handlers) SearchLocation(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	language := c.DefaultQuery("lang", "en")

	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Missing q parameter",
		})
		return
	}
	if len([]rune(query)) > 240 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Search query is too long",
		})
		return
	}

	svc := h.servicesForMode(c)
	loc, place, err := svc.LocationService.SearchLocationWithContext(c.Request.Context(), query, language)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(c.Request.Context().Err(), context.Canceled) {
			return
		}
		if !isSearchNotFound(place, err) {
			CaptureHandlerError(c, err, http.StatusBadGateway, map[string]interface{}{
				"operation": "search_location",
				"language":  language,
			})
			c.JSON(http.StatusBadGateway, gin.H{
				"success": false,
				"error":   "地点搜索暂时不可用，请稍后再试",
				"data": gin.H{
					"place": place,
				},
			})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   PublicErrorMessage(err),
			"data": gin.H{
				"place": place,
			},
		})
		return
	}

	sessionID := h.getOptionalSessionID(c)
	if sessionID != "" {
		if err := svc.LocationService.RecordVisit(sessionID, *loc, models.VisitSourceLookup); err != nil {
			CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
				"operation": "record_search_visit",
				"pano_id":   loc.PanoID,
				"source":    models.VisitSourceLookup,
			})
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   PublicErrorMessage(err),
			})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"location": loc,
			"place":    place,
		},
	})
}

// isSearchNotFound separates "no such place / no Street View nearby" from
// infrastructure failures (lookup errors, database writes). The service layer
// reports not-found cases with plain error strings, so they are matched here.
func isSearchNotFound(place *services.PlaceResolution, err error) bool {
	if place != nil || errors.Is(err, services.ErrStreetViewNotFound) {
		return true
	}
	message := err.Error()
	for _, marker := range []string{"未找到地点", "地点解析结果无效", "缺少地点关键词"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func normalizeVisitSource(source string) string {
	switch strings.TrimSpace(source) {
	case models.VisitSourceShared:
		return models.VisitSourceShared
	case models.VisitSourceMapPick:
		return models.VisitSourceMapPick
	default:
		return models.VisitSourceLookup
	}
}
