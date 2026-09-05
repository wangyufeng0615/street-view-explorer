package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealthCommandRequiresHealthyJSON(t *testing.T) {
	for _, tc := range []struct {
		body string
		code int
		ok   bool
	}{
		{`{"status":"ok"}`, 200, true}, {`{"status":"unhealthy"}`, 503, false}, {`<html>SPA</html>`, 200, false},
	} {
		t.Run(tc.body, func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.code); _, _ = w.Write([]byte(tc.body)) }))
			defer s.Close()
			t.Setenv("SERVER_ADDRESS", strings.TrimPrefix(s.URL, "http://"))
			if err := checkHealth(); (err == nil) != tc.ok {
				t.Fatalf("error=%v", err)
			}
			s.Close()
			if checkHealth() == nil {
				t.Fatal("unreachable server reported healthy")
			}
		})
	}
}
