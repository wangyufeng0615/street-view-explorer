package openai

import (
	"os"
	"strings"
)

// Description routing is independent of the satellite guessing game.
// Prefer the measured endpoint only for the model evaluated on SG. A model
// override must not inherit an unrelated provider pin. Fallback remains allowed.
func descriptionProviderPreferences(model string) *providerPreferences {
	switch sort := strings.ToLower(strings.TrimSpace(os.Getenv("OPENROUTER_DESCRIPTION_PROVIDER_SORT"))); sort {
	case "latency", "throughput", "price":
		return &providerPreferences{Sort: sort}
	case "off", "auto":
		return nil
	}
	if model == defaultSceneModel || model == defaultSceneModel+"-20260821" {
		allow := true
		return &providerPreferences{Order: []string{"fireworks"}, AllowFallbacks: &allow}
	}
	return nil
}

func descriptionSearchParameters(detailed bool) webSearchParameters {
	p := webSearchParameters{Engine: "exa", Mode: "fast", MaxResults: 4, MaxTotalResults: 4, MaxCharacters: 3000}
	if detailed {
		p.MaxResults = 6
		p.MaxTotalResults = 6
		p.MaxCharacters = 2500
	}
	// Explicit auto restores the previous search routing, including native search
	// when a future model supports it. Keep result/context budgets unchanged.
	if strings.EqualFold(strings.TrimSpace(os.Getenv("OPENROUTER_DESCRIPTION_SEARCH")), "auto") {
		p.Engine = "auto"
		p.Mode = ""
	}
	return p
}
