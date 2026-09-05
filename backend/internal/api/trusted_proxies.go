package api

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// No proxy is trusted by default. Deployments must specify their actual hop CIDRs.
func ConfigureTrustedProxies(r *gin.Engine, configured string) error {
	var proxies []string
	for _, value := range strings.Split(configured, ",") {
		if value = strings.TrimSpace(value); value != "" {
			proxies = append(proxies, value)
		}
	}
	r.RemoteIPHeaders = []string{"X-Forwarded-For"}
	return r.SetTrustedProxies(proxies)
}
