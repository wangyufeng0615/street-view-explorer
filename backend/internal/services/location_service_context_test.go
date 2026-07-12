package services

import (
	"context"
	"errors"
	"testing"
)

type canceledMapProvider struct{}

func (canceledMapProvider) HasStreetView(ctx context.Context, _, _ float64, _ bool) (bool, float64, float64, string) {
	<-ctx.Done()
	return false, 0, 0, ""
}
func (canceledMapProvider) FindNearbyStreetView(ctx context.Context, _, _ float64) (bool, float64, float64, string) {
	<-ctx.Done()
	return false, 0, 0, ""
}
func (canceledMapProvider) FindNearestStreetView(ctx context.Context, _, _ float64) (bool, float64, float64, string) {
	<-ctx.Done()
	return false, 0, 0, ""
}
func (canceledMapProvider) GetLocationInfo(context.Context, float64, float64, string) (map[string]string, error) {
	return nil, nil
}
func (canceledMapProvider) GeocodeAddress(context.Context, string) (float64, float64, string, error) {
	return 0, 0, "", nil
}
func (canceledMapProvider) SearchPlace(ctx context.Context, _, _ string) (*PlaceCandidate, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}
func (canceledMapProvider) GetStreetViewFrame(context.Context, string, StreetViewView) (*StreetViewFrame, error) {
	return nil, nil
}

func TestLookupLocationWithContextReturnsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	service := NewLocationService(nil, nil, canceledMapProvider{})

	_, err := service.LookupLocationWithContext(ctx, 1, 2, "en")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("LookupLocationWithContext() error = %v, want context.Canceled", err)
	}
}

func TestRandomLocationWithContextReturnsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	service := NewLocationService(nil, nil, canceledMapProvider{})

	_, err := service.GetRandomLocationWithContext(ctx, "", "en")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("GetRandomLocationWithContext() error = %v, want context.Canceled", err)
	}
}
