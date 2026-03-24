package openai

import (
	"strings"
	"testing"
)

func ann(url string, start, end int) annotation {
	return annotation{
		Type: "url_citation",
		URLCitation: struct {
			URL        string `json:"url"`
			Title      string `json:"title"`
			StartIndex int    `json:"start_index"`
			EndIndex   int    `json:"end_index"`
		}{URL: url, StartIndex: start, EndIndex: end},
	}
}

func TestStripInlineCitations(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		annotations []annotation
		want        string
	}{
		{
			name:        "no annotations",
			content:     "Hello world.",
			annotations: nil,
			want:        "Hello world.",
		},
		{
			// "Content.[link](https://x.co)"
			//  01234567890123456789012345678
			//          ^start=8          ^end=28
			name:        "strip bare citation",
			content:     "Content.[link](https://x.co)",
			annotations: []annotation{ann("https://x.co", 8, 28)},
			want:        "Content.",
		},
		{
			// "正文。([src](https://x.co))"
			//  0 1 2 3 4 5678 9 0123456789012 3
			//  正文。(  [src] ( https://x.co )  )
			//            ^start=4           ^end=23
			// wrapping () at 3 and 23 should also be stripped
			name:        "strip wrapped citation with parens",
			content:     "正文。([src](https://x.co))",
			annotations: []annotation{ann("https://x.co", 4, 23)},
			want:        "正文。",
		},
		{
			// "A。[a](https://a)\n\nB。[b](https://b)"
			//  0 1 2345 6789012345 67 89 01234 56789012 34
			//  A 。[a](https://a)  \n\n B 。[b](https://b)
			//      ^2         ^16        ^22          ^34  (note: \n is one rune)
			name:    "multiple citations in two paragraphs",
			content: "A。[a](https://a)\n\nB。[b](https://b)",
			annotations: []annotation{
				ann("https://a", 2, 16),
				ann("https://b", 20, 34),
			},
			want: "A。\n\nB。",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripInlineCitations(tt.content, tt.annotations)
			if got != tt.want {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestGeographerSystemPromptKeepsCitationsOutOfBody(t *testing.T) {
	requiredPhrases := []string{
		"The product renders citations separately",
		"Finish on a complete sentence about the place itself",
		"Treat links, raw URLs, source lists, and parenthetical reference blocks as off-screen metadata",
	}

	for _, phrase := range requiredPhrases {
		if !strings.Contains(geographerSystemPrompt, phrase) {
			t.Fatalf("geographerSystemPrompt missing phrase %q", phrase)
		}
	}
}
