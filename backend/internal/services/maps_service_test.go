package services

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"googlemaps.github.io/maps"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestLocationInfoUsesHumanAddressAfterPlusCodeResult(t *testing.T) {
	results := []maps.GeocodingResult{
		{
			FormattedAddress: "8G5Q7QGF+9X",
			Types:            []string{"plus_code"},
			PlusCode:         maps.AddressPlusCode{GlobalCode: "8G5Q7QGF+9X"},
			AddressComponents: []maps.AddressComponent{
				{LongName: "8G5Q7QGF+9X", Types: []string{"plus_code"}},
			},
		},
		{
			FormattedAddress: "15, Majdal Shams 1243800",
			Types:            []string{"premise", "street_address"},
			AddressComponents: []maps.AddressComponent{
				{LongName: "15", Types: []string{"premise"}},
				{LongName: "Majdal Shams", Types: []string{"locality", "political"}},
				{LongName: "1243800", Types: []string{"postal_code"}},
			},
		},
		{
			FormattedAddress: "Unnamed Road, Majdal Shams",
			Types:            []string{"route"},
			AddressComponents: []maps.AddressComponent{
				{LongName: "Unnamed Road", Types: []string{"route"}},
			},
		},
	}

	info := locationInfoFromGeocodingResults(results)
	if got := info["formatted_address"]; got != "15, Majdal Shams 1243800" {
		t.Fatalf("formatted_address = %q", got)
	}
	if got := info["city"]; got != "Majdal Shams" {
		t.Fatalf("city = %q", got)
	}
	if got := info["locality"]; got != "Majdal Shams" {
		t.Fatalf("locality = %q", got)
	}
	if got := info["plus_code_global"]; got != "8G5Q7QGF+9X" {
		t.Fatalf("plus_code_global = %q", got)
	}
}

func TestGetStreetViewFrameUsesNormalizedViewAndImageResponse(t *testing.T) {
	requests := 0
	service := &MapsService{
		apiKey: "test-key",
		httpClient: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				requests++
				query := req.URL.Query()
				if query.Get("pano") != "pano-123" || query.Get("heading") != "0" || query.Get("pitch") != "0" || query.Get("fov") != "90" {
					t.Fatalf("unexpected query: %s", req.URL.RawQuery)
				}
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(strings.NewReader("jpeg-data")),
					Header:     http.Header{"Content-Type": []string{"image/jpeg"}},
				}, nil
			}),
		},
	}

	frame, err := service.GetStreetViewFrame(
		context.Background(),
		"pano-123",
		StreetViewView{Heading: 999, Pitch: 999, FOV: 999},
	)
	if err != nil {
		t.Fatalf("GetStreetViewFrame() error = %v", err)
	}
	if string(frame.Data) != "jpeg-data" || frame.ContentType != "image/jpeg" {
		t.Fatalf("unexpected frame: %#v", frame)
	}

	frame.Data[0] = 'X'
	cachedFrame, err := service.GetStreetViewFrame(
		context.Background(),
		"pano-123",
		StreetViewView{Heading: 0, Pitch: 0, FOV: 90},
	)
	if err != nil {
		t.Fatalf("cached GetStreetViewFrame() error = %v", err)
	}
	if requests != 1 {
		t.Fatalf("street view HTTP requests = %d, want 1", requests)
	}
	if string(cachedFrame.Data) != "jpeg-data" {
		t.Fatalf("cached frame was mutated through caller: %q", cachedFrame.Data)
	}
}

func TestLocationInfoCacheReturnsClones(t *testing.T) {
	service := &MapsService{}
	original := map[string]string{"formatted_address": "Atlas Street", "city": "Lisbon"}
	service.cacheLocationInfo("key", original)
	original["city"] = "changed outside"

	first, ok := service.getCachedLocationInfo("key")
	if !ok {
		t.Fatal("getCachedLocationInfo() missed cached entry")
	}
	if first["city"] != "Lisbon" {
		t.Fatalf("cached city = %q", first["city"])
	}
	first["city"] = "changed by caller"

	second, ok := service.getCachedLocationInfo("key")
	if !ok || second["city"] != "Lisbon" {
		t.Fatalf("cache did not isolate caller mutation: %#v", second)
	}
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

func TestHasStreetViewDoesNotReturnSyntheticFallback(t *testing.T) {
	requests := 0
	service := &MapsService{
		apiKey: "test-key",
		httpClient: &http.Client{
			Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
				requests++
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(strings.NewReader(`{"status":"ZERO_RESULTS"}`)),
					Header:     make(http.Header),
				}, nil
			}),
		},
	}

	ok, lat, lng, panoID := service.HasStreetView(context.Background(), 1, 2, false)
	if ok || lat != 0 || lng != 0 || panoID != "" {
		t.Fatalf("HasStreetView() = (%t, %v, %v, %q), want a closed failure", ok, lat, lng, panoID)
	}
	if requests != 6 {
		t.Fatalf("requests = %d, want 6 real metadata attempts", requests)
	}
}
