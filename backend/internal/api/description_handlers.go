package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/openai"
	"github.com/my-streetview-project/backend/internal/repositories"
	"github.com/my-streetview-project/backend/internal/services"
	"github.com/my-streetview-project/backend/internal/utils"
)

func wantsDescriptionStream(c *gin.Context) bool {
	value := strings.ToLower(strings.TrimSpace(c.Query("stream")))
	return value == "1" || value == "true"
}

func writeDescriptionSSE(c *gin.Context, event string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, data); err != nil {
		return err
	}
	c.Writer.Flush()
	return nil
}

// Hourly description budgets. The global budget caps total spend; each client
// IP may only use a quarter of it so one address cannot starve everyone else.
const (
	descriptionGlobalBudgetStandard = 360
	descriptionGlobalBudgetDetailed = 120
	descriptionIPBudgetStandard     = descriptionGlobalBudgetStandard / 4
	descriptionIPBudgetDetailed     = descriptionGlobalBudgetDetailed / 4
)

// descriptionBudgetReservation remembers the counters charged for one request
// so they can be returned when the upstream call fails.
type descriptionBudgetReservation struct {
	limiter repositories.RateLimiter
	keys    []string
}

func (r *descriptionBudgetReservation) refund() {
	if r == nil {
		return
	}
	for _, key := range r.keys {
		refundRateLimit(r.limiter, key)
	}
	r.keys = nil
}

// refundOnUpstreamFailure returns the budget unless the client went away
// after the paid AI call started: refunding those would let a client start and
// abort paid calls for free. A visitor who skips to the next stop while the
// scene image is still loading never reached the AI, so that budget comes back.
func (r *descriptionBudgetReservation) refundOnUpstreamFailure(c *gin.Context, err error) {
	if err == nil {
		return
	}
	if errors.Is(err, services.ErrCanceledBeforeUpstream) {
		r.refund()
		return
	}
	if errors.Is(err, context.Canceled) || errors.Is(c.Request.Context().Err(), context.Canceled) {
		return
	}
	r.refund()
}

// clientLeft reports whether the visitor closed the request; that is not a
// server error and should not be reported as one.
func clientLeft(c *gin.Context, err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(c.Request.Context().Err(), context.Canceled)
}

func (h *Handlers) reserveDescriptionBudget(c *gin.Context, detailed bool) (*descriptionBudgetReservation, bool) {
	if h.descriptionBudget == nil {
		return nil, true
	}

	kind := "standard"
	globalMax, ipMax := descriptionGlobalBudgetStandard, descriptionIPBudgetStandard
	if detailed {
		kind = "detailed"
		globalMax, ipMax = descriptionGlobalBudgetDetailed, descriptionIPBudgetDetailed
	}
	reservation := &descriptionBudgetReservation{limiter: h.descriptionBudget}
	unavailable := func() {
		reservation.refund()
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "描述服务的成本保护暂时不可用，请稍后再试",
		})
	}

	ipKey := "ip_budget:description:" + kind + ":" + c.ClientIP()
	allowed, _, err := checkRateLimit(c, h.descriptionBudget, ipKey, ipMax, time.Hour)
	if err != nil {
		unavailable()
		return nil, false
	}
	reservation.keys = append(reservation.keys, ipKey)
	if !allowed {
		c.Header("Retry-After", "3600")
		c.JSON(http.StatusTooManyRequests, gin.H{
			"success": false,
			"error":   "当前网络的描述额度已用完，请稍后再试",
		})
		return nil, false
	}

	globalKey := "global_ratelimit:description:" + kind
	allowed, _, err = checkRateLimit(c, h.descriptionBudget, globalKey, globalMax, time.Hour)
	if err != nil {
		unavailable()
		return nil, false
	}
	reservation.keys = append(reservation.keys, globalKey)
	if !allowed {
		// Nothing was served; give the IP share back.
		reservation.refund()
		c.Header("Retry-After", "3600")
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "描述服务已达到当前时段额度，请稍后再试",
		})
		return nil, false
	}
	return reservation, true
}

