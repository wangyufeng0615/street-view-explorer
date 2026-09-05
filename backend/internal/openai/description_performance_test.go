package openai

import (
	"strings"
	"testing"
)

func TestDescriptionPerformancePolicy(t *testing.T) {
	t.Setenv("OPENROUTER_DESCRIPTION_SEARCH", "")
	t.Setenv("OPENROUTER_DESCRIPTION_PROVIDER_SORT", "")
	t.Setenv("OPENROUTER_PROVIDER_SORT", "latency")
	if descriptionProviderPreferences("another-model") != nil {
		t.Fatal("game policy leaked into descriptions")
	}
	if p := descriptionProviderPreferences(defaultSceneModel); p == nil || len(p.Order) != 1 || p.Order[0] != "fireworks" || p.AllowFallbacks == nil || !*p.AllowFallbacks || p.Sort != "" {
		t.Fatal("missing measured model preference or fallback")
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
	if p := descriptionProviderPreferences(defaultSceneModel); p == nil || p.Sort != "latency" || len(p.Order) != 0 {
		t.Fatal("description route not configurable")
	}
	t.Setenv("OPENROUTER_DESCRIPTION_PROVIDER_SORT", "off")
	if descriptionProviderPreferences(defaultSceneModel) != nil {
		t.Fatal("cannot restore automatic routing")
	}
}

func TestStreamRetainsProviderIdentity(t *testing.T) {
	r, err := readChatCompletionStream(strings.NewReader("data: {\"id\":\"gen-test\",\"provider\":\"Example\",\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"server_tool_use\":{\"web_search_requests\":1}}}\n\ndata: [DONE]\n\n"), nil)
	if err != nil || r.ID != "gen-test" || r.Provider != "Example" || r.Usage.webSearchRequests() != 1 {
		t.Fatalf("lost request metadata: %+v %v", r, err)
	}
}
