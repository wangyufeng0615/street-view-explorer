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
