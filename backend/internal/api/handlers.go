package api

import (
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/services"
	"github.com/my-streetview-project/backend/internal/utils"
)

var (
	markdownLinkLineRegex = regexp.MustCompile(`^\[([^\]]+)\]\((.+)\)$`)
	trailingSpacesRegex   = regexp.MustCompile(`[ \t]+\n`)
	excessiveNewlines     = regexp.MustCompile(`\n{3,}`)
)

const maxVisitHistoryLimit = 5000

// sanitizeDescription 移除模型偶发输出在结尾的 markdown 链接行，保留正文。
func sanitizeDescription(text string) string {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	end := len(lines)

	for end > 0 {
		line := strings.TrimSpace(lines[end-1])
		if line == "" {
			end--
			continue
		}

		candidate := line
		if strings.HasPrefix(candidate, "(") && strings.HasSuffix(candidate, ")") {
			candidate = strings.TrimSpace(candidate[1 : len(candidate)-1])
		}

		if !markdownLinkLineRegex.MatchString(candidate) {
			break
		}
		end--
	}

	cleaned := strings.TrimSpace(strings.Join(lines[:end], "\n"))
	cleaned = trailingSpacesRegex.ReplaceAllString(cleaned, "\n")
	cleaned = excessiveNewlines.ReplaceAllString(cleaned, "\n\n")
	return cleaned
}

// ModeServices groups the location and AI services.
type ModeServices struct {
	LocationService *services.LocationService
	AIService       *services.AIService
}

type Handlers struct {
	global *ModeServices
}

func NewHandlers(
	locationService *services.LocationService,
	aiService *services.AIService,
) *Handlers {
	return &Handlers{
		global: &ModeServices{
			LocationService: locationService,
			AIService:       aiService,
		},
	}
}

// GlobalServices returns the global mode services (used by AgentHandlers).
func (h *Handlers) GlobalServices() *ModeServices {
	return h.global
}

// servicesForMode returns the services for the current request.
func (h *Handlers) servicesForMode(c *gin.Context) *ModeServices {
	return h.global
}

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
	loc, err := svc.LocationService.GetRandomLocation(sessionID, language, countryCode)
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

	// Skip visit recording for geo game rounds (source=geo_game)
	source := c.DefaultQuery("source", "")
	if source != "geo_game" {
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

	svc := h.servicesForMode(c)

	loc, err := svc.LocationService.GetLocation(panoID)
	if err != nil {
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

	startTime := time.Now()
	logger := utils.APILogger()

	desc, citations, err := svc.AIService.GetDescriptionForLocation(*loc, language)
	if err != nil {
		duration := time.Since(startTime)
		statusCode := http.StatusInternalServerError

		if strings.Contains(err.Error(), "超时") || strings.Contains(err.Error(), "timeout") {
			statusCode = http.StatusRequestTimeout
		}

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
			"description": cleanDesc,
			"citations":   citations,
			"language":    language,
			"duration":    time.Since(startTime).String(),
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

	svc := h.servicesForMode(c)

	loc, err := svc.LocationService.GetLocation(panoID)
	if err != nil {
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

	startTime := time.Now()
	logger := utils.APILogger()

	desc, citations, err := svc.AIService.GetDetailedDescriptionForLocation(*loc, language)
	if err != nil {
		duration := time.Since(startTime)
		statusCode := http.StatusInternalServerError
		errorMsg := err.Error()

		if strings.Contains(errorMsg, "超时") || strings.Contains(errorMsg, "timeout") {
			statusCode = http.StatusRequestTimeout
		} else if strings.Contains(errorMsg, "没有找到基础对话历史") {
			statusCode = http.StatusBadRequest
		}

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
			"description": cleanDesc,
			"citations":   citations,
			"language":    language,
			"duration":    time.Since(startTime).String(),
		},
	})
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
	loc, err := svc.LocationService.LookupLocation(lat, lng, language)
	if err != nil {
		CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
			"operation": "lookup_location",
			"latitude":  lat,
			"longitude": lng,
			"language":  language,
		})
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   PublicErrorMessage(err),
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
	loc, place, err := svc.LocationService.SearchLocation(query, language)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   err.Error(),
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

func parseCoordinate(raw string, min, max float64) (float64, error) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, strconv.ErrSyntax
	}
	if value < min || value > max {
		return 0, strconv.ErrRange
	}
	return value, nil
}

