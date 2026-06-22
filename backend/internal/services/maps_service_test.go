package services

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestFindNearestStreetViewExpandsBeyondNearbyRadius(t *testing.T) {
	var requestedRadii []int
	service := &MapsService{
		apiKey: "test-key",
		httpClient: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				radius, err := strconv.Atoi(req.URL.Query().Get("radius"))
				if err != nil {
					t.Fatalf("radius query missing or invalid: %v", err)
				}
				requestedRadii = append(requestedRadii, radius)

				body := `{"status":"ZERO_RESULTS"}`
				if radius == 1000000 {
					body = `{"status":"OK","location":{"lat":11.1,"lng":22.2},"pano_id":"nearest-pano"}`
				}

				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(strings.NewReader(body)),
					Header:     make(http.Header),
				}, nil
			}),
		},
	}

	ok, lat, lng, panoID := service.FindNearestStreetView(context.Background(), 1, 2)
	if !ok {
		t.Fatal("FindNearestStreetView() ok = false, want true")
	}
	if lat != 11.1 || lng != 22.2 || panoID != "nearest-pano" {
		t.Fatalf("FindNearestStreetView() = (%v, %v, %q), want (11.1, 22.2, nearest-pano)", lat, lng, panoID)
	}

	lastRadius := requestedRadii[len(requestedRadii)-1]
	if lastRadius != 1000000 {
		t.Fatalf("last requested radius = %d, want 1000000", lastRadius)
	}
}