// 获取位置描述
func (h *Handlers) GetLocationDescription(c *gin.Context) {
	panoID := c.Param("panoId")
	if panoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Missing location ID",
		})
		return
	}

	// Get language from query parameter, default to "en" (align with frontend default)
	language := c.DefaultQuery("lang", "en")
	view, err := streetViewViewFromRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid Street View parameters"})
		return
	}

	svc := h.servicesForMode(c)

	loc, err := svc.LocationService.GetLocation(panoID)
	if err != nil {
		if errors.Is(err, repositories.ErrLocationNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"success": false,
				"error":   PublicErrorMessage(err),
			})
			return
		}
		CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
			"operation": "get_location_for_description",
			"pano_id":   panoID,
			"language":  language,
		})
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   PublicErrorMessage(err),
		})
		return
	}
	budget, ok := h.reserveDescriptionBudget(c, false)
	if !ok {
		return
	}
	if wantsDescriptionStream(c) {
		h.streamDescription(c, svc.AIService, *loc, language, view, false, budget)
		return
	}

	startTime := time.Now()
	logger := utils.APILogger()

	researchStatus := "unverified"
	ctx := openai.WithResearchObserver(c.Request.Context(), func(status string) { researchStatus = status })
	desc, citations, err := svc.AIService.GetDescriptionForLocationContext(ctx, *loc, language, view)
	if err != nil {
		budget.refundOnUpstreamFailure(c, err)
		if clientLeft(c, err) {
			return
		}
		duration := time.Since(startTime)
		statusCode := descriptionErrorStatus(err)

		logger.Error("get_description_failed", "Failed to get AI description", err, map[string]interface{}{
			"pano_id":  panoID,
			"language": language,
			"duration": duration.String(),
			"status":   statusCode,
		})
		CaptureHandlerError(c, err, statusCode, map[string]interface{}{
			"operation": "get_description",
			"pano_id":   panoID,
			"language":  language,
			"duration":  duration.String(),
		})

		c.JSON(statusCode, gin.H{
			"success":  false,
			"error":    PublicErrorMessage(err),
			"duration": duration.String(),
		})
		return
	}

	cleanDesc := sanitizeDescription(desc)

	// 验证描述内容是否有效
	if cleanDesc == "" || strings.TrimSpace(cleanDesc) == "" {
		duration := time.Since(startTime)
		logger.Error("empty_description", "AI generated empty description", nil, map[string]interface{}{
			"pano_id":     panoID,
			"language":    language,
			"duration":    duration.String(),
			"desc_length": len(desc),
		})

		c.JSON(http.StatusInternalServerError, gin.H{
			"success":  false,
			"error":    "AI生成的描述为空，请重试",
			"duration": duration.String(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"description":     cleanDesc,
			"citations":       citations,
			"research_status": researchStatus,
			"language":        language,
			"duration":        time.Since(startTime).String(),
		},
	})
}

// 获取位置详细描述
func (h *Handlers) GetLocationDetailedDescription(c *gin.Context) {
	panoID := c.Param("panoId")
	if panoID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Missing location ID",
		})
		return
	}

	// Get language from query parameter, default to "en" (align with frontend default)
	language := c.DefaultQuery("lang", "en")
	view, err := streetViewViewFromRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid Street View parameters"})
		return
	}

	svc := h.servicesForMode(c)

	loc, err := svc.LocationService.GetLocation(panoID)
	if err != nil {
		if errors.Is(err, repositories.ErrLocationNotFound) {
			c.JSON(http.StatusNotFound, gin.H{
				"success": false,
				"error":   PublicErrorMessage(err),
			})
			return
		}
		CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
			"operation": "get_location_for_detailed_description",
			"pano_id":   panoID,
			"language":  language,
		})
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   PublicErrorMessage(err),
		})
		return
	}
	budget, ok := h.reserveDescriptionBudget(c, true)
	if !ok {
		return
	}
	if wantsDescriptionStream(c) {
		h.streamDescription(c, svc.AIService, *loc, language, view, true, budget)
		return
	}

	startTime := time.Now()
	logger := utils.APILogger()

	researchStatus := "unverified"
	ctx := openai.WithResearchObserver(c.Request.Context(), func(status string) { researchStatus = status })
	desc, citations, err := svc.AIService.GetDetailedDescriptionForLocationContext(ctx, *loc, language, view)
	if err != nil {
		budget.refundOnUpstreamFailure(c, err)
		if clientLeft(c, err) {
			return
		}
		duration := time.Since(startTime)
		statusCode := descriptionErrorStatus(err)

		logger.Error("get_detailed_description_failed", "Failed to get detailed AI description", err, map[string]interface{}{
			"pano_id":  panoID,
			"language": language,
			"duration": time.Since(startTime).String(),
			"status":   statusCode,
		})
		CaptureHandlerError(c, err, statusCode, map[string]interface{}{
			"operation": "get_detailed_description",
			"pano_id":   panoID,
			"language":  language,
			"duration":  duration.String(),
		})

		c.JSON(statusCode, gin.H{
			"success":  false,
			"error":    PublicErrorMessage(err),
			"duration": duration.String(),
		})
		return
	}

	cleanDesc := sanitizeDescription(desc)
	if cleanDesc == "" || strings.TrimSpace(cleanDesc) == "" {
		duration := time.Since(startTime)
		logger.Error("empty_detailed_description", "AI generated empty detailed description", nil, map[string]interface{}{
			"pano_id":     panoID,
			"language":    language,
			"duration":    duration.String(),
			"desc_length": len(desc),
		})

		c.JSON(http.StatusInternalServerError, gin.H{
			"success":  false,
			"error":    "AI生成的详细描述为空，请重试",
			"duration": duration.String(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"description":     cleanDesc,
			"citations":       citations,
			"research_status": researchStatus,
			"language":        language,
			"duration":        time.Since(startTime).String(),
		},
	})
}

