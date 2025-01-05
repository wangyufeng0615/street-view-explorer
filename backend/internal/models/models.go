package models

import "time"

// ExplorationPreference 表示用户的探索偏好
type ExplorationPreference struct {
	Interest   string    `json:"interest"`
	Regions    []Region  `json:"regions"`
	CreatedAt  time.Time `json:"created_at"`
	LastUsedAt time.Time `json:"last_used_at"`
}

// Region 表示一个地理区域
type Region struct {
	Coordinates struct {
		North float64 `json:"north"`
		South float64 `json:"south"`
		East  float64 `json:"east"`
		West  float64 `json:"west"`
	} `json:"coordinates"`
	RegionInfo string `json:"region_info"`
}
