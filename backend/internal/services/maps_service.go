package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
		// 构建 Street View API URL，让 API 自动寻找最近的街景点
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

		log.Printf("正在检查坐标 (%.6f, %.6f) 的街景可用性，搜索半径: %d米", latitude, longitude, radius)

		// 发送 HTTP GET 请求
		resp, err := http.Get(url)
		if err != nil {
			log.Printf("Street View API check failed for (%.6f, %.6f): %v", latitude, longitude, err)
			continue
		}
		defer resp.Body.Close()

		// 读取完整的响应体
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("Failed to read Street View API response body: %v", err)
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
			log.Printf("Failed to decode Street View API response: %v", err)
			continue
		}

		if result.Status == "OK" {
			// 计算找到的街景点与请求坐标的距离
			distance := utils.CalculateDistance(
				latitude, longitude,
				result.Location.Lat, result.Location.Lng,
			)
			log.Printf("找到街景: 距离=%.2f km, pano_id=%s, 搜索半径=%d米", distance, result.PanoId, radius)
			return true, result.Location.Lat, result.Location.Lng, result.PanoId
		}

		log.Printf("在半径 %d 米内未找到街景", radius)
	}

	log.Printf("所有搜索半径都未找到街景")
	return false, 0, 0, ""
}

// 生成有效的随机坐标（确保有街景可用）
func (s *MapsService) GenerateValidLocation(ctx context.Context) (latitude, longitude float64, panoId string, err error) {
	randomLat, randomLng := utils.GenerateRandomCoordinate()
	log.Printf("生成随机坐标: (%.6f, %.6f)", randomLat, randomLng)

	if hasStreetView, streetViewLat, streetViewLng, panoId := s.HasStreetView(ctx, randomLat, randomLng, false); hasStreetView {
		return streetViewLat, streetViewLng, panoId, nil
	}

	return 0, 0, "", fmt.Errorf("该位置没有可用的街景")
}

func (s *MapsService) GetLocationInfo(ctx context.Context, latitude, longitude float64) (map[string]string, error) {
	log.Printf("正在获取位置信息 (%.6f, %.6f)", latitude, longitude)

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

	// 打印原始响应数据
	log.Printf("Google Geocoding API 原始响应数据:")
	for i, result := range resp {
		log.Printf("结果 #%d:", i+1)
		log.Printf("  完整地址: %s", result.FormattedAddress)
		log.Printf("  地点类型: %v", result.Types)
		log.Printf("  地址组件:")
		for _, component := range result.AddressComponents {
			log.Printf("    - %s (类型: %v)", component.LongName, component.Types)
		}
		log.Printf("  几何信息: 纬度=%.6f, 经度=%.6f", 
			result.Geometry.Location.Lat, 
			result.Geometry.Location.Lng)
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

	log.Printf("成功获取位置信息: %s", result["formatted_address"])
	return result, nil
}
