package models

import "time"

type Location struct {
	// 基础坐标信息
	Latitude  float64 `json:"latitude"`  // 实际街景纬度
	Longitude float64 `json:"longitude"` // 实际街景经度

	// Street View 元数据
	PanoID string `json:"pano_id"` // 街景全景图ID

	// 地理位置信息
	FormattedAddress string `json:"formatted_address"`      // 格式化地址
	Country          string `json:"country"`                // 国家
	CountryCode      string `json:"country_code,omitempty"` // ISO 3166-1 alpha-2
	City             string `json:"city"`                   // 城市

	// Random selection diagnostics. These fields are populated for random
	// exploration and persisted with visit history for distribution audits.
	SelectionStrategy string  `json:"selection_strategy,omitempty"`
	TargetCountryCode string  `json:"target_country_code,omitempty"`
	OriginLatitude    float64 `json:"origin_latitude,omitempty"`
	OriginLongitude   float64 `json:"origin_longitude,omitempty"`
	SnapDistanceKm    float64 `json:"snap_distance_km,omitempty"`
	SearchRadiusM     int     `json:"search_radius_m,omitempty"`
	SelectionAttempt  int     `json:"selection_attempt,omitempty"`

	// 元数据
	CreatedAt time.Time `json:"created_at"` // 创建时间
	IsMock    bool      `json:"is_mock"`    // 是否为 mock 数据
}
