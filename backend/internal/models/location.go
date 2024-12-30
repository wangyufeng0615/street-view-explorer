package models

type Location struct {
    LocationID string  `json:"location_id"`
    Latitude   float64 `json:"latitude"`
    Longitude  float64 `json:"longitude"`
    Likes      int     `json:"likes"`
    // Additional fields such as name, city, country can be added if needed
}
