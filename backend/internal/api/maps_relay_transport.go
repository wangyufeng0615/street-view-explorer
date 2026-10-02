package api

import (
	"context"
	"net/http"
	"strings"
	"time"
)

func isMapsRelayImage(req *http.Request) bool {
	host := req.URL.Hostname()
	return req.Method == http.MethodGet && (host == "streetviewpixels-pa.googleapis.com" ||
		strings.HasSuffix(host, ".googleusercontent.com") || strings.HasSuffix(host, ".ggpht.com") ||
		strings.HasPrefix(host, "cbks"))
}

// Rare imagery requests can stall for tens of seconds while adjacent tiles
// finish quickly. Race one extra GET after one second, cancel the losing
// request, and stream the winner. Never duplicate SDK initialization or RPCs.
// The caller owns cancel until the response body has finished streaming.
func requestMapsRelay(client *http.Client, req *http.Request) (*http.Response, context.CancelFunc, bool, error) {
	if !isMapsRelayImage(req) {
		res, err := client.Do(req)
		return res, func() {}, false, err
	}
	ctx, cancel := context.WithTimeout(req.Context(), 35*time.Second)
	type result struct {
		response *http.Response
		err      error
		index    int
	}
	results := make(chan result)
	cancels := make([]context.CancelFunc, 2)
	start := func(index int) {
		attempt, stop := context.WithCancel(ctx)
		cancels[index] = stop
		go func() {
			res, err := client.Do(req.Clone(attempt))
			select {
			case results <- result{res, err, index}:
			case <-attempt.Done():
				if res != nil {
					res.Body.Close()
				}
			}
		}()
	}
	start(0)
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	select {
	case first := <-results:
		return first.response, cancel, false, first.err
	case <-ctx.Done():
		return nil, cancel, false, ctx.Err()
	case <-timer.C:
	}
	start(1)
	var last result
	for remaining := 2; remaining > 0; remaining-- {
		select {
		case last = <-results:
			if last.err == nil && last.response.StatusCode >= 200 && last.response.StatusCode < 300 {
				cancels[1-last.index]()
				return last.response, cancel, true, nil
			}
			if remaining == 1 {
				return last.response, cancel, true, last.err
			}
			if last.response != nil {
				last.response.Body.Close()
			}
			cancels[last.index]()
		case <-ctx.Done():
			return nil, cancel, true, ctx.Err()
		}
	}
	return last.response, cancel, true, last.err
}
