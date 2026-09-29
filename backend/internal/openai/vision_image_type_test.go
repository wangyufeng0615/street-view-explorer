package openai

import (
	"encoding/base64"
	"testing"
)

func TestSniffImageContentType(t *testing.T) {
	jpeg := base64.StdEncoding.EncodeToString([]byte{0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 'J', 'F', 'I', 'F', 0, 1, 1, 0})
	png := base64.StdEncoding.EncodeToString([]byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n', 0, 0, 0, 0x0D})
	if got := sniffImageContentType(jpeg); got != "image/jpeg" {
		t.Fatalf("jpeg payload sniffed as %q", got)
	}
	if got := sniffImageContentType(png); got != "image/png" {
		t.Fatalf("png payload sniffed as %q", got)
	}
	if got := sniffImageContentType("!!"); got != "image/png" {
		t.Fatalf("garbage payload sniffed as %q, want png default", got)
	}
}
