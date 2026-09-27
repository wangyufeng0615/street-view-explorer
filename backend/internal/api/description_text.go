package api

import (
	"regexp"
	"strings"
)

var (
	markdownLinkLineRegex = regexp.MustCompile(`^\[([^\]]+)\]\((.+)\)$`)
	bareURLRegex          = regexp.MustCompile(`https?://[^\s()]+(?:\([^)]*\)[^\s()]*)*`)
	emptyParenthesesRegex = regexp.MustCompile(`[ \t]*\(\s*\)`)
	inlineSpacesRegex     = regexp.MustCompile(`[ \t]{2,}`)
	spaceBeforePunctRegex = regexp.MustCompile(`[ \t]+([。．.!?！？,，;；:：])`)
	trailingSpacesRegex   = regexp.MustCompile(`[ \t]+\n`)
	excessiveNewlines     = regexp.MustCompile(`\n{3,}`)
)

// sanitizeDescription 移除模型偶发输出的 markdown/URL 引用，保留正文和单独的 citation chips。
func sanitizeDescription(text string) string {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	end := len(lines)

	for end > 0 {
		line := strings.TrimSpace(lines[end-1])
		if line == "" {
			end--
			continue
		}

		candidate := line
		if strings.HasPrefix(candidate, "(") && strings.HasSuffix(candidate, ")") {
			candidate = strings.TrimSpace(candidate[1 : len(candidate)-1])
		}

		if !markdownLinkLineRegex.MatchString(candidate) {
			break
		}
		end--
	}

	cleaned := strings.TrimSpace(strings.Join(lines[:end], "\n"))
	cleaned = stripStandaloneMarkdownEmphasis(cleaned)
	cleaned = stripMarkdownLinksFromProse(cleaned)
	cleaned = bareURLRegex.ReplaceAllString(cleaned, "")
	cleaned = emptyParenthesesRegex.ReplaceAllString(cleaned, "")
	cleaned = spaceBeforePunctRegex.ReplaceAllString(cleaned, "$1")
	cleaned = inlineSpacesRegex.ReplaceAllString(cleaned, " ")
	cleaned = trailingSpacesRegex.ReplaceAllString(cleaned, "\n")
	cleaned = excessiveNewlines.ReplaceAllString(cleaned, "\n\n")
	return strings.TrimSpace(cleaned)
}

func stripStandaloneMarkdownEmphasis(text string) string {
	lines := strings.Split(text, "\n")
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		for _, marker := range []string{"**", "*", "__", "_"} {
			if len(trimmed) > len(marker)*2 && strings.HasPrefix(trimmed, marker) && strings.HasSuffix(trimmed, marker) {
				trimmed = strings.TrimSpace(trimmed[len(marker) : len(trimmed)-len(marker)])
				break
			}
		}
		lines[index] = trimmed
	}
	return strings.Join(lines, "\n")
}

func stripMarkdownLinksFromProse(text string) string {
	var builder strings.Builder
	builder.Grow(len(text))

	for i := 0; i < len(text); {
		if text[i] == '(' && i+1 < len(text) && text[i+1] == '[' {
			_, linkEnd, ok := parseMarkdownLink(text, i+1)
			if ok && linkEnd < len(text) && text[linkEnd] == ')' {
				i = linkEnd + 1
				continue
			}
		}

		if text[i] == '[' {
			label, linkEnd, ok := parseMarkdownLink(text, i)
			if ok {
				if !isSourceLinkLabel(label) {
					builder.WriteString(strings.TrimSpace(label))
				}
				i = linkEnd
				continue
			}
		}

		builder.WriteByte(text[i])
		i++
	}

	return builder.String()
}

func parseMarkdownLink(text string, start int) (string, int, bool) {
	if start >= len(text) || text[start] != '[' {
		return "", start, false
	}

	searchText := text[start+1:]
	if lineEnd := strings.IndexAny(searchText, "\r\n"); lineEnd >= 0 {
		searchText = searchText[:lineEnd]
	}

	labelEndOffset := strings.Index(searchText, "](")
	if labelEndOffset < 0 {
		return "", start, false
	}
	labelEnd := start + 1 + labelEndOffset
	urlStart := labelEnd + 2
	depth := 1

	for i := urlStart; i < len(text); i++ {
		switch text[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return text[start+1 : labelEnd], i + 1, true
			}
		}
	}

	return "", start, false
}

func isSourceLinkLabel(label string) bool {
	normalized := strings.ToLower(strings.TrimSpace(label))
	if normalized == "" {
		return true
	}
	if strings.Contains(normalized, "://") {
		return true
	}
	if strings.Contains(normalized, ".") && !strings.Contains(normalized, " ") {
		return true
	}

	sourceWords := []string{"wikipedia", "source", "citation", "reference"}
	for _, word := range sourceWords {
		if strings.Contains(normalized, word) {
			return true
		}
	}

	return false
}
