package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/my-streetview-project/backend/internal/utils"
	"googlemaps.github.io/maps"
)

type MapsService struct {
	client          *maps.Client
	apiKey          string
	httpClient      *http.Client
	proxyConfigured bool
	mu              sync.RWMutex
	cacheMu         sync.Mutex
	locationCache   map[string]locationInfoCacheEntry
	frameCache      map[string]streetViewFrameCacheEntry
}

type locationInfoCacheEntry struct {
	info       map[string]string
	expiresAt  time.Time
	lastAccess time.Time
}

type streetViewFrameCacheEntry struct {
	frame      *StreetViewFrame
	expiresAt  time.Time
	lastAccess time.Time
}

func NewMapsService(apiKey string) (*MapsService, error) {
	logger := utils.MapsLogger()

	// 创建基础的Maps服务实例
	service := &MapsService{
		apiKey: apiKey,
	}

	// 配置HTTP客户端和代理
	httpClient, proxyConfigured := service.configureHTTPClient()
	service.httpClient = httpClient
	service.proxyConfigured = proxyConfigured

	// 如果配置了代理，记录一次日志
	if proxyConfigured {
		proxyURL := os.Getenv("MAPS_PROXY_URL")
		if proxyURL == "" {
			proxyURL = os.Getenv("PROXY_URL")
		}
		logger.Info("proxy_configured", "Maps service configured with proxy", map[string]interface{}{
			"proxy_url": proxyURL,
		})
	}

	// 创建Maps客户端选项
	var opts []maps.ClientOption
	opts = append(opts, maps.WithAPIKey(apiKey))

	if httpClient != nil {
		opts = append(opts, maps.WithHTTPClient(httpClient))
	}

	client, err := maps.NewClient(opts...)
	if err != nil {
		return nil, fmt.Errorf("创建 Google Maps 客户端失败: %w", err)
	}

	service.client = client
	return service, nil
}

// configureHTTPClient 配置HTTP客户端和代理设置
func (s *MapsService) configureHTTPClient() (*http.Client, bool) {
	// 从环境变量获取代理URL
	proxyURL := os.Getenv("MAPS_PROXY_URL")
	if proxyURL == "" {
		proxyURL = os.Getenv("PROXY_URL")
	}

	// 如果没有代理配置，返回默认客户端
	if proxyURL == "" {
		return &http.Client{Timeout: 15 * time.Second}, false
	}

	proxyType := os.Getenv("PROXY_TYPE")
	if proxyType == "" {
		proxyType = "http"
	}

	proxyUser := os.Getenv("PROXY_USER")
	proxyPass := os.Getenv("PROXY_PASS")

	// 创建代理URL
	proxy, err := url.Parse(proxyURL)
	if err != nil {
		utils.MapsLogger().Error("proxy_parse_failed", "Failed to parse proxy URL, using direct connection", err, map[string]interface{}{
			"proxy_url": proxyURL,
		})
		return &http.Client{Timeout: 15 * time.Second}, false
	}

	// 如果提供了用户名和密码，添加到代理URL
	if proxyUser != "" && proxyPass != "" {
		proxy.User = url.UserPassword(proxyUser, proxyPass)
	}

	// 创建带有代理的Transport
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyURL(proxy)

	httpClient := &http.Client{
		Transport: transport,
		Timeout:   15 * time.Second,
	}

	return httpClient, true
}

// getHTTPClient 获取配置好的HTTP客户端
func (s *MapsService) getHTTPClient() *http.Client {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.httpClient != nil {
		return s.httpClient
	}
	return &http.Client{Timeout: 15 * time.Second}
}

// HTTPClient returns the proxy-aware HTTP client for reuse by other components.
func (s *MapsService) HTTPClient() *http.Client {
	return s.getHTTPClient()
}

const (
	maxStreetViewFrameBytes = 8 << 20
	locationInfoCacheTTL    = time.Hour
	streetViewFrameCacheTTL = 10 * time.Minute
	maxLocationCacheEntries = 512
	maxFrameCacheEntries    = 128
)

func normalizeStreetViewView(view StreetViewView) StreetViewView {
	if view.Heading < 0 || view.Heading > 360 {
		view.Heading = 0
	}
	if view.Heading == 360 {
		view.Heading = 0
	}
	if view.Pitch < -90 || view.Pitch > 90 {
		view.Pitch = 0
	}
	if view.FOV < 10 || view.FOV > 120 {
		view.FOV = 90
	}
	return view
}

