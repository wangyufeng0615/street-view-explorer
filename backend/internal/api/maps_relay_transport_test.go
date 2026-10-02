package api

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMapsRelayHedgesOnlySlowImageGETAndCancelsLoser(t *testing.T) {
	var calls atomic.Int32
	cancelled := make(chan struct{})
	client := &http.Client{Transport: mapsRelayTransport(func(r *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			<-r.Context().Done()
			close(cancelled)
			return nil, r.Context().Err()
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("tile"))}, nil
	})}
	req, _ := http.NewRequest("GET", "https://lh3.googleusercontent.com/p/image", nil)
	res, cancel, hedged, err := requestMapsRelay(client, req)
	defer cancel()
	if err != nil || !hedged || calls.Load() != 2 {
		t.Fatalf("expected one successful hedge, calls=%d err=%v", calls.Load(), err)
	}
	defer res.Body.Close()
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("losing upstream request was not cancelled")
	}
	body, err := io.ReadAll(res.Body)
	if err != nil || string(body) != "tile" {
		t.Fatal("winner was cancelled before streaming")
	}
	for _, target := range []string{"https://maps.googleapis.com/maps/api/js", "https://maps.googleapis.com/$rpc/google.internal.maps.test"} {
		r, _ := http.NewRequest("GET", target, nil)
		if isMapsRelayImage(r) {
			t.Fatal("SDK/RPC requests must never be duplicated")
		}
	}
	req.Method = "POST"
	if isMapsRelayImage(req) {
		t.Fatal("POST was eligible for replay")
	}
}

func TestMapsRelayFastImageAndCancellationDoNotStartExtraRequests(t *testing.T) {
	var calls atomic.Int32
	client := &http.Client{Transport: mapsRelayTransport(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{StatusCode: 200, Body: http.NoBody}, nil
	})}
	req, _ := http.NewRequest("GET", "https://streetviewpixels-pa.googleapis.com/v1/tile", nil)
	res, cancel, hedged, err := requestMapsRelay(client, req)
	defer cancel()
	if err != nil || hedged || calls.Load() != 1 {
		t.Fatal("fast image triggered extra work")
	}
	res.Body.Close()
	ctx, stop := context.WithCancel(context.Background())
	stop()
	client.Transport = mapsRelayTransport(func(r *http.Request) (*http.Response, error) {
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	_, cancelAborted, _, err := requestMapsRelay(client, req.WithContext(ctx))
	defer cancelAborted()
	if err == nil {
		t.Fatal("disconnected browser request continued")
	}
}
