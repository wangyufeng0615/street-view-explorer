package api

import (
	"github.com/gin-gonic/gin"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUnknownLengthBodyStillHasReadLimit(t *testing.T) {
	r := gin.New()
	r.Use(InputValidationMiddleware())
	r.POST("/", func(c *gin.Context) {
		if _, err := io.ReadAll(c.Request.Body); err != nil {
			c.Status(413)
			return
		}
		c.Status(200)
	})
	req := httptest.NewRequest("POST", "/", strings.NewReader(strings.Repeat("x", 1024*1024+1)))
	req.ContentLength = -1
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 413 {
		t.Fatalf("unknown-length request got %d", w.Code)
	}
}
