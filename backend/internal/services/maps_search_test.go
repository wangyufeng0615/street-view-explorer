package services

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"googlemaps.github.io/maps"
)

func searchPlaceWithStatus(t *testing.T, status string) error {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body := `{"status":"` + status + `","candidates":[],"results":[]}`
		if status == "OVER_QUERY_LIMIT" {
			body = `{"status":"OVER_QUERY_LIMIT","error_message":"quota","candidates":[],"results":[]}`
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	client, err := maps.NewClient(maps.WithAPIKey("test-key"), maps.WithBaseURL(server.URL))
	if err != nil {
		t.Fatal(err)
	}
	_, err = (&MapsService{client: client}).SearchPlace(context.Background(), "nowhere", "en")
	return err
}

func TestSearchPlaceReportsNotFoundOnlyWhenEveryLookupIsEmpty(t *testing.T) {
	err := searchPlaceWithStatus(t, "ZERO_RESULTS")
	if !errors.Is(err, errPlaceNotFound) || !strings.Contains(err.Error(), "未找到地点") {
		t.Fatalf("empty lookups: err = %v, want not found", err)
	}

	err = searchPlaceWithStatus(t, "OVER_QUERY_LIMIT")
	if err == nil || errors.Is(err, errPlaceNotFound) || strings.Contains(err.Error(), "未找到地点") {
		t.Fatalf("quota failure: err = %v, want upstream error", err)
	}
}
