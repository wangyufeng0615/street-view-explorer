package utils

import (
	"testing"
)

func TestRedactProxyURL(t *testing.T) {
	cases := map[string]string{
		"http://user:secret@127.0.0.1:10086": "http://127.0.0.1:10086",
		"socks5://user@proxy.example:1080":   "socks5://proxy.example:1080",
		"http://127.0.0.1:10086":             "http://127.0.0.1:10086",
		"http://user:secret@bad host:1":      "<redacted>@bad host:1",
	}
	for input, want := range cases {
		if got := RedactProxyURL(input); got != want {
			t.Fatalf("RedactProxyURL(%q) = %q, want %q", input, got, want)
		}
	}
}
