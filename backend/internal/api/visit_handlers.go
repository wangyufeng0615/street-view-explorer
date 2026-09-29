package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/models"
)

const (
	maxVisitHistoryLimit  = 5000
	maxVisitHistoryOffset = 100000
)

// GetVisitHistory 获取全站共享访问历史
func (h *Handlers) GetVisitHistory(c *gin.Context) {
	limit := parseIntParam(c, "limit", 1000)
	offset := parseIntParam(c, "offset", 0)
	if limit > maxVisitHistoryLimit {
		limit = maxVisitHistoryLimit
	}
	if offset > maxVisitHistoryOffset {
		// Deep OFFSETs make SQLite walk and discard every skipped row.
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "offset too large"})
		return
	}

	svc := h.servicesForMode(c)
	source := strings.TrimSpace(c.Query("source"))
	if source != "" && source != models.VisitSourceRandom && source != models.VisitSourceShared && source != models.VisitSourceLookup && source != models.VisitSourceMapPick {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid visit source"})
		return
	}

	var visits []models.VisitRecord
	var totalVisits, uniquePlaces int64
	var err error
	if c.Query("distinct") == "1" {
		if source == "" {
			source = models.VisitSourceRandom
		}
		visits, totalVisits, uniquePlaces, err = svc.LocationService.GetFootprints(limit, offset, source)
	} else {
		visits, totalVisits, uniquePlaces, err = svc.LocationService.GetGlobalVisitHistory(limit, offset, source)
	}
	if err != nil {
		CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
			"operation": "get_visit_history",
			"limit":     limit,
			"offset":    offset,
		})
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   PublicErrorMessage(err),
		})
		return
	}

	var payload interface{} = visits
	if c.Query("fields") == "map" {
		payload = mapVisitPoints(visits)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"visits":        payload,
			"total":         totalVisits,
			"total_visits":  totalVisits,
			"unique_places": uniquePlaces,
		},
	})
}

// mapVisitPoint is the footprint map's view of a visit. With fields=map the
// 5000-point footprint payload drops from ~390KB to ~120KB; the default
// response keeps every field for other API consumers.
type mapVisitPoint struct {
	PanoID           string  `json:"pano_id"`
	Latitude         float64 `json:"latitude"`
	Longitude        float64 `json:"longitude"`
	FormattedAddress string  `json:"formatted_address"`
}

func mapVisitPoints(visits []models.VisitRecord) []mapVisitPoint {
	points := make([]mapVisitPoint, len(visits))
	for i, v := range visits {
		points[i] = mapVisitPoint{PanoID: v.PanoID, Latitude: v.Latitude, Longitude: v.Longitude, FormattedAddress: v.FormattedAddress}
	}
	return points
}
