package api

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type mapsRelayTransport func(*http.Request) (*http.Response, error)

func (f mapsRelayTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

var relayTestOptions = MapsRelayOptions{Enabled: true, AccessToken: strings.Repeat("test", 8)}

func mapsRelayTestRouter(transport mapsRelayTransport) *gin.Engine {
	r := gin.New()
	SetupMapsRelayRoutes(r, &http.Client{Transport: transport}, relayTestOptions)
	return r
}

func relayRequest(r *gin.Engine, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	expiry := strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10)
	req.AddCookie(&http.Cookie{Name: mapsRelayCookie, Value: expiry + "." + relayTestOptions.signature(expiry)})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestMapsRelayRejectsUntrustedRequestsBeforeUpstream(t *testing.T) {
	r := mapsRelayTestRouter(func(*http.Request) (*http.Response, error) {
		t.Fatal("rejected request reached upstream")
		return nil, nil
	})
	for _, tc := range []struct{ target, header, site string }{
		{"/api/v1/maps-relay/resource/maps.googleapis.com/maps/api/js", "", "same-origin"},
		{"/api/v1/maps-relay/resource/maps.googleapis.com/maps/api/js", "1", "cross-site"},
		{"/api/v1/maps-relay/resource/127.0.0.1/maps/api/js", "1", "same-origin"},
		{"/api/v1/maps-relay/resource/maps.googleapis.com.evil.test/maps/api/js", "1", "same-origin"},
		{"/api/v1/maps-relay/resource/maps.googleapis.com/maps/api/geocode/json", "1", "same-origin"},
		{"/api/v1/maps-relay/resource/maps.googleapis.com/maps/api/staticmap", "1", "same-origin"},
		{"/api/v1/maps-relay/resource/maps.googleapis.com/maps/api/js/../geocode/json", "1", "same-origin"},
	} {
		w := relayRequest(r, "GET", tc.target, "", map[string]string{"X-Maps-Relay": tc.header, "Sec-Fetch-Site": tc.site})
		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d for %s", w.Code, tc.target)
		}
	}
}

func TestMapsRelayPreservesRPCAndCompressedResourceWithoutAppCredentials(t *testing.T) {
	var compressed bytes.Buffer
	gz := gzip.NewWriter(&compressed)
	_, _ = gz.Write([]byte("original Google SDK bytes"))
	_ = gz.Close()
	payload := compressed.Bytes()
	r := mapsRelayTestRouter(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != "https://maps.googleapis.com/$rpc/google.internal.maps.test?pb=%21key%3Dnested" {
			t.Fatalf("changed URL: %s", req.URL.String())
		}
		body, _ := io.ReadAll(req.Body)
		if string(body) != "opaque RPC body" || req.Header.Get("Referer") != "https://app.test/" || req.Header.Get("Accept-Encoding") != "gzip" || req.Header.Get("X-Goog-Maps-Api-Signature") != "sdk-signature" || req.Header.Get("X-Goog-Maps-Api-Salt") != "sdk-salt" {
			t.Fatal("RPC body/referrer/compression was not retained")
		}
		for _, name := range []string{"Authorization", "Cookie", "X-Session-ID", "X-Maps-Relay"} {
			if req.Header.Get(name) != "" {
				t.Fatalf("leaked application header %s", name)
			}
		}
		return &http.Response{StatusCode: 200, Header: http.Header{
			"Content-Type": {"application/javascript"}, "Content-Encoding": {"gzip"},
			"Cache-Control": {"public, max-age=3600"}, "Set-Cookie": {"upstream-secret=1"},
		}, Body: io.NopCloser(bytes.NewReader(payload)), ContentLength: int64(len(payload))}, nil
	})
	w := relayRequest(r, "POST", "/api/v1/maps-relay/resource/maps.googleapis.com/$rpc/google.internal.maps.test?pb=%21key%3Dnested", "opaque RPC body", map[string]string{
		"X-Maps-Relay": "1", "Accept-Encoding": "gzip", "Referer": "https://app.test/",
		"Authorization": "Bearer secret", "Cookie": "session=secret", "X-Session-ID": "secret",
		"X-Goog-Maps-Api-Signature": "sdk-signature", "X-Goog-Maps-Api-Salt": "sdk-salt",
	})
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), payload) || w.Header().Get("Content-Encoding") != "gzip" || w.Header().Get("X-Maps-Relay") != "1" {
		t.Fatal("compressed bytes or forwarding marker changed")
	}
	if w.Header().Get("Cache-Control") != "public, max-age=3600" || w.Header().Get("Set-Cookie") != "" {
		t.Fatal("cache semantics or cookie isolation changed")
	}
}

