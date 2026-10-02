package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Relay access is deliberately separate from the existing anonymous app session.
// A shared, revocable test invitation creates an eight-hour HttpOnly cookie.
type MapsRelayOptions struct {
	Enabled     bool
	AccessToken string
}

const mapsRelaySessionRoute = "/api/v1/maps-relay/session"
const mapsRelayCookie = "maps_relay_access"

func (o MapsRelayOptions) enabled() bool { return o.Enabled && len(o.AccessToken) >= 32 }

func (o MapsRelayOptions) signature(expiry string) string {
	mac := hmac.New(sha256.New, []byte(o.AccessToken))
	_, _ = mac.Write([]byte("maps-relay:" + expiry))
	return hex.EncodeToString(mac.Sum(nil))
}

func (o MapsRelayOptions) authorized(c *gin.Context) bool {
	cookie, err := c.Cookie(mapsRelayCookie)
	if err != nil || !o.enabled() {
		return false
	}
	expiry, signature, ok := strings.Cut(cookie, ".")
	seconds, err := strconv.ParseInt(expiry, 10, 64)
	return ok && err == nil && seconds > time.Now().Unix() &&
		seconds <= time.Now().Add(8*time.Hour).Unix() && hmac.Equal([]byte(signature), []byte(o.signature(expiry)))
}

func (o MapsRelayOptions) session(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !o.enabled() {
		c.Status(http.StatusNotFound)
		return
	}
	if c.GetHeader("Sec-Fetch-Site") == "cross-site" {
		c.Status(http.StatusForbidden)
		return
	}
	if !o.authorized(c) {
		if !hmac.Equal([]byte(c.GetHeader("X-Maps-Relay-Key")), []byte(o.AccessToken)) {
			c.Status(http.StatusUnauthorized)
			return
		}
		expiry := strconv.FormatInt(time.Now().Add(8*time.Hour).Unix(), 10)
		http.SetCookie(c.Writer, &http.Cookie{Name: mapsRelayCookie, Value: expiry + "." + o.signature(expiry),
			Path: "/api/v1/maps-relay/", MaxAge: 8 * 60 * 60, HttpOnly: true,
			Secure: !strings.HasPrefix(c.Request.Host, "localhost:") && !strings.HasPrefix(c.Request.Host, "127.0.0.1:") && !strings.HasPrefix(c.Request.Host, "[::1]:"), SameSite: http.SameSiteStrictMode})
	}
	c.Status(http.StatusNoContent)
}
