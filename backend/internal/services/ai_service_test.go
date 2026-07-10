package services

import (
	"testing"

	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/openai"
)

func TestDescriptionCacheReturnsCitationClones(t *testing.T) {
	service := &AIService{}
	citations := []openai.Citation{{URL: "https://example.com", Title: "Original"}}
	service.cacheDescription("key", "Atlas 来信", citations)
	citations[0].Title = "changed outside"

	description, first, ok := service.getCachedDescription("key")
	if !ok || description != "Atlas 来信" || first[0].Title != "Original" {
		t.Fatalf("unexpected cached value: description=%q citations=%#v ok=%v", description, first, ok)
	}
	first[0].Title = "changed by caller"

	_, second, ok := service.getCachedDescription("key")
	if !ok || second[0].Title != "Original" {
		t.Fatalf("cache did not isolate caller mutation: %#v", second)
	}
}

func TestDescriptionCacheKeyIncludesExactSceneAndDetailMode(t *testing.T) {
	location := models.Location{PanoID: "location-pano"}
	base := descriptionCacheKey(
		location,
		"zh",
		StreetViewView{PanoID: "scene-pano", Heading: 90, Pitch: 0, FOV: 80},
		false,
	)
	sameNormalized := descriptionCacheKey(
		location,
		"zh",
		StreetViewView{PanoID: "scene-pano", Heading: 90, Pitch: 0, FOV: 80},
		false,
	)
	rotated := descriptionCacheKey(
		location,
		"zh",
		StreetViewView{PanoID: "scene-pano", Heading: 91, Pitch: 0, FOV: 80},
		false,
	)
	detailed := descriptionCacheKey(
		location,
		"zh",
		StreetViewView{PanoID: "scene-pano", Heading: 90, Pitch: 0, FOV: 80},
		true,
	)

	if base != sameNormalized {
		t.Fatalf("identical scenes produced different keys: %q != %q", base, sameNormalized)
	}
	if base == rotated || base == detailed {
		t.Fatalf("cache key did not separate scene/detail variants: base=%q rotated=%q detailed=%q", base, rotated, detailed)
	}
}
