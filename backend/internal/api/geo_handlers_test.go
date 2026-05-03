package api

import (
	"errors"
	"strings"
	"testing"
)

func TestGeoHandlersRedactMapErrorHidesAPIKey(t *testing.T) {
	handler := &GeoHandlers{googleAPIKey: "secret-google-key"}
	err := errors.New(`Get "https://maps.googleapis.com/maps/api/staticmap?center=1,2&key=secret-google-key": context deadline exceeded`)

	got := handler.redactMapError(err)
	if strings.Contains(got, "secret-google-key") {
		t.Fatalf("redacted error still contains API key: %q", got)
	}
	if !strings.Contains(got, "[redacted]") {
		t.Fatalf("redacted error missing replacement marker: %q", got)
	}
}

func TestGeoSatelliteImageSizeFromValues(t *testing.T) {
	t.Run("defaults when omitted", func(t *testing.T) {
		width, height, err := geoSatelliteImageSizeFromValues("", "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if width != geoSatelliteImageDefaultWidth || height != geoSatelliteImageDefaultHeight {
			t.Fatalf("unexpected default size: %dx%d", width, height)
		}
	})

	t.Run("accepts bounded custom size", func(t *testing.T) {
		width, height, err := geoSatelliteImageSizeFromValues("640", "512")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if width != 640 || height != 512 {
			t.Fatalf("unexpected custom size: %dx%d", width, height)
		}
	})

	t.Run("rejects partial size", func(t *testing.T) {
		if _, _, err := geoSatelliteImageSizeFromValues("640", ""); err == nil {
			t.Fatal("expected partial size to fail")
		}
	})

	t.Run("rejects oversized values", func(t *testing.T) {
		if _, _, err := geoSatelliteImageSizeFromValues("641", "480"); err == nil {
			t.Fatal("expected oversized width to fail")
		}
	})
}