// GetStreetViewFrame returns one Google Street View Static API image using the
// same proxy-aware client as the rest of MapsService. The API key never leaves
// the backend.
func (s *MapsService) GetStreetViewFrame(ctx context.Context, panoID string, view StreetViewView) (*StreetViewFrame, error) {
	panoID = strings.TrimSpace(panoID)
	if panoID == "" || len(panoID) > 100 {
		return nil, fmt.Errorf("invalid pano id")
	}
	if strings.TrimSpace(s.apiKey) == "" {
		return nil, fmt.Errorf("street view image service is not configured")
	}

	view = normalizeStreetViewView(view)
	cacheKey := fmt.Sprintf("%s|%d|%d|%d", panoID, view.Heading, view.Pitch, view.FOV)
	if cached, ok := s.getCachedStreetViewFrame(cacheKey); ok {
		return cached, nil
	}
	query := url.Values{}
	query.Set("size", "640x480")
	query.Set("pano", panoID)
	query.Set("heading", fmt.Sprintf("%d", view.Heading))
	query.Set("pitch", fmt.Sprintf("%d", view.Pitch))
	query.Set("fov", fmt.Sprintf("%d", view.FOV))
	query.Set("key", s.apiKey)

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"https://maps.googleapis.com/maps/api/streetview?"+query.Encode(),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("build street view image request: %w", err)
	}

	resp, err := s.getHTTPClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch street view image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("street view image returned status %d", resp.StatusCode)
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || (mediaType != "image/jpeg" && mediaType != "image/png") {
		return nil, fmt.Errorf("street view image returned unsupported content type")
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxStreetViewFrameBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read street view image: %w", err)
	}
	if len(data) == 0 || len(data) > maxStreetViewFrameBytes {
		return nil, fmt.Errorf("street view image size is invalid")
	}

	frame := &StreetViewFrame{
		Data:        data,
		ContentType: mediaType,
		View:        view,
	}
	s.cacheStreetViewFrame(cacheKey, frame)
	return cloneStreetViewFrame(frame), nil
}

func (s *MapsService) FindRandomStreetView(ctx context.Context, latitude, longitude float64, maxRadiusMeters int) (bool, float64, float64, string) {
	if maxRadiusMeters < 100 || maxRadiusMeters > 50000 {
		return false, 0, 0, ""
	}
	return s.findStreetView(ctx, latitude, longitude, []int{maxRadiusMeters})
}

// FindNearbyStreetView 在有限半径内查找街景，不做全局兜底。
func (s *MapsService) FindNearbyStreetView(ctx context.Context, latitude, longitude float64) (bool, float64, float64, string) {
	searchRadii := []int{100, 500, 1000, 5000, 10000}
	return s.findStreetView(ctx, latitude, longitude, searchRadii)
}

// FindNearestStreetView 从近到远查找街景，尽量返回点击点附近最近的可用全景图。
func (s *MapsService) FindNearestStreetView(ctx context.Context, latitude, longitude float64) (bool, float64, float64, string) {
	searchRadii := []int{
		100,
		500,
		1000,
		5000,
		10000,
		50000,
		200000,
		1000000,
		5000000,
		20037500,
	}
	return s.findStreetView(ctx, latitude, longitude, searchRadii)
}

