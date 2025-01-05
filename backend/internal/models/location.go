package models

import "time"

type Location struct {
	// 基础坐标信息
	OriginalLatitude  float64 `json:"original_latitude"`  // 原始随机生成的纬度
	OriginalLongitude float64 `json:"original_longitude"` // 原始随机生成的经度
	Latitude          float64 `json:"latitude"`           // 实际街景纬度
	Longitude         float64 `json:"longitude"`          // 实际街景经度
	DistanceKm        float64 `json:"distance_km"`        // 原始坐标到街景坐标的距离

	// Street View 元数据
	PanoID string `json:"pano_id"` // 街景全景图ID
	Date   string `json:"date"`    // 街景拍摄日期

	// 地理位置信息
	FormattedAddress string `json:"formatted_address"` // 格式化地址
	Country          string `json:"country"`           // 国家
	City             string `json:"city"`              // 城市
	Street           string `json:"street"`            // 街道
	PostalCode       string `json:"postal_code"`       // 邮编

	// AI 生成的内容
	AIDescription        string    `json:"ai_description"`        // AI 生成的描述
	DescriptionLanguage  string    `json:"description_language"`  // 描述语言
	DescriptionGenerated time.Time `json:"description_generated"` // 描述生成时间

	// 元数据
	CreatedAt      time.Time `json:"created_at"`       // 创建时间
	LastAccessedAt time.Time `json:"last_accessed_at"` // 最后访问时间
	AccessCount    int       `json:"access_count"`     // 访问次数
	IsMock         bool      `json:"is_mock"`          // 是否为 mock 数据
	Likes          int       `json:"likes"`            // 点赞数
}
