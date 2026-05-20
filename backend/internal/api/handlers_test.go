package api

import "testing"

func TestParseCoordinate(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		min     float64
		max     float64
		want    float64
		wantErr bool
	}{
		{name: "valid latitude", input: "31.2304", min: -90, max: 90, want: 31.2304},
		{name: "trimmed value", input: " 121.4737 ", min: -180, max: 180, want: 121.4737},
		{name: "reject trailing junk", input: "1abc", min: -90, max: 90, wantErr: true},
		{name: "reject nan", input: "nan", min: -90, max: 90, wantErr: true},
		{name: "reject infinity", input: "+Inf", min: -90, max: 90, wantErr: true},
		{name: "reject out of range", input: "181", min: -180, max: 180, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseCoordinate(tt.input, tt.min, tt.max)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got value %v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSanitizeDescription(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "keeps plain paragraphs",
			input: "第一段。\n\n第二段。",
			want:  "第一段。\n\n第二段。",
		},
		{
			name:  "strips trailing markdown links",
			input: "正文内容。\n\n[Wikipedia](https://en.wikipedia.org/wiki/Foo_(bar))\n[NOAA](https://example.com/report?id=1)",
			want:  "正文内容。",
		},
		{
			name:  "strips wrapped trailing markdown links",
			input: "Body text.\n\n([Example](https://example.com/a_(b)))",
			want:  "Body text.",
		},
		{
			name:  "only links becomes empty",
			input: "[Example](https://example.com)\n[Other](https://example.org)",
			want:  "",
		},
		{
			name:  "strips inline wrapped markdown citation after chinese sentence",
			input: "这地方的气质，很大程度上是被海湾、小机场和岛上的法属行政体系一起塑出来的。([en.wikipedia.org](https://en.wikipedia.org/wiki/Grand_Case?utm_source=openai))",
			want:  "这地方的气质，很大程度上是被海湾、小机场和岛上的法属行政体系一起塑出来的。",
		},
		{
			name:  "strips inline wrapped markdown citation before punctuation",
			input: "The village sits by the bay ([Wikipedia](https://example.com/a_(b))).",
			want:  "The village sits by the bay.",
		},
		{
			name:  "keeps non-source markdown labels as plain text",
			input: "It points toward [Grand Case](https://en.wikipedia.org/wiki/Grand_Case).",
			want:  "It points toward Grand Case.",
		},
		{
			name:  "strips parenthetical raw urls",
			input: "正文内容。 (https://example.com/a_(b))",
			want:  "正文内容。",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeDescription(tt.input); got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPanoIDRegexAllowsGooglePanoCharacters(t *testing.T) {
	valid := []string{
		"pano-a_b",
		"CAoSFkNJSE0wb2dLRUlDQWdJQ09nX0N0RGc.",
		"CAoSHENJQUJJaEQ2MkllUzNQWGEtMDV2OEIyY3Vsd24.",
	}
	for _, panoID := range valid {
		if !panoIDRegex.MatchString(panoID) {
			t.Fatalf("panoIDRegex rejected valid pano id %q", panoID)
		}
	}

	invalid := []string{
		"bad/pano",
		"bad pano",
		"bad?pano",
	}
	for _, panoID := range invalid {
		if panoIDRegex.MatchString(panoID) {
			t.Fatalf("panoIDRegex accepted invalid pano id %q", panoID)
		}
	}
}
