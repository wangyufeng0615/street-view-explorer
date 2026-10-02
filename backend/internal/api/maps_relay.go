package api

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

//go:embed maps_relay_worker.js
var mapsRelayWorker string

// Exact Google resource hosts: this is not a general-purpose URL proxy.
var mapsRelayHosts = []string{
	"maps.googleapis.com", "mapsresources-pa.googleapis.com", "streetviewpixels-pa.googleapis.com",
	"maps.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", "csi.gstatic.com",
	"lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com", "lh6.googleusercontent.com",
	"lh3.ggpht.com", "lh4.ggpht.com", "lh5.ggpht.com", "lh6.ggpht.com", "geo0.ggpht.com", "geo1.ggpht.com", "geo2.ggpht.com", "geo3.ggpht.com",
	"cbks0.googleapis.com", "cbks1.googleapis.com", "cbks2.googleapis.com", "cbks3.googleapis.com",
	"cbks0.google.com", "cbks1.google.com", "cbks2.google.com", "cbks3.google.com",
	"khm0.googleapis.com", "khm1.googleapis.com", "khms0.googleapis.com", "khms1.googleapis.com", "khms2.googleapis.com", "khms3.googleapis.com",
	"khm0.google.com", "khm1.google.com", "khms0.google.com", "khms1.google.com", "khms2.google.com", "khms3.google.com",
	"mt0.google.com", "mt1.google.com", "mt2.google.com", "mt3.google.com",
	"www.google.com",
}

const mapsRelayResourceRoute = "/api/v1/maps-relay/resource/:host/*path"

// Reuse the existing Maps proxy configuration while keeping a separate,
// concurrent HTTP/2 pool for SDK modules and image tiles. No API key is added.
func SetupMapsRelayRoutes(r *gin.Engine, mapsClient *http.Client, options MapsRelayOptions) {
	client := *mapsClient
	transport := mapsClient.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	if base, ok := transport.(*http.Transport); ok {
		pool := base.Clone()
		pool.ForceAttemptHTTP2 = true
		pool.MaxIdleConns = 128
		pool.MaxIdleConnsPerHost = 32
		pool.IdleConnTimeout = 90 * time.Second
		pool.ResponseHeaderTimeout = 20 * time.Second
		client.Transport = pool
	}
	client.Timeout = 35 * time.Second
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	allowed := make(map[string]bool, len(mapsRelayHosts))
	// Pass-through traffic from ordinary tabs must also survive an upstream
	// hostname change. Relay-mode requests still use only same-origin fetches.
	connectSources := []string{"'self'", "https://*.googleapis.com", "https://*.gstatic.com", "https://*.googleusercontent.com", "https://*.ggpht.com", "https://*.google.com"}
	for _, host := range mapsRelayHosts {
		allowed[host] = true
		connectSources = append(connectSources, "https://"+host)
	}
	hostJSON, _ := json.Marshal(mapsRelayHosts)
	worker := strings.ReplaceAll(mapsRelayWorker, "__MAPS_RELAY_HOSTS__", string(hostJSON))
	worker = strings.ReplaceAll(worker, "__MAPS_RELAY_ENABLED__", fmt.Sprint(options.enabled()))
	r.GET("/api/v1/maps-relay/service-worker.js", func(c *gin.Context) {
		c.Header("Service-Worker-Allowed", "/")
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Security-Policy", "default-src 'none'; connect-src "+strings.Join(connectSources, " ")+";")
		c.Data(http.StatusOK, "text/javascript; charset=utf-8", []byte(worker))
	})
	r.POST(mapsRelaySessionRoute, options.session)
	// Bound active streams globally, including slow clients. Reject excess work
	// promptly instead of allowing an unbounded queue to delay every tile.
	slots := make(chan struct{}, 64)
	handler := func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		if !options.enabled() {
			c.Status(http.StatusNotFound)
			return
		}
		if !options.authorized(c) {
			c.Status(http.StatusUnauthorized)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			c.Header("Retry-After", "1")
			c.Status(http.StatusTooManyRequests)
			return
		}
		serveMapsRelay(c, &client, allowed)
	}
	r.GET(mapsRelayResourceRoute, handler)
	r.POST(mapsRelayResourceRoute, handler)
}

