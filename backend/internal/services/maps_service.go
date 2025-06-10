package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"

	"github.com/my-streetview-project/backend/internal/utils"
	"googlemaps.github.io/maps"
)

type MapsService struct {
	client *maps.Client
	apiKey string
}

func NewMapsService(apiKey string) (*MapsService, error) {
	// 从环境变量获取代理URL
	proxyURL := os.Getenv("MAPS_PROXY_URL")
	if proxyURL == "" {
		proxyURL = os.Getenv("PROXY_URL")
	}

	proxyType := os.Getenv("PROXY_TYPE")
	if proxyType == "" {
		proxyType = "http"
	}

	proxyUser := os.Getenv("PROXY_USER")
	proxyPass := os.Getenv("PROXY_PASS")

	var opts []maps.ClientOption
	opts = append(opts, maps.WithAPIKey(apiKey))

	// 如果设置了代理，配置HTTP客户端使用代理
	if proxyURL != "" {
		var transport *http.Transport

		// 根据代理类型创建不同的代理URL
		var proxyFunc func(*http.Request) (*url.URL, error)

		if proxyType == "socks5" {
			// 对于SOCKS5代理，我们需要使用golang.org/x/net/proxy包
			// 这里简化处理，仅构建代理URL
			proxyURLWithAuth := proxyURL
			if proxyUser != "" && proxyPass != "" {
				// 从URL中解析出协议、主机和端口
				parsedURL, err := url.Parse(proxyURL)
				if err == nil {
					// 重建带认证的URL
					parsedURL.User = url.UserPassword(proxyUser, proxyPass)
					proxyURLWithAuth = parsedURL.String()
				}
			}

			log.Printf("Maps服务使用SOCKS5代理: %s", proxyURLWithAuth)

			// 注意：这里需要额外的库支持SOCKS5
			// 简化起见，我们仍然使用http.ProxyURL，但实际使用时需要使用SOCKS5专用的库
			proxy, err := url.Parse(proxyURLWithAuth)
			if err != nil {
				log.Printf("解析代理URL失败: %v，将不使用代理", err)
				proxyFunc = nil
			} else {
				proxyFunc = http.ProxyURL(proxy)
			}
		} else {
			// 默认HTTP代理
			proxy, err := url.Parse(proxyURL)
			if err != nil {
				log.Printf("解析代理URL失败: %v，将不使用代理", err)
				proxyFunc = nil
			} else {
				// 如果提供了用户名和密码，添加到代理URL
				if proxyUser != "" && proxyPass != "" {
					proxy.User = url.UserPassword(proxyUser, proxyPass)
				}
				proxyFunc = http.ProxyURL(proxy)
				log.Printf("Maps服务使用HTTP代理: %s", proxy.String())
			}
		}

		// 创建带有代理的Transport
		if proxyFunc != nil {
			transport = &http.Transport{
				Proxy: proxyFunc,
			}
			httpClient := &http.Client{
				Transport: transport,
			}
			opts = append(opts, maps.WithHTTPClient(httpClient))
		}
	}

	client, err := maps.NewClient(opts...)
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

		// 创建HTTP客户端，如果有代理则使用代理
		client := &http.Client{}

		// 从环境变量获取代理URL
		proxyURLStr := os.Getenv("MAPS_PROXY_URL")
		if proxyURLStr == "" {
			proxyURLStr = os.Getenv("PROXY_URL")
		}

		if proxyURLStr != "" {
			proxyType := os.Getenv("PROXY_TYPE")
			if proxyType == "" {
				proxyType = "http"
			}

			proxyUser := os.Getenv("PROXY_USER")
			proxyPass := os.Getenv("PROXY_PASS")

			// 创建代理URL
			proxyURL, err := url.Parse(proxyURLStr)
			if err == nil {
				// 如果提供了用户名和密码，添加到代理URL
				if proxyUser != "" && proxyPass != "" {
					proxyURL.User = url.UserPassword(proxyUser, proxyPass)
				}

				transport := &http.Transport{
					Proxy: http.ProxyURL(proxyURL),
				}
				client.Transport = transport
			}
		}

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

	// 添加调试日志 - 记录从Google API获取的完整地理位置信息
	log.Printf("Google Maps API - 原始响应的第一个结果: FormattedAddress=%s, AddressComponents数量=%d", resp[0].FormattedAddress, len(resp[0].AddressComponents))
	log.Printf("Google Maps API - PlusCode: Global=%s, Compound=%s", resp[0].PlusCode.GlobalCode, resp[0].PlusCode.CompoundCode)
	log.Printf("Google Maps API - 提取的完整result: %+v", result)

	return result, nil
}
