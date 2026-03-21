package utils

import "math"

const (
	xPi   = math.Pi * 3000.0 / 180.0
	a     = 6378245.0
	ee    = 0.00669342162296594323
)

// WGS84ToBD09 converts WGS84 coordinates to BD09 (Baidu) coordinates.
func WGS84ToBD09(wgsLat, wgsLng float64) (bdLat, bdLng float64) {
	gcjLat, gcjLng := wgs84ToGCJ02(wgsLat, wgsLng)
	return gcj02ToBD09(gcjLat, gcjLng)
}

// BD09ToWGS84 converts BD09 (Baidu) coordinates to WGS84 coordinates.
func BD09ToWGS84(bdLat, bdLng float64) (wgsLat, wgsLng float64) {
	gcjLat, gcjLng := bd09ToGCJ02(bdLat, bdLng)
	return gcj02ToWGS84(gcjLat, gcjLng)
}

func wgs84ToGCJ02(wgsLat, wgsLng float64) (gcjLat, gcjLng float64) {
	if isOutOfChina(wgsLat, wgsLng) {
		return wgsLat, wgsLng
	}
	dLat := transformLat(wgsLng-105.0, wgsLat-35.0)
	dLng := transformLng(wgsLng-105.0, wgsLat-35.0)
	radLat := wgsLat / 180.0 * math.Pi
	magic := math.Sin(radLat)
	magic = 1 - ee*magic*magic
	sqrtMagic := math.Sqrt(magic)
	dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * math.Pi)
	dLng = (dLng * 180.0) / (a / sqrtMagic * math.Cos(radLat) * math.Pi)
	return wgsLat + dLat, wgsLng + dLng
}

func gcj02ToWGS84(gcjLat, gcjLng float64) (wgsLat, wgsLng float64) {
	if isOutOfChina(gcjLat, gcjLng) {
		return gcjLat, gcjLng
	}
	dLat := transformLat(gcjLng-105.0, gcjLat-35.0)
	dLng := transformLng(gcjLng-105.0, gcjLat-35.0)
	radLat := gcjLat / 180.0 * math.Pi
	magic := math.Sin(radLat)
	magic = 1 - ee*magic*magic
	sqrtMagic := math.Sqrt(magic)
	dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * math.Pi)
	dLng = (dLng * 180.0) / (a / sqrtMagic * math.Cos(radLat) * math.Pi)
	return gcjLat*2 - (gcjLat + dLat), gcjLng*2 - (gcjLng + dLng)
}

func gcj02ToBD09(gcjLat, gcjLng float64) (bdLat, bdLng float64) {
	z := math.Sqrt(gcjLng*gcjLng+gcjLat*gcjLat) + 0.00002*math.Sin(gcjLat*xPi)
	theta := math.Atan2(gcjLat, gcjLng) + 0.000003*math.Cos(gcjLng*xPi)
	return z*math.Sin(theta) + 0.006, z*math.Cos(theta) + 0.0065
}

func bd09ToGCJ02(bdLat, bdLng float64) (gcjLat, gcjLng float64) {
	x := bdLng - 0.0065
	y := bdLat - 0.006
	z := math.Sqrt(x*x+y*y) - 0.00002*math.Sin(y*xPi)
	theta := math.Atan2(y, x) - 0.000003*math.Cos(x*xPi)
	return z * math.Sin(theta), z * math.Cos(theta)
}

func transformLat(x, y float64) float64 {
	ret := -100.0 + 2.0*x + 3.0*y + 0.2*y*y + 0.1*x*y + 0.2*math.Sqrt(math.Abs(x))
	ret += (20.0*math.Sin(6.0*x*math.Pi) + 20.0*math.Sin(2.0*x*math.Pi)) * 2.0 / 3.0
	ret += (20.0*math.Sin(y*math.Pi) + 40.0*math.Sin(y/3.0*math.Pi)) * 2.0 / 3.0
	ret += (160.0*math.Sin(y/12.0*math.Pi) + 320*math.Sin(y*math.Pi/30.0)) * 2.0 / 3.0
	return ret
}

func transformLng(x, y float64) float64 {
	ret := 300.0 + x + 2.0*y + 0.1*x*x + 0.1*x*y + 0.1*math.Sqrt(math.Abs(x))
	ret += (20.0*math.Sin(6.0*x*math.Pi) + 20.0*math.Sin(2.0*x*math.Pi)) * 2.0 / 3.0
	ret += (20.0*math.Sin(x*math.Pi) + 40.0*math.Sin(x/3.0*math.Pi)) * 2.0 / 3.0
	ret += (150.0*math.Sin(x/12.0*math.Pi) + 300.0*math.Sin(x/30.0*math.Pi)) * 2.0 / 3.0
	return ret
}

func isOutOfChina(lat, lng float64) bool {
	return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}
