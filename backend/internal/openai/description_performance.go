package openai

import (
	"os"
	"strings"
)

// Description routing is independent of the satellite guessing game: by
// default OpenRouter picks the provider, and an explicit sort can override it.
func descriptionProviderPreferences() *providerPreferences {
	switch sort := strings.ToLower(strings.TrimSpace(os.Getenv("OPENROUTER_DESCRIPTION_PROVIDER_SORT"))); sort {
	case "latency", "throughput", "price":
		return &providerPreferences{Sort: sort}
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
