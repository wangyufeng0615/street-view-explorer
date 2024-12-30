package utils

import "math"

// GridSize defines the grid spacing in degrees
const GridSize = 0.02

func ToGridLocation(lat, lng float64) (float64, float64) {
    gridLat := math.Floor(lat/GridSize) * GridSize
    gridLng := math.Floor(lng/GridSize) * GridSize
    return gridLat, gridLng
}
