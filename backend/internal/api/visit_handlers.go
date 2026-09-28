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

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"visits":        visits,
			"total":         totalVisits,
			"total_visits":  totalVisits,
			"unique_places": uniquePlaces,
		},
	})
}
