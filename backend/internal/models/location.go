package models

import "time"

type Location struct {
	// 基础坐标信息
	Latitude  float64 `json:"latitude"`  // 实际街景纬度
	Longitude float64 `json:"longitude"` // 实际街景经度

	// Street View 元数据
	PanoID string `json:"pano_id"` // 街景全景图ID

	// 地理位置信息
	FormattedAddress string `json:"formatted_address"` // 格式化地址
	Country          string `json:"country"`           // 国家
	City             string `json:"city"`              // 城市

	// AI 描述结果
	AIDescriptionEN   string     `json:"ai_description_en,omitempty"`    // 英文描述
	AIDescriptionZH   string     `json:"ai_description_zh,omitempty"`    // 中文描述
	AIDescriptionENAt *time.Time `json:"ai_description_en_at,omitempty"` // 英文描述生成时间
	AIDescriptionZHAt *time.Time `json:"ai_description_zh_at,omitempty"` // 中文描述生成时间

	// 元数据
	CreatedAt time.Time `json:"created_at"` // 创建时间
	IsMock    bool      `json:"is_mock"`    // 是否为 mock 数据
}
