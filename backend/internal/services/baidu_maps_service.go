package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/my-streetview-project/backend/internal/utils"
)

// BaiduMapsService implements MapProvider using Baidu Maps APIs.
type BaiduMapsService struct {
	ak         string
	httpClient *http.Client
}

// NewBaiduMapsService creates a new Baidu Maps service.
func NewBaiduMapsService(ak string) (*BaiduMapsService, error) {
	if ak == "" {
		return nil, fmt.Errorf("Baidu Map AK is required")
	}
	return &BaiduMapsService{
		ak:         ak,
		httpClient: &http.Client{},
	}, nil
}

func (s *BaiduMapsService) HasStreetView(ctx context.Context, latitude, longitude float64, hasInterest bool) (bool, float64, float64, string) {
	logger := utils.MapsLogger()

	// Try exact location (API uses coordtype=wgs84ll, no manual conversion needed)
	if s.checkBaiduPanorama(ctx, latitude, longitude) {
		panoId := fmt.Sprintf("bd_%.6f_%.6f", latitude, longitude)
		return true, latitude, longitude, panoId
	}

	// Try expanding offsets in WGS84: ~1km, ~5km, ~20km, ~50km
	degreeOffsets := []float64{0.01, 0.05, 0.2, 0.5}
	directions := [][2]float64{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}

	for _, offset := range degreeOffsets {
		for _, dir := range directions {
			testLat := latitude + offset*dir[0]
			testLng := longitude + offset*dir[1]
			if s.checkBaiduPanorama(ctx, testLat, testLng) {
				panoId := fmt.Sprintf("bd_%.6f_%.6f", testLat, testLng)
				return true, testLat, testLng, panoId
			}
		}
	}

	// Fallback: Tiananmen Square
	logger.Error("baidu_streetview_fallback", "All Baidu panorama searches failed, using default location", nil, map[string]interface{}{
		"original_lat": latitude,
		"original_lng": longitude,
	})
	return true, 39.908722, 116.397499, "bd-default-location"
}

func (s *BaiduMapsService) FindNearbyStreetView(ctx context.Context, latitude, longitude float64) (bool, float64, float64, string) {
	// Try exact location
	if s.checkBaiduPanorama(ctx, latitude, longitude) {
		panoId := fmt.Sprintf("bd_%.6f_%.6f", latitude, longitude)
		return true, latitude, longitude, panoId
	}

	// Try small offsets only: ~1km, ~5km
	for _, offset := range []float64{0.01, 0.05} {
		for _, dir := range [][2]float64{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			testLat := latitude + offset*dir[0]
			testLng := longitude + offset*dir[1]
			if s.checkBaiduPanorama(ctx, testLat, testLng) {
				panoId := fmt.Sprintf("bd_%.6f_%.6f", testLat, testLng)
				return true, testLat, testLng, panoId
			}
		}
	}

	return false, 0, 0, ""
}

// checkBaiduPanorama checks if a Baidu panorama exists near given WGS84 coordinates.
// Uses coordtype=wgs84ll so no manual coordinate conversion is needed.
func (s *BaiduMapsService) checkBaiduPanorama(ctx context.Context, lat, lng float64) bool {
	// Baidu panorama API: location=lng,lat (longitude first!)
	apiURL := fmt.Sprintf(
		"https://api.map.baidu.com/panorama/v2?ak=%s&location=%.6f,%.6f&coordtype=wgs84ll&width=64&height=64",
		s.ak, lng, lat,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return false
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	// Discard body to free connection
	io.Copy(io.Discard, resp.Body)

	// If response is an image, panorama exists
	contentType := resp.Header.Get("Content-Type")
	return resp.StatusCode == http.StatusOK && strings.HasPrefix(contentType, "image/")
}

func (s *BaiduMapsService) GetLocationInfo(ctx context.Context, latitude, longitude float64, language string) (map[string]string, error) {
	// Baidu reverse geocoding: location=lat,lng (latitude first!), coordtype=wgs84ll
	apiURL := fmt.Sprintf(
		"https://api.map.baidu.com/reverse_geocoding/v3/?ak=%s&output=json&coordtype=wgs84ll&location=%.6f,%.6f&extensions_poi=1",
		s.ak, latitude, longitude,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("创建百度逆地理编码请求失败: %w", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("百度逆地理编码请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取百度逆地理编码响应失败: %w", err)
	}

	var baiduResp struct {
		Status  int    `json:"status"`
		Message string `json:"message"`
		Result  struct {
			FormattedAddress string `json:"formatted_address"`
			AddressComponent struct {
				Country      string `json:"country"`
				Province     string `json:"province"`
				City         string `json:"city"`
				District     string `json:"district"`
				Town         string `json:"town"`
				Street       string `json:"street"`
				StreetNumber string `json:"street_number"`
				Adcode       string `json:"adcode"`
			} `json:"addressComponent"`
			Pois []struct {
				Name string `json:"name"`
				Tag  string `json:"tag"`
			} `json:"pois"`
		} `json:"result"`
	}

	if err := json.Unmarshal(body, &baiduResp); err != nil {
		return nil, fmt.Errorf("解析百度逆地理编码响应失败: %w", err)
	}

	if baiduResp.Status != 0 {
		return nil, fmt.Errorf("百度逆地理编码失败, status: %d, message: %s", baiduResp.Status, baiduResp.Message)
	}

	result := make(map[string]string)
	ac := baiduResp.Result.AddressComponent
	result["formatted_address"] = baiduResp.Result.FormattedAddress
	result["country"] = ac.Country
	result["state_province"] = ac.Province
	result["city"] = ac.City
	result["county_district"] = ac.District
	result["subdistrict"] = ac.Town
	result["route"] = ac.Street
	result["street_number"] = ac.StreetNumber
	result["postal_code"] = ac.Adcode

	// Extract first POI if available
	if len(baiduResp.Result.Pois) > 0 {
		result["point_of_interest"] = baiduResp.Result.Pois[0].Name
	}

	return result, nil
}

func (s *BaiduMapsService) GeocodeAddress(ctx context.Context, address string) (float64, float64, string, error) {
	apiURL := fmt.Sprintf(
		"https://api.map.baidu.com/geocoding/v3/?ak=%s&output=json&address=%s&ret_coordtype=wgs84ll",
		s.ak, address,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return 0, 0, "", fmt.Errorf("创建百度地理编码请求失败: %w", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return 0, 0, "", fmt.Errorf("百度地理编码请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, 0, "", fmt.Errorf("读取百度地理编码响应失败: %w", err)
	}

	var baiduResp struct {
		Status int `json:"status"`
		Result struct {
			Location struct {
				Lng float64 `json:"lng"`
				Lat float64 `json:"lat"`
			} `json:"location"`
		} `json:"result"`
	}

	if err := json.Unmarshal(body, &baiduResp); err != nil {
		return 0, 0, "", fmt.Errorf("解析百度地理编码响应失败: %w", err)
	}

	if baiduResp.Status != 0 {
		return 0, 0, "", fmt.Errorf("百度地理编码失败, status: %d", baiduResp.Status)
	}

	lat := baiduResp.Result.Location.Lat
	lng := baiduResp.Result.Location.Lng

	return lat, lng, address, nil
}
