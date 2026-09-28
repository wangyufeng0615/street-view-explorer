package services

import "math"

func geoBattleHaversineDistance(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKM = 6371
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	// Rounding can push a just past 1 near antipodal points, which makes
	// Sqrt(1-a) NaN.
	a = math.Min(1, math.Max(0, a))
	return earthRadiusKM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func geoBattleCalculateScore(zoomSteps int, distanceKM float64) int {
	if math.IsNaN(distanceKM) || math.IsInf(distanceKM, 0) {
		return 0
	}
	steps := max(0, zoomSteps)
	zoomFactor := math.Exp(-float64(steps) * 0.12)
	effectiveDistanceKM := math.Max(0, distanceKM-geoBattleGuessToleranceKM(steps))
	distanceFactor := math.Exp(-effectiveDistanceKM / 1500)
	return int(math.Round(5000 * zoomFactor * distanceFactor))
}

func geoBattleGuessToleranceKM(zoomSteps int) float64 {
	zoomSteps = max(0, zoomSteps)
	tolerance := geoBattlePerfectDistanceKM * math.Pow(geoBattleToleranceGrowth, float64(zoomSteps))
	return math.Min(geoBattleMaxToleranceKM, tolerance)
}
