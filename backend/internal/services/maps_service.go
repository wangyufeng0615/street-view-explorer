package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/my-streetview-project/backend/internal/utils"
	"googlemaps.github.io/maps"
)

type MapsService struct {
	client *maps.Client
	apiKey string
}

func NewMapsService(apiKey string) (*MapsService, error) {
	client, err := maps.NewClient(maps.WithAPIKey(apiKey))
	if err != nil {
		return nil, fmt.Errorf("创建 Google Maps 客户端失败: %w", err)
	}
	return &MapsService{
		client: client,
		apiKey: apiKey,
	}, nil
}

// 检查坐标是否有街景可用，并返回街景坐标
func (s *MapsService) HasStreetView(ctx context.Context, latitude, longitude float64, hasInterest bool) (bool, float64, float64, string) {
	// 定义搜索半径（单位：米）
	searchRadii := []int{5000000} // 默认值，用于兼容性
	if hasInterest {
		searchRadii = []int{100, 10000, 1000000} // 0.1km, 10km, 1000km
	} else {
		searchRadii = []int{100000, 1000000, 5000000} // 100km, 1000km, 5000km
	}

	// 逐步增加搜索半径
	for _, radius := range searchRadii {
		url := fmt.Sprintf(
			"https://maps.googleapis.com/maps/api/streetview/metadata"+
				"?location=%.6f,%.6f"+
				"&source=outdoor"+ // 只搜索户外街景
				"&radius=%d"+ // 搜索半径（单位：米）
				"&key=%s", // 添加 API Key
			latitude, longitude,
			radius,
			s.apiKey,
		)

		// 发送 HTTP GET 请求
		resp, err := http.Get(url)
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

	return false, 0, 0, ""
}

// 生成有效的随机坐标（确保有街景可用）
func (s *MapsService) GenerateValidLocation(ctx context.Context) (latitude, longitude float64, panoId string, err error) {
	randomLat, randomLng := utils.GenerateRandomCoordinate()

	if hasStreetView, streetViewLat, streetViewLng, panoId := s.HasStreetView(ctx, randomLat, randomLng, false); hasStreetView {
		return streetViewLat, streetViewLng, panoId, nil
	}

	return 0, 0, "", fmt.Errorf("该位置没有可用的街景")
}

func (s *MapsService) GetLocationInfo(ctx context.Context, latitude, longitude float64) (map[string]string, error) {
	// 创建 Geocoding 请求
	req := &maps.GeocodingRequest{
		LatLng: &maps.LatLng{
			Lat: latitude,
			Lng: longitude,
		},
		Language: "zh-CN", // 使用中文
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

	// 提取更详细的信息
	for _, component := range resp[0].AddressComponents {
		for _, t := range component.Types {
			switch t {
			case "country":
				result["country"] = component.LongName
			case "locality":
				result["city"] = component.LongName
			}
		}
	}

	return result, nil
}
