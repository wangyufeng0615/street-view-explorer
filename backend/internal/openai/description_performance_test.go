package openai

import "testing"

func TestDescriptionPerformancePolicy(t *testing.T) {
	t.Setenv("OPENROUTER_DESCRIPTION_SEARCH", "")
	t.Setenv("OPENROUTER_DESCRIPTION_PROVIDER_SORT", "")
	t.Setenv("OPENROUTER_PROVIDER_SORT", "latency")
	if descriptionProviderPreferences() != nil {
		t.Fatal("game policy leaked into descriptions")
	}
	for _, detailed := range []bool{false, true} {
		p := descriptionSearchParameters(detailed)
		if p.Engine != "exa" || p.Mode != "fast" || p.MaxResults != p.MaxTotalResults {
			t.Fatalf("invalid search policy: %+v", p)
		}
		if detailed && (p.MaxResults != 6 || p.MaxCharacters != 2500) {
			t.Fatal("changed detailed evidence budget")
		}
		if !detailed && (p.MaxResults != 4 || p.MaxCharacters != 3000) {
			t.Fatal("changed standard evidence budget")
		}
	}
	t.Setenv("OPENROUTER_DESCRIPTION_SEARCH", "auto")
	if p := descriptionSearchParameters(false); p.Engine != "auto" || p.Mode != "" {
		t.Fatal("cannot restore previous search policy")
	}
	t.Setenv("OPENROUTER_DESCRIPTION_PROVIDER_SORT", "latency")
	if p := descriptionProviderPreferences(); p == nil || p.Sort != "latency" {
		t.Fatal("description route not configurable")
	}
	t.Setenv("OPENROUTER_DESCRIPTION_PROVIDER_SORT", "off")
	if descriptionProviderPreferences() != nil {
		t.Fatal("cannot restore automatic routing")
	}
}