func (s *MapsService) findStreetView(ctx context.Context, latitude, longitude float64, searchRadii []int) (bool, float64, float64, string) {
	for _, radius := range searchRadii {
		streetViewURL := fmt.Sprintf(
			"https://maps.googleapis.com/maps/api/streetview/metadata"+
				"?location=%.6f,%.6f"+
				"&source=outdoor"+ // 只搜索户外街景
				"&radius=%d"+ // 搜索半径（单位：米）
				"&key=%s", // 添加 API Key
			latitude, longitude,
			radius,
			s.apiKey,
		)

		// 创建请求
		req, err := http.NewRequestWithContext(ctx, "GET", streetViewURL, nil)
		if err != nil {
			continue
		}

		// 使用预配置的HTTP客户端
		client := s.getHTTPClient()

		// 发送请求
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		// 读取完整的响应体
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			continue
		}

		// 解析响应
		var result struct {
			Status   string `json:"status"`
			Location struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"location"`
			Copyright string `json:"copyright"`
			Date      string `json:"date"`
			PanoId    string `json:"pano_id"`
		}
		if err := json.Unmarshal(body, &result); err != nil {
			continue
		}

		if result.Status == "OK" {
			return true, result.Location.Lat, result.Location.Lng, result.PanoId
		}
	}

	return false, 0, 0, ""
}

// GeocodeAddress 将地址/地名转为坐标
func (s *MapsService) GeocodeAddress(ctx context.Context, address string) (float64, float64, string, error) {
	req := &maps.GeocodingRequest{
		Address: address,
	}

	resp, err := s.client.Geocode(ctx, req)
	if err != nil {
		return 0, 0, "", fmt.Errorf("Geocoding 请求失败: %w", err)
	}

	if len(resp) == 0 {
		return 0, 0, "", fmt.Errorf("未找到地点: %s", address)
	}

	lat := resp[0].Geometry.Location.Lat
	lng := resp[0].Geometry.Location.Lng
	formattedAddr := resp[0].FormattedAddress

	return lat, lng, formattedAddr, nil
}

func (s *MapsService) SearchPlace(ctx context.Context, query string, language string) (*PlaceCandidate, error) {
	candidate, placeErr := s.findPlaceFromText(ctx, query, language)
	if placeErr == nil {
		return candidate, nil
	}

	candidate, textErr := s.textSearchPlace(ctx, query, language)
	if textErr == nil {
		return candidate, nil
	}

	lat, lng, formattedAddr, geocodeErr := s.GeocodeAddress(ctx, query)
	if geocodeErr == nil {
		return &PlaceCandidate{
			Name:             query,
			FormattedAddress: formattedAddr,
			Latitude:         lat,
			Longitude:        lng,
		}, nil
	}

	return nil, fmt.Errorf("未找到地点: %s", query)
}

func (s *MapsService) findPlaceFromText(ctx context.Context, query string, language string) (*PlaceCandidate, error) {
	req := &maps.FindPlaceFromTextRequest{
		Input:     query,
		InputType: maps.FindPlaceFromTextInputTypeTextQuery,
		Fields: []maps.PlaceSearchFieldMask{
			maps.PlaceSearchFieldMaskFormattedAddress,
			maps.PlaceSearchFieldMaskGeometry,
			maps.PlaceSearchFieldMaskName,
			maps.PlaceSearchFieldMaskPlaceID,
		},
		Language: language,
	}

	resp, err := s.client.FindPlaceFromText(ctx, req)
	if err != nil {
		return nil, err
	}
	if len(resp.Candidates) == 0 {
		return nil, fmt.Errorf("未找到地点: %s", query)
	}
	return placeSearchResultToCandidate(resp.Candidates[0]), nil
}

func (s *MapsService) textSearchPlace(ctx context.Context, query string, language string) (*PlaceCandidate, error) {
	req := &maps.TextSearchRequest{
		Query:    query,
		Language: language,
	}

	resp, err := s.client.TextSearch(ctx, req)
	if err != nil {
		return nil, err
	}
	if len(resp.Results) == 0 {
		return nil, fmt.Errorf("未找到地点: %s", query)
	}
	return placeSearchResultToCandidate(resp.Results[0]), nil
}

func placeSearchResultToCandidate(result maps.PlacesSearchResult) *PlaceCandidate {
	return &PlaceCandidate{
		Name:             result.Name,
		FormattedAddress: result.FormattedAddress,
		PlaceID:          result.PlaceID,
		Latitude:         result.Geometry.Location.Lat,
		Longitude:        result.Geometry.Location.Lng,
	}
}

func (s *MapsService) GetLocationInfo(ctx context.Context, latitude, longitude float64, language string) (map[string]string, error) {
	cacheKey := fmt.Sprintf("%.6f|%.6f|%s", latitude, longitude, strings.ToLower(strings.TrimSpace(language)))
	if cached, ok := s.getCachedLocationInfo(cacheKey); ok {
		return cached, nil
	}

	// 创建 Geocoding 请求
	req := &maps.GeocodingRequest{
		LatLng: &maps.LatLng{
			Lat: latitude,
			Lng: longitude,
		},
	}

	// Set language if provided, otherwise Google will use its default or infer
	if language != "" {
		req.Language = language
	}

	// 发送请求
	resp, err := s.client.ReverseGeocode(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("Geocoding API 请求失败: %w", err)
	}

	// 如果没有结果，返回错误
	if len(resp) == 0 {
		return nil, fmt.Errorf("未找到位置信息")
	}
	info := locationInfoFromGeocodingResults(resp)
	s.cacheLocationInfo(cacheKey, info)
	return cloneLocationInfo(info), nil
}

func (s *MapsService) getCachedLocationInfo(key string) (map[string]string, bool) {
	now := time.Now()
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	entry, ok := s.locationCache[key]
	if !ok {
		return nil, false
	}
	if now.After(entry.expiresAt) {
		delete(s.locationCache, key)
		return nil, false
	}
	entry.lastAccess = now
	s.locationCache[key] = entry
	return cloneLocationInfo(entry.info), true
}

func (s *MapsService) cacheLocationInfo(key string, info map[string]string) {
	now := time.Now()
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if s.locationCache == nil {
		s.locationCache = make(map[string]locationInfoCacheEntry)
	}
	evictOldestLocationCacheEntry(s.locationCache, now)
	s.locationCache[key] = locationInfoCacheEntry{
		info:       cloneLocationInfo(info),
		expiresAt:  now.Add(locationInfoCacheTTL),
		lastAccess: now,
	}
}

func (s *MapsService) getCachedStreetViewFrame(key string) (*StreetViewFrame, bool) {
	now := time.Now()
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	entry, ok := s.frameCache[key]
	if !ok {
		return nil, false
	}
	if now.After(entry.expiresAt) {
		delete(s.frameCache, key)
		return nil, false
	}
	entry.lastAccess = now
	s.frameCache[key] = entry
	return cloneStreetViewFrame(entry.frame), true
}

func (s *MapsService) cacheStreetViewFrame(key string, frame *StreetViewFrame) {
	now := time.Now()
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if s.frameCache == nil {
		s.frameCache = make(map[string]streetViewFrameCacheEntry)
	}
	evictOldestStreetViewFrameCacheEntry(s.frameCache, now)
	s.frameCache[key] = streetViewFrameCacheEntry{
		frame:      cloneStreetViewFrame(frame),
		expiresAt:  now.Add(streetViewFrameCacheTTL),
		lastAccess: now,
	}
}

func evictOldestLocationCacheEntry(cache map[string]locationInfoCacheEntry, now time.Time) {
	oldestKey := ""
	var oldest time.Time
	for key, entry := range cache {
		if now.After(entry.expiresAt) {
			delete(cache, key)
			continue
		}
		if oldestKey == "" || entry.lastAccess.Before(oldest) {
			oldestKey, oldest = key, entry.lastAccess
		}
	}
	if len(cache) >= maxLocationCacheEntries && oldestKey != "" {
		delete(cache, oldestKey)
	}
}

func evictOldestStreetViewFrameCacheEntry(cache map[string]streetViewFrameCacheEntry, now time.Time) {
	oldestKey := ""
	var oldest time.Time
	for key, entry := range cache {
		if now.After(entry.expiresAt) {
			delete(cache, key)
			continue
		}
		if oldestKey == "" || entry.lastAccess.Before(oldest) {
			oldestKey, oldest = key, entry.lastAccess
		}
	}
	if len(cache) >= maxFrameCacheEntries && oldestKey != "" {
		delete(cache, oldestKey)
	}
}

func cloneLocationInfo(info map[string]string) map[string]string {
	cloned := make(map[string]string, len(info))
	for key, value := range info {
		cloned[key] = value
	}
	return cloned
}

func cloneStreetViewFrame(frame *StreetViewFrame) *StreetViewFrame {
	if frame == nil {
		return nil
	}
	return &StreetViewFrame{
		Data:        append([]byte(nil), frame.Data...),
		ContentType: frame.ContentType,
		View:        frame.View,
	}
}

func locationInfoFromGeocodingResults(resp []maps.GeocodingResult) map[string]string {
	// Address components must belong to the SAME candidate as the address.
	// A Plus Code or a neighbouring locality must not contaminate a street result.
	result := make(map[string]string)
	selected := -1
	for index, candidate := range resp {
		setLocationInfoIfEmpty(result, "plus_code_global", candidate.PlusCode.GlobalCode)
		setLocationInfoIfEmpty(result, "plus_code_compound", candidate.PlusCode.CompoundCode)
		if selected < 0 && !geocodingResultHasType(candidate, "plus_code") && strings.TrimSpace(candidate.FormattedAddress) != "" {
			selected = index
		}
	}
	if selected < 0 && len(resp) > 0 {
		selected = 0
	}
	for index, geocodingResult := range resp {
		if index != selected {
			continue
		}
		if result["formatted_address"] == "" &&
			!geocodingResultHasType(geocodingResult, "plus_code") &&
			strings.TrimSpace(geocodingResult.FormattedAddress) != "" {
			result["formatted_address"] = geocodingResult.FormattedAddress
		}

		for _, component := range geocodingResult.AddressComponents {
			for _, t := range component.Types {
				switch t {
				case "street_number":
					setLocationInfoIfEmpty(result, "street_number", component.LongName)
				case "route":
					setLocationInfoIfEmpty(result, "route", component.LongName)
				case "intersection":
					setLocationInfoIfEmpty(result, "intersection", component.LongName)
				case "political":
					setLocationInfoIfEmpty(result, "political", component.LongName)
				case "country":
					setLocationInfoIfEmpty(result, "country", component.LongName)
					setLocationInfoIfEmpty(result, "country_code", component.ShortName)
				case "administrative_area_level_1":
					setLocationInfoIfEmpty(result, "administrative_area_level_1", component.LongName)
					setLocationInfoIfEmpty(result, "state_province", component.LongName)
					setLocationInfoIfEmpty(result, "state_province_code", component.ShortName)
				case "administrative_area_level_2":
					setLocationInfoIfEmpty(result, "administrative_area_level_2", component.LongName)
					setLocationInfoIfEmpty(result, "county_district", component.LongName)
				case "administrative_area_level_3":
					setLocationInfoIfEmpty(result, "administrative_area_level_3", component.LongName)
					setLocationInfoIfEmpty(result, "subdistrict", component.LongName)
				case "administrative_area_level_4":
					setLocationInfoIfEmpty(result, "neighborhood", component.LongName)
				case "administrative_area_level_5":
					setLocationInfoIfEmpty(result, "subneighborhood", component.LongName)
				case "locality":
					setLocationInfoIfEmpty(result, "locality", component.LongName)
					setLocationInfoIfEmpty(result, "city", component.LongName)
				case "sublocality":
					setLocationInfoIfEmpty(result, "sublocality", component.LongName)
				case "sublocality_level_1":
					setLocationInfoIfEmpty(result, "sublocality_level_1", component.LongName)
				case "sublocality_level_2":
					setLocationInfoIfEmpty(result, "sublocality_level_2", component.LongName)
				case "sublocality_level_3":
					setLocationInfoIfEmpty(result, "sublocality_level_3", component.LongName)
				case "colloquial_area":
					setLocationInfoIfEmpty(result, "colloquial_area", component.LongName)
				case "floor":
					setLocationInfoIfEmpty(result, "floor", component.LongName)
				case "room":
					setLocationInfoIfEmpty(result, "room", component.LongName)
				case "postal_code":
					setLocationInfoIfEmpty(result, "postal_code", component.LongName)
				case "postal_code_suffix":
					setLocationInfoIfEmpty(result, "postal_code_suffix", component.LongName)
				case "postal_town":
					setLocationInfoIfEmpty(result, "postal_town", component.LongName)
				case "premise":
					setLocationInfoIfEmpty(result, "premise", component.LongName)
				case "subpremise":
					setLocationInfoIfEmpty(result, "subpremise", component.LongName)
				case "plus_code":
					setLocationInfoIfEmpty(result, "plus_code", component.LongName)
				case "establishment":
					setLocationInfoIfEmpty(result, "establishment", component.LongName)
				case "point_of_interest":
					setLocationInfoIfEmpty(result, "point_of_interest", component.LongName)
				case "park":
					setLocationInfoIfEmpty(result, "park", component.LongName)
				case "natural_feature":
					setLocationInfoIfEmpty(result, "natural_feature", component.LongName)
				case "airport":
					setLocationInfoIfEmpty(result, "airport", component.LongName)
				case "university":
					setLocationInfoIfEmpty(result, "university", component.LongName)
				case "school":
					setLocationInfoIfEmpty(result, "school", component.LongName)
				case "hospital":
					setLocationInfoIfEmpty(result, "hospital", component.LongName)
				case "pharmacy":
					setLocationInfoIfEmpty(result, "pharmacy", component.LongName)
				case "church":
					setLocationInfoIfEmpty(result, "church", component.LongName)
				case "finance":
					setLocationInfoIfEmpty(result, "finance", component.LongName)
				case "post_box":
					setLocationInfoIfEmpty(result, "post_box", component.LongName)
				case "bus_station":
					setLocationInfoIfEmpty(result, "bus_station", component.LongName)
				case "train_station":
					setLocationInfoIfEmpty(result, "train_station", component.LongName)
				case "transit_station":
					setLocationInfoIfEmpty(result, "transit_station", component.LongName)
				}
			}
		}

		setLocationInfoIfEmpty(result, "plus_code_global", geocodingResult.PlusCode.GlobalCode)
		setLocationInfoIfEmpty(result, "plus_code_compound", geocodingResult.PlusCode.CompoundCode)
	}

	return result
}

func geocodingResultHasType(result maps.GeocodingResult, target string) bool {
	for _, resultType := range result.Types {
		if resultType == target {
			return true
		}
	}
	return false
}

func setLocationInfoIfEmpty(result map[string]string, key, value string) {
	if strings.TrimSpace(value) == "" || strings.TrimSpace(result[key]) != "" {
		return
	}
	result[key] = value
}