func allowedMapsRelayPath(host, path, method string) bool {
	if strings.ContainsAny(path, "\\\x00\r\n") {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "." || segment == ".." {
			return false
		}
	}
	if method == http.MethodPost && host != "maps.googleapis.com" && host != "mapsresources-pa.googleapis.com" {
		return false
	}
	if host != "maps.googleapis.com" {
		if host == "www.google.com" {
			return path == "/maps/vt" || strings.HasPrefix(path, "/maps/photometa/")
		}
		return true
	}
	// Exclude server APIs (Geocoding, Static Maps, etc.) from this SDK relay.
	return path == "/maps/api/js" || strings.HasPrefix(path, "/maps/api/js/") ||
		strings.HasPrefix(path, "/maps-api-v3/") || strings.HasPrefix(path, "/$rpc/google.internal.maps.") ||
		strings.HasPrefix(path, "/maps/api/mapsjs/") || path == "/maps/vt"
}

func serveMapsRelay(c *gin.Context, client *http.Client, allowed map[string]bool) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	// Prevent this resource endpoint from being used as a top-level HTML page.
	c.Header("Content-Security-Policy", "sandbox; default-src 'none'")
	host, path := c.Param("host"), c.Param("path")
	if c.GetHeader("X-Maps-Relay") != "1" || c.GetHeader("Sec-Fetch-Site") == "cross-site" ||
		!allowed[host] || !allowedMapsRelayPath(host, path, c.Request.Method) {
		c.String(http.StatusForbidden, "Maps relay request rejected")
		return
	}
	upstream := &url.URL{Scheme: "https", Host: host, Path: path, RawQuery: c.Request.URL.RawQuery}
	// Retain escaping used by RPC and image paths, without decoding it twice.
	prefix := "/api/v1/maps-relay/resource/" + host
	upstream.RawPath = strings.TrimPrefix(c.Request.URL.EscapedPath(), prefix)
	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, upstream.String(), http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20))
	if err != nil {
		c.String(http.StatusBadRequest, "Invalid Maps relay request")
		return
	}
	for name, values := range c.Request.Header {
		lower := strings.ToLower(name)
		if !strings.HasPrefix(lower, "x-goog-") && lower != "accept" && lower != "accept-encoding" &&
			lower != "accept-language" && lower != "content-type" && lower != "referer" && lower != "origin" &&
			lower != "user-agent" && lower != "x-user-agent" && lower != "x-client-data" &&
			lower != "if-none-match" && lower != "if-modified-since" {
			continue
		}
		// Community imagery rejects some application referrers. It needs no
		// browser origin; keyed SDK/auth requests retain the app's referrer.
		if (lower == "referer" || lower == "origin") && (strings.HasSuffix(host, ".googleusercontent.com") || strings.HasSuffix(host, ".ggpht.com")) {
			continue
		}
		for _, value := range values {
			req.Header.Add(name, value)
		}
	}
	started := time.Now()
	res, err := client.Do(req)
	if err != nil {
		// url.Error includes SDK credentials, sometimes nested inside pb=.
		// Do not log, attach to Gin errors, or return the original error.
		c.String(http.StatusBadGateway, "Maps relay upstream unavailable")
		return
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode < 400 && res.StatusCode != http.StatusNotModified {
		c.String(http.StatusBadGateway, "Maps relay upstream redirect rejected")
		return
	}
	if res.ContentLength > 16<<20 {
		c.String(http.StatusBadGateway, "Maps relay resource too large")
		return
	}
	for _, name := range []string{"Content-Type", "Content-Encoding", "Content-Length", "Vary"} {
		if value := res.Header.Get(name); value != "" {
			c.Header(name, value)
		}
	}
	if (res.StatusCode >= 200 && res.StatusCode < 300) || res.StatusCode == http.StatusNotModified {
		for _, name := range []string{"Cache-Control", "Expires", "Last-Modified", "ETag"} {
			if value := res.Header.Get(name); value != "" {
				c.Header(name, value)
			}
		}
	}
	c.Header("X-Maps-Relay", "1")
	// Browser caching is useful; a shared CDN cache must not bypass test access.
	c.Header("CDN-Cache-Control", "no-store")
	c.Header("Cloudflare-CDN-Cache-Control", "no-store")
	c.Header("Server-Timing", fmt.Sprintf("maps-relay;dur=%.1f", float64(time.Since(started).Microseconds())/1000))
	c.Status(res.StatusCode)
	// Stream the original compressed bytes. No decode/re-encode or server cache.
	_, _ = io.Copy(c.Writer, io.LimitReader(res.Body, 16<<20))
}
