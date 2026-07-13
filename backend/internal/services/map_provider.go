package services

import "context"

// MapProvider abstracts map service operations.
type MapProvider interface {
	// FindRandomStreetView performs one bounded lookup for speculative random
	// candidates. It never expands beyond maxRadiusMeters.
	FindRandomStreetView(ctx context.Context, latitude, longitude float64, maxRadiusMeters int) (bool, float64, float64, string)

	// FindNearbyStreetView searches for street view within a limited radius.
	// No global fallback - used for URL-based coordinate lookups.
	FindNearbyStreetView(ctx context.Context, latitude, longitude float64) (bool, float64, float64, string)

	// FindNearestStreetView searches progressively until it finds the closest
	// available street view panorama without falling back to a hard-coded place.
	FindNearestStreetView(ctx context.Context, latitude, longitude float64) (bool, float64, float64, string)

	// GetLocationInfo reverse-geocodes coordinates to location information.
	GetLocationInfo(ctx context.Context, latitude, longitude float64, language string) (map[string]string, error)

	// GeocodeAddress forward-geocodes an address to coordinates.
	GeocodeAddress(ctx context.Context, address string) (float64, float64, string, error)

	// SearchPlace resolves a spoken place or landmark query to a concrete map candidate.
	SearchPlace(ctx context.Context, query string, language string) (*PlaceCandidate, error)

	// GetStreetViewFrame fetches one concrete Street View frame for multimodal Atlas context.
	GetStreetViewFrame(ctx context.Context, panoID string, view StreetViewView) (*StreetViewFrame, error)
}

type StreetViewView struct {
	PanoID  string
	Heading int
	Pitch   int
	FOV     int
}

type StreetViewFrame struct {
	Data        []byte
	ContentType string
	View        StreetViewView
}

type PlaceCandidate struct {
	Name             string
	FormattedAddress string
	PlaceID          string
	Latitude         float64
	Longitude        float64
}
