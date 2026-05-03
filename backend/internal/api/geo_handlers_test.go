package api

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

func TestGeoHandlersRedactMapErrorHidesAPIKey(t *testing.T) {
	handler := &GeoHandlers{googleAPIKey: "secret-google-key"}
	err := errors.New(`Get "https://maps.googleapis.com/maps/api/staticmap?center=1,2&key=secret-google-key": context deadline exceeded`)

	got := handler.redactMapError(err)
	if strings.Contains(got, "secret-google-key") {
		t.Fatalf("redacted error still contains API key: %q", got)
	}
	if !strings.Contains(got, "[redacted]") {
		t.Fatalf("redacted error missing replacement marker: %q", got)
	}
}

func TestGeoSatelliteImageSizeFromValues(t *testing.T) {
	t.Run("defaults when omitted", func(t *testing.T) {
		width, height, err := geoSatelliteImageSizeFromValues("", "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if width != geoSatelliteImageDefaultWidth || height != geoSatelliteImageDefaultHeight {
			t.Fatalf("unexpected default size: %dx%d", width, height)
		}
	})

	t.Run("accepts bounded custom size", func(t *testing.T) {
		width, height, err := geoSatelliteImageSizeFromValues("640", "512")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if width != 640 || height != 512 {
			t.Fatalf("unexpected custom size: %dx%d", width, height)
		}
	})

	t.Run("rejects partial size", func(t *testing.T) {
		if _, _, err := geoSatelliteImageSizeFromValues("640", ""); err == nil {
			t.Fatal("expected partial size to fail")
		}
	})

	t.Run("rejects oversized values", func(t *testing.T) {
		if _, _, err := geoSatelliteImageSizeFromValues("641", "480"); err == nil {
			t.Fatal("expected oversized width to fail")
		}
	})
}

func TestAnnotateGeoAICenterReticleMarksImageCenter(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 41, 31))
	base := color.RGBA{R: 12, G: 34, B: 56, A: 255}
	for y := 0; y < src.Bounds().Dy(); y++ {
		for x := 0; x < src.Bounds().Dx(); x++ {
			src.SetRGBA(x, y, base)
		}
	}

	var input bytes.Buffer
	if err := png.Encode(&input, src); err != nil {
		t.Fatalf("encode test image: %v", err)
	}

	annotated, err := annotateGeoAICenterReticle(input.Bytes())
	if err != nil {
		t.Fatalf("annotateGeoAICenterReticle returned error: %v", err)
	}

	decoded, err := png.Decode(bytes.NewReader(annotated))
	if err != nil {
		t.Fatalf("decode annotated image: %v", err)
	}

	center := color.RGBAModel.Convert(decoded.At(20, 15)).(color.RGBA)
	if center.R < 200 || center.G > 80 || center.B > 80 {
		t.Fatalf("center pixel was not marked red enough: %#v", center)
	}

	corner := color.RGBAModel.Convert(decoded.At(0, 0)).(color.RGBA)
	if corner != base {
		t.Fatalf("far corner changed unexpectedly: got %#v want %#v", corner, base)
	}
}
