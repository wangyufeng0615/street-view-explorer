package openai

import (
	"sort"
)

func extractCitations(resp chatResponse) []Citation {
	if len(resp.Choices) == 0 {
		return nil
	}
	seen := make(map[string]bool)
	var citations []Citation
	for _, ann := range resp.Choices[0].Message.Annotations {
		if ann.Type != "url_citation" || ann.URLCitation.URL == "" {
			continue
		}
		if seen[ann.URLCitation.URL] {
			continue
		}
		seen[ann.URLCitation.URL] = true
		citations = append(citations, Citation{
			URL:   ann.URLCitation.URL,
			Title: ann.URLCitation.Title,
		})
	}
	return citations
}

// stripInlineCitations removes citation markers from content using annotation positional data.
// Annotations provide start_index/end_index as character (rune) offsets into the content string.
func stripInlineCitations(content string, annotations []annotation) string {
	if len(annotations) == 0 {
		return content
	}

	runes := []rune(content)
	runeLen := len(runes)

	// Collect valid citation ranges
	type span struct{ start, end int }
	var spans []span
	for _, ann := range annotations {
		if ann.Type != "url_citation" {
			continue
		}
		s, e := ann.URLCitation.StartIndex, ann.URLCitation.EndIndex
		if s < 0 || e > runeLen || s >= e {
			continue
		}
		spans = append(spans, span{s, e})
	}
	if len(spans) == 0 {
		return content
	}

	// Sort descending by start so removals don't shift earlier indices
	sort.Slice(spans, func(i, j int) bool {
		return spans[i].start > spans[j].start
	})

	for _, sp := range spans {
		// Expand to swallow wrapping parentheses: ...。([link]) → ...。
		start, end := sp.start, sp.end
		if start > 0 && runes[start-1] == '(' && end < runeLen && runes[end] == ')' {
			start--
			end++
		}
		// Also trim leading whitespace before the citation
		for start > 0 && (runes[start-1] == ' ' || runes[start-1] == '\t') {
			start--
		}
		runes = append(runes[:start], runes[end:]...)
		runeLen = len(runes)
	}

	return string(runes)
}