func TestMapsRelayCommunityHeadersAndFailures(t *testing.T) {
	for _, status := range []int{200, 429, 302} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			r := mapsRelayTestRouter(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.Header.Get("Origin") != "" || req.Header.Get("Referer") != "" {
					t.Fatal("community image received app origin")
				}
				return &http.Response{StatusCode: status, Header: http.Header{"Location": {"http://127.0.0.1/private"}, "Cache-Control": {"public, max-age=3600"}}, Body: io.NopCloser(strings.NewReader("tile"))}, nil
			})
			w := relayRequest(r, "GET", "/api/v1/maps-relay/resource/lh3.googleusercontent.com/p/abc", "", map[string]string{"X-Maps-Relay": "1", "Referer": "https://app.test/", "Origin": "https://app.test"})
			want := status
			if status == 302 {
				want = 502
			}
			if w.Code != want || calls != 1 || w.Header().Get("Location") != "" {
				t.Fatal("redirect escaped relay or unexpected status")
			}
			if status != 200 && w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("failed resource can be cached")
			}
		})
	}
	r := mapsRelayTestRouter(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("secret key nested in upstream error")
	})
	w := relayRequest(r, "GET", "/api/v1/maps-relay/resource/maps.googleapis.com/maps/api/js", "", map[string]string{"X-Maps-Relay": "1"})
	if w.Code != 502 || strings.Contains(w.Body.String(), "secret key") {
		t.Fatal("upstream failure leaked credentials")
	}
}

func TestMapsRelayWorkerScopeAndRateBudget(t *testing.T) {
	r := mapsRelayTestRouter(nil)
	w := relayRequest(r, "GET", "/api/v1/maps-relay/service-worker.js", "", nil)
	if w.Code != 200 || w.Header().Get("Service-Worker-Allowed") != "/" || w.Header().Get("Cache-Control") != "no-store" || strings.Contains(w.Body.String(), "__MAPS_RELAY_HOSTS__") {
		t.Fatal("worker cannot control the homepage or is stale/unconfigured")
	}
	get := rateLimitRuleFor("GET", mapsRelayResourceRoute)
	post := rateLimitRuleFor("POST", mapsRelayResourceRoute)
	if get != post || get.maxRequests != 600 || !isCostSensitiveEndpoint(mapsRelayResourceRoute) {
		t.Fatal("relay methods do not share a fail-closed request budget")
	}
}

func TestMapsRelayRevalidatesBrowserCache(t *testing.T) {
	r := mapsRelayTestRouter(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get("If-None-Match") != "cached-sdk" {
			t.Fatal("browser cache validator was dropped")
		}
		return &http.Response{StatusCode: 304, Header: http.Header{"Cache-Control": {"public, max-age=3600"}, "Etag": {"cached-sdk"}}, Body: http.NoBody}, nil
	})
	w := relayRequest(r, "GET", "/api/v1/maps-relay/resource/maps.googleapis.com/maps-api-v3/api/js/common.js", "", map[string]string{"X-Maps-Relay": "1", "If-None-Match": "cached-sdk"})
	if w.Code != 304 || w.Header().Get("Cache-Control") != "public, max-age=3600" || w.Header().Get("X-Maps-Relay") != "1" {
		t.Fatal("cache revalidation was treated as a redirect/failure")
	}
}

func TestMapsRelayAccessAndDisable(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		options := relayTestOptions
		options.Enabled = enabled
		r := gin.New()
		SetupMapsRelayRoutes(r, &http.Client{Transport: mapsRelayTransport(func(*http.Request) (*http.Response, error) {
			t.Fatal("unauthorized request reached Google")
			return nil, nil
		})}, options)
		req := httptest.NewRequest("POST", mapsRelaySessionRoute, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		want := 401
		if !enabled {
			want = 404
		}
		if w.Code != want {
			t.Fatalf("missing invitation: got %d", w.Code)
		}
		req.Header.Set("X-Maps-Relay-Key", options.AccessToken)
		req.Host = "earth.wangyufeng.org"
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if !enabled {
			if w.Code != 404 {
				t.Fatal("disabled relay issued a session")
			}
			worker := relayRequest(r, "GET", "/api/v1/maps-relay/service-worker.js", "", nil)
			if !strings.Contains(worker.Body.String(), "const enabled = false") {
				t.Fatal("disabled worker was not retired")
			}
			continue
		}
		cookies := w.Result().Cookies()
		if w.Code != 204 || len(cookies) != 1 || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
			t.Fatal("unsafe test session")
		}
		req = httptest.NewRequest("POST", mapsRelaySessionRoute, nil)
		req.AddCookie(cookies[0])
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 204 {
			t.Fatal("session did not survive a refresh without invitation")
		}
		req = httptest.NewRequest("GET", "/api/v1/maps-relay/resource/maps.googleapis.com/maps/api/js", nil)
		req.Header.Set("X-Maps-Relay", "1")
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 401 {
			t.Fatal("marker was treated as authorization")
		}
		cookies[0].Value += "tampered"
		req.AddCookie(cookies[0])
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 401 {
			t.Fatal("invalid signature was accepted")
		}
	}
}