// SetExplorationPreference 设置探索偏好
func (h *Handlers) SetExplorationPreference(c *gin.Context) {
	sessionID := h.getSessionID(c)
	if sessionID == "" {
		return
	}

	var req struct {
		Interest string `json:"interest" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求参数",
		})
		return
	}

	// 获取语言参数，默认为英文
	language := c.DefaultQuery("lang", "en")

	svc := h.servicesForMode(c)

	// 设置探索偏好
	if err := svc.LocationService.SetExplorationPreference(sessionID, req.Interest); err != nil {
		// 所有错误都返回 200 状态码，由前端处理
		if err.Error() == "无法理解该探索兴趣" {
			errorMsg := "抱歉，我们无法理解您输入的探索兴趣。建议您尝试更具体的主题，例如：日本传统建筑、欧洲古堡、热带海滩、美国国家公园等。"

			// 根据语言提供对应的错误消息
			if language == "en" {
				errorMsg = "Sorry, we couldn't understand your exploration interest. Please try more specific topics, such as: traditional Japanese architecture, European castles, tropical beaches, US national parks, etc."
			}

			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"error":   errorMsg,
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	// 根据语言设置成功消息
	successMsg := "探索偏好设置成功"
	if language == "en" {
		successMsg = "Exploration preference set successfully"
	}

	// 获取剩余速率限制信息（可选）
	response := gin.H{
		"success": true,
		"message": successMsg,
	}

	// 如果有速率限制信息，添加到响应中
	if userRemaining, exists := c.Get("userRateLimitRemaining"); exists {
		response["rate_limit"] = gin.H{
			"user_remaining": userRemaining,
		}
		if globalRemaining, exists := c.Get("globalRateLimitRemaining"); exists {
			response["rate_limit"].(gin.H)["global_remaining"] = globalRemaining
		}
	}

	c.JSON(http.StatusOK, response)
}

// DeleteExplorationPreference 删除探索偏好
func (h *Handlers) DeleteExplorationPreference(c *gin.Context) {
	sessionID := h.getSessionID(c)
	if sessionID == "" {
		return
	}

	// 获取语言参数，默认为英文
	language := c.DefaultQuery("lang", "en")

	svc := h.servicesForMode(c)

	// 删除探索偏好
	if err := svc.LocationService.DeleteExplorationPreference(sessionID); err != nil {
		errorMsg := "删除探索偏好失败"
		if language == "en" {
			errorMsg = "Failed to delete exploration preference"
		}
		CaptureHandlerError(c, err, http.StatusInternalServerError, map[string]interface{}{
			"operation": "delete_exploration_preference",
			"language":  language,
		})

		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   errorMsg,
			"detail":  PublicErrorMessage(err),
		})
		return
	}

	// 根据语言设置成功消息
	successMsg := "探索偏好已成功删除"
	if language == "en" {
		successMsg = "Exploration preference successfully deleted"
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": successMsg,
	})
}

// GetVisitHistory 获取全站共享访问历史
func (h *Handlers) GetVisitHistory(c *gin.Context) {
	limit := parseIntParam(c, "limit", 1000)
	offset := parseIntParam(c, "offset", 0)
	if limit > maxVisitHistoryLimit {
		limit = maxVisitHistoryLimit
	}

	svc := h.servicesForMode(c)

	visits, totalVisits, uniquePlaces, err := svc.LocationService.GetGlobalVisitHistory(limit, offset)
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

// ==================== 辅助方法 ====================

// getSessionID 从上下文获取 sessionID，如果失败则返回空字符串并设置错误响应
func (h *Handlers) getSessionID(c *gin.Context) string {
	sessionIDInterface, exists := c.Get("sessionID")
	if !exists {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "无法获取会话ID",
		})
		return ""
	}
	sessionID, ok := sessionIDInterface.(string)
	if !ok || sessionID == "" {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "无效的会话ID格式",
		})
		return ""
	}
	return sessionID
}

func (h *Handlers) getOptionalSessionID(c *gin.Context) string {
	sessionIDInterface, exists := c.Get("sessionID")
	if !exists {
		return ""
	}
	sessionID, ok := sessionIDInterface.(string)
	if !ok {
		return ""
	}
	return sessionID
}

func normalizeVisitSource(source string) string {
	switch strings.TrimSpace(source) {
	case models.VisitSourceShared:
		return models.VisitSourceShared
	default:
		return models.VisitSourceLookup
	}
}

// parseIntParam 解析整数参数，失败则返回默认值
func parseIntParam(c *gin.Context, key string, defaultValue int) int {
	value := c.DefaultQuery(key, "")
	if value == "" {
		return defaultValue
	}
	result, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return defaultValue
	}
	minValue := 1
	if defaultValue == 0 {
		minValue = 0
	}
	if result < minValue {
		return defaultValue
	}
	return result
}