func (h *Handlers) streamDescription(c *gin.Context, aiService *services.AIService, loc models.Location, language string, view services.StreetViewView, detailed bool, budget *descriptionBudgetReservation) {
	startTime := time.Now()
	researchStatus := "unverified"
	ctx := openai.WithResearchObserver(c.Request.Context(), func(status string) { researchStatus = status })
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	if err := writeDescriptionSSE(c, "status", gin.H{"phase": "researching"}); err != nil {
		return
	}

	onDelta := func(delta string) error {
		return writeDescriptionSSE(c, "delta", gin.H{"text": delta})
	}

	var (
		desc      string
		citations []openai.Citation
		err       error
	)
	if detailed {
		desc, citations, err = aiService.StreamDetailedDescriptionForLocation(ctx, loc, language, view, onDelta)
	} else {
		desc, citations, err = aiService.StreamDescriptionForLocation(ctx, loc, language, view, onDelta)
	}
	if err != nil {
		budget.refundOnUpstreamFailure(c, err)
		if clientLeft(c, err) {
			return
		}
		CaptureHandlerError(c, err, descriptionErrorStatus(err), map[string]interface{}{
			"operation": "stream_description",
			"pano_id":   loc.PanoID,
			"language":  language,
			"detailed":  detailed,
			"duration":  time.Since(startTime).String(),
		})
		_ = writeDescriptionSSE(c, "error", gin.H{"error": PublicErrorMessage(err)})
		return
	}

	cleanDesc := sanitizeDescription(desc)
	if strings.TrimSpace(cleanDesc) == "" {
		_ = writeDescriptionSSE(c, "error", gin.H{"error": "AI生成的描述为空，请重试"})
		return
	}
	_ = writeDescriptionSSE(c, "done", gin.H{
		"description":     cleanDesc,
		"citations":       citations,
		"research_status": researchStatus,
		"language":        language,
		"duration":        time.Since(startTime).String(),
	})
}

// GetStreetViewFrame returns the exact frame used as visual context by Atlas.
// It is also consumed by the browser Realtime client as an input_image item.
func (h *Handlers) GetStreetViewFrame(c *gin.Context) {
	panoID := strings.TrimSpace(c.Param("panoId"))
	if panoID == "" || len(panoID) > 100 || !panoIDRegex.MatchString(panoID) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid pano id"})
		return
	}

	view, err := streetViewViewFromRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Invalid Street View parameters"})
		return
	}

	frame, err := h.servicesForMode(c).AIService.GetStreetViewFrame(c.Request.Context(), panoID, view)
	if err != nil {
		CaptureHandlerError(c, err, http.StatusBadGateway, map[string]interface{}{
			"operation": "get_streetview_frame",
			"pano_id":   panoID,
			"heading":   view.Heading,
			"pitch":     view.Pitch,
			"fov":       view.FOV,
		})
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "error": PublicErrorMessage(err)})
		return
	}

	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(http.StatusOK, frame.ContentType, frame.Data)
}

func streetViewViewFromRequest(c *gin.Context) (services.StreetViewView, error) {
	parse := func(name string, fallback, min, max int) (int, error) {
		raw := strings.TrimSpace(c.Query(name))
		if raw == "" {
			return fallback, nil
		}
		value, err := strconv.Atoi(raw)
		if err != nil || value < min || value > max {
			return 0, strconv.ErrRange
		}
		return value, nil
	}

	heading, err := parse("heading", 0, 0, 360)
	if err != nil {
		return services.StreetViewView{}, err
	}
	pitch, err := parse("pitch", 0, -90, 90)
	if err != nil {
		return services.StreetViewView{}, err
	}
	fov, err := parse("fov", 90, 10, 120)
	if err != nil {
		return services.StreetViewView{}, err
	}
	scenePanoID := strings.TrimSpace(c.Query("scene_pano_id"))
	if scenePanoID != "" && (len(scenePanoID) > 100 || !panoIDRegex.MatchString(scenePanoID)) {
		return services.StreetViewView{}, strconv.ErrSyntax
	}

	return services.StreetViewView{
		PanoID:  scenePanoID,
		Heading: heading,
		Pitch:   pitch,
		FOV:     fov,
	}, nil
}

// descriptionErrorStatus maps an AI description failure to an HTTP status.
// AppError.Error() only returns the user-facing message, so timeouts are
// detected on the wrapped cause. 504 is used instead of 408: the timeout is
// upstream, and browsers may silently retry a 408.
func descriptionErrorStatus(err error) int {
	if isUpstreamTimeout(err) {
		return http.StatusGatewayTimeout
	}
	return http.StatusInternalServerError
}

func isUpstreamTimeout(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	message := strings.ToLower(reportableErrorMessage(err))
	return strings.Contains(message, "timeout") || strings.Contains(message, "超时")
}
