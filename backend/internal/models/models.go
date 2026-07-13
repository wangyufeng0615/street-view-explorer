package models

import (
	"time"
)

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

const (
	VisitSourceRandom  = "random"
	VisitSourceLookup  = "lookup"
	VisitSourceShared  = "shared"
	VisitSourceMapPick = "map_pick"
)

// VisitRecord 访问记录
type VisitRecord struct {
	ID                int64     `json:"id"`
	SessionID         string    `json:"session_id,omitempty"`
	PanoID            string    `json:"pano_id"`
	Latitude          float64   `json:"latitude"`
	Longitude         float64   `json:"longitude"`
	Country           string    `json:"country"`
	CountryCode       string    `json:"country_code,omitempty"`
	City              string    `json:"city"`
	FormattedAddress  string    `json:"formatted_address"`
	Source            string    `json:"source"`
	SelectionStrategy string    `json:"selection_strategy,omitempty"`
	TargetCountryCode string    `json:"target_country_code,omitempty"`
	OriginLatitude    float64   `json:"origin_latitude,omitempty"`
	OriginLongitude   float64   `json:"origin_longitude,omitempty"`
	SnapDistanceKm    float64   `json:"snap_distance_km,omitempty"`
	SearchRadiusM     int       `json:"search_radius_m,omitempty"`
	SelectionAttempt  int       `json:"selection_attempt,omitempty"`
	VisitedAt         time.Time `json:"visited_at"`
}

// PaginatedResult 分页结果通用结构
type PaginatedResult[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
}

// ==================== Agent Journey ====================

const (
	JourneyStatusPending    = "pending"
	JourneyStatusInProgress = "in_progress"
	JourneyStatusCompleted  = "completed"
)

// AgentJourney 代表一次 AI 探索旅程
type AgentJourney struct {
	ID         string    `json:"id"`
	Token      string    `json:"token,omitempty"`
	StartLat   float64   `json:"start_lat"`
	StartLng   float64   `json:"start_lng"`
	TotalStops int       `json:"total_stops"`
	Status     string    `json:"status"`
	Letter     string    `json:"letter,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// AgentJourneyStop 旅程中的一站
type AgentJourneyStop struct {
	ID            int64     `json:"id"`
	JourneyID     string    `json:"journey_id"`
	StopNumber    int       `json:"stop_number"`
	Lat           float64   `json:"lat"`
	Lng           float64   `json:"lng"`
	PanoID        string    `json:"pano_id,omitempty"`
	PhotoHeading  int       `json:"photo_heading"`
	LocationInfo  string    `json:"location_info,omitempty"`
	AIDescription string    `json:"ai_description,omitempty"`
	JournalEntry  string    `json:"journal_entry,omitempty"`
	NextReasoning string    `json:"next_reasoning,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}
