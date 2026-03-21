package services

import "context"

// MapProvider abstracts map service operations (Google Maps, Baidu Maps, etc.)
type MapProvider interface {
	// HasStreetView checks if street view is available near given coordinates.
	// Returns the validated coordinates and pano ID if found.
	// Implementations should include fallback logic to maximize success rate.
	HasStreetView(ctx context.Context, latitude, longitude float64, hasInterest bool) (bool, float64, float64, string)

	// FindNearbyStreetView searches for street view within a limited radius.
	// No global fallback - used for URL-based coordinate lookups.
	FindNearbyStreetView(ctx context.Context, latitude, longitude float64) (bool, float64, float64, string)

	// GetLocationInfo reverse-geocodes coordinates to location information.
	GetLocationInfo(ctx context.Context, latitude, longitude float64, language string) (map[string]string, error)

	// GeocodeAddress forward-geocodes an address to coordinates.
	GeocodeAddress(ctx context.Context, address string) (float64, float64, string, error)
}
