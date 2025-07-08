package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sync"

	"github.com/my-streetview-project/backend/internal/utils"
	"googlemaps.github.io/maps"
)

type MapsService struct {
	client          *maps.Client
	apiKey          string
	httpClient      *http.Client
	proxyConfigured bool
	mu              sync.RWMutex
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
		return &http.Client{}, false
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
		return &http.Client{}, false
	}

	// 如果提供了用户名和密码，添加到代理URL
	if proxyUser != "" && proxyPass != "" {
		proxy.User = url.UserPassword(proxyUser, proxyPass)
	}

	// 创建带有代理的Transport
	transport := &http.Transport{
		Proxy: http.ProxyURL(proxy),
	}

	httpClient := &http.Client{
		Transport: transport,
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
	return &http.Client{}
}

// 检查坐标是否有街景可用，并返回街景坐标
// 使用兜底措施确保总是能找到可用的街景
func (s *MapsService) HasStreetView(ctx context.Context, latitude, longitude float64, hasInterest bool) (bool, float64, float64, string) {
	// 定义搜索半径序列，包含兜底措施
	var searchRadii []int
	if hasInterest {
		searchRadii = []int{100, 5000, 50000, 500000, 5000000} // 0.1km, 5km, 50km, 500km, 5000km
	} else {
		searchRadii = []int{10000, 50000, 200000, 1000000, 5000000} // 10km, 50km, 200km, 1000km, 5000km
	}

	// 逐步增加搜索半径，最后的大半径作为兜底
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
		defer resp.Body.Close()

		// 读取完整的响应体
		body, err := io.ReadAll(resp.Body)
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

	// 如果所有半径都失败了，尝试最后的兜底策略：去除坐标限制
	fallbackURL := fmt.Sprintf(
		"https://maps.googleapis.com/maps/api/streetview/metadata"+
			"?location=%.6f,%.6f"+
			"&source=outdoor"+
			"&key=%s", // 不设置半径限制
		latitude, longitude,
		s.apiKey,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", fallbackURL, nil)
	if err == nil {
		client := s.getHTTPClient()

		resp, err := client.Do(req)
		if err == nil {
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err == nil {
				var result struct {
					Status   string `json:"status"`
					Location struct {
						Lat float64 `json:"lat"`
						Lng float64 `json:"lng"`
					} `json:"location"`
					PanoId string `json:"pano_id"`
				}
				if json.Unmarshal(body, &result) == nil && result.Status == "OK" {
					return true, result.Location.Lat, result.Location.Lng, result.PanoId
				}
			}
		}
	}

	// 如果真的都失败了，记录严重错误但返回一个默认位置（这种情况极少发生）
	logger := utils.MapsLogger()
	logger.Error("streetview_complete_failure", "All street view searches failed, using default location", nil, map[string]interface{}{
		"coords": fmt.Sprintf("(%.6f,%.6f)", latitude, longitude),
	})
	// 返回纽约时代广场作为默认位置（有街景保证）
	return true, 40.758896, -73.985130, "default-location"
}

func (s *MapsService) GetLocationInfo(ctx context.Context, latitude, longitude float64, language string) (map[string]string, error) {
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

	// 提取位置信息
	result := make(map[string]string)
	result["formatted_address"] = resp[0].FormattedAddress

	// 提取详细的地址组件信息
	for _, component := range resp[0].AddressComponents {
		for _, t := range component.Types {
			switch t {
			case "street_number":
				result["street_number"] = component.LongName
			case "route":
				result["route"] = component.LongName
			case "intersection":
				result["intersection"] = component.LongName
			case "political":
				result["political"] = component.LongName
			case "country":
				result["country"] = component.LongName
				result["country_code"] = component.ShortName
			case "administrative_area_level_1":
				result["state_province"] = component.LongName
				result["state_province_code"] = component.ShortName
			case "administrative_area_level_2":
				result["county_district"] = component.LongName
			case "administrative_area_level_3":
				result["subdistrict"] = component.LongName
			case "administrative_area_level_4":
				result["neighborhood"] = component.LongName
			case "administrative_area_level_5":
				result["subneighborhood"] = component.LongName
			case "locality":
				result["city"] = component.LongName
			case "sublocality":
				result["sublocality"] = component.LongName
			case "sublocality_level_1":
				result["sublocality_level_1"] = component.LongName
			case "sublocality_level_2":
				result["sublocality_level_2"] = component.LongName
			case "sublocality_level_3":
				result["sublocality_level_3"] = component.LongName
			case "colloquial_area":
				result["colloquial_area"] = component.LongName
			case "floor":
				result["floor"] = component.LongName
			case "room":
				result["room"] = component.LongName
			case "postal_code":
				result["postal_code"] = component.LongName
			case "postal_code_suffix":
				result["postal_code_suffix"] = component.LongName
			case "postal_town":
				result["postal_town"] = component.LongName
			case "premise":
				result["premise"] = component.LongName
			case "subpremise":
				result["subpremise"] = component.LongName
			case "plus_code":
				result["plus_code"] = component.LongName
			case "establishment":
				result["establishment"] = component.LongName
			case "point_of_interest":
				result["point_of_interest"] = component.LongName
			case "park":
				result["park"] = component.LongName
			case "natural_feature":
				result["natural_feature"] = component.LongName
			case "airport":
				result["airport"] = component.LongName
			case "university":
				result["university"] = component.LongName
			case "school":
				result["school"] = component.LongName
			case "hospital":
				result["hospital"] = component.LongName
			case "pharmacy":
				result["pharmacy"] = component.LongName
			case "church":
				result["church"] = component.LongName
			case "finance":
				result["finance"] = component.LongName
			case "post_box":
				result["post_box"] = component.LongName
			case "bus_station":
				result["bus_station"] = component.LongName
			case "train_station":
				result["train_station"] = component.LongName
			case "transit_station":
				result["transit_station"] = component.LongName
			}
		}
	}

	// 如果有Plus Code信息，也提取出来
	if resp[0].PlusCode.GlobalCode != "" {
		result["plus_code_global"] = resp[0].PlusCode.GlobalCode
	}
	if resp[0].PlusCode.CompoundCode != "" {
		result["plus_code_compound"] = resp[0].PlusCode.CompoundCode
	}

	return result, nil
}
