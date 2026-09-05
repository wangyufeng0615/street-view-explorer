package openai

import (
	"fmt"
	"strings"
	"unicode"
)

func isChineseLanguage(language string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(language)), "zh")
}

func descriptionLanguageInstruction(language string) string {
	if isChineseLanguage(language) {
		return "只输出简体中文。地点所属国家和当地语言都不能改变这条规则；开头方括号旁白、专名转写和所有正文都必须使用简体中文。"
	}
	return "Output only English. The location's country and local language never change this rule. Every visible word, including the opening bracket line, must be English."
}

func containsResearchNarration(text string) bool {
	lower := strings.ToLower(strings.TrimSpace(text))
	for _, phrase := range []string{
		"i'll search",
		"i will search",
		"i’m going to search",
		"i'm going to search",
		"let me search",
		"i'll look up",
		"i will look up",
		"let me look up",
		"i'll research",
		"i will research",
		"first, i'll search",
		"first i'll search",
		"我先搜索",
		"让我搜索",
		"我会搜索",
		"先查一下",
		"先搜索",
		"検索",
	} {
		if strings.Contains(lower, phrase) {
			return true
		}
	}
	return false
}

func countDescriptionScripts(text string) (han, kana, latin int) {
	for _, r := range text {
		switch {
		case unicode.In(r, unicode.Hiragana, unicode.Katakana):
			kana++
		case unicode.In(r, unicode.Han):
			han++
		case unicode.Is(unicode.Latin, r):
			latin++
		}
	}
	return han, kana, latin
}

func stripResearchNarration(text, language string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}

	opening := -1
	for _, marker := range []string{"[", "【"} {
		if index := strings.Index(trimmed, marker); index >= 0 && (opening < 0 || index < opening) {
			opening = index
		}
	}
	if opening > 0 && opening < 400 {
		prefix := strings.TrimSpace(trimmed[:opening])
		han, _, _ := countDescriptionScripts(prefix)
		if containsResearchNarration(prefix) || (isChineseLanguage(language) && han == 0) {
			return strings.TrimSpace(trimmed[opening:])
		}
	}

	if paragraphEnd := strings.Index(trimmed, "\n\n"); paragraphEnd > 0 && paragraphEnd < 400 {
		prefix := strings.TrimSpace(trimmed[:paragraphEnd])
		if containsResearchNarration(prefix) {
			return strings.TrimSpace(trimmed[paragraphEnd+2:])
		}
	}
	return trimmed
}

func validateDescriptionLanguage(text, language string, partial bool) error {
	if err := validateDescriptionMixedScript(text, language); err != nil {
		return err
	}
	han, kana, latin := countDescriptionScripts(text)
	if isChineseLanguage(language) {
		minimumHan := 12
		if partial {
			minimumHan = 4
		}
		if han < minimumHan || (kana >= 4 && kana > han) || (latin >= 20 && latin > han) {
			return fmt.Errorf("AI 返回的描述语言不符合简体中文要求")
		}
		return nil
	}

	minimumLatin := 20
	if partial {
		minimumLatin = 6
	}
	if (latin < minimumLatin && han+kana > latin*2) || (han+kana >= 12 && han+kana > latin) {
		return fmt.Errorf("AI returned the description in the wrong language")
	}
	return nil
}

type descriptionStreamGate struct {
	language   string
	downstream func(string) error
	pending    strings.Builder
	released   bool
}

const (
	// These are emergency fail-safes for malformed or runaway model output.
	// Normal response length is controlled by the prompt's paragraph skeleton.
	standardDescriptionEmergencyMaxRunes = 700
	detailedDescriptionEmergencyMaxRunes = 1100
)

func isDescriptionSentenceEnd(r rune) bool {
	switch r {
	case '。', '！', '？', '.', '!', '?':
		return true
	default:
		return false
	}
}

func descriptionPrefixAtSentenceEnd(text string, maxRunes int) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || maxRunes <= 0 {
		return ""
	}

	runes := []rune(trimmed)
	if len(runes) > maxRunes {
		runes = runes[:maxRunes]
	}
	lastEnd := 0
	for index, r := range runes {
		if isDescriptionSentenceEnd(r) {
			lastEnd = index + 1
		}
	}
	if lastEnd == 0 {
		return ""
	}
	for lastEnd < len(runes) {
		switch runes[lastEnd] {
		case '”', '’', '"', '\'', '）', ')', '】', ']', '」', '』', '\n', '\r', ' ', '\t':
			lastEnd++
		default:
			return strings.TrimSpace(string(runes[:lastEnd]))
		}
	}
	return strings.TrimSpace(string(runes[:lastEnd]))
}

func limitDescriptionLength(text string, maxRunes int) string {
	trimmed := strings.TrimSpace(text)
	if len([]rune(trimmed)) <= maxRunes {
		return trimmed
	}
	if bounded := descriptionPrefixAtSentenceEnd(trimmed, maxRunes); bounded != "" {
		return bounded
	}

	// Model prose should contain sentence punctuation. Keep a defensive fallback
	// so malformed responses still respect the product's hard upper bound.
	runes := []rune(trimmed)
	if maxRunes == 1 {
		return "。"
	}
	return strings.TrimSpace(string(runes[:maxRunes-1])) + "。"
}

type descriptionStreamLimiter struct {
	language   string
	downstream func(string) error
	maxRunes   int
	pending    strings.Builder
	emitted    string
}

func newDescriptionStreamLimiter(maxRunes int, downstream func(string) error) *descriptionStreamLimiter {
	return &descriptionStreamLimiter{downstream: downstream, maxRunes: maxRunes}
}

func (l *descriptionStreamLimiter) Write(delta string) error {
	if l.downstream == nil || delta == "" {
		return nil
	}
	l.pending.WriteString(delta)
	safePrefix := descriptionPrefixAtSentenceEnd(l.pending.String(), l.maxRunes)
	if safePrefix == "" || safePrefix == l.emitted || !strings.HasPrefix(safePrefix, l.emitted) {
		return nil
	}
	if err := validateDescriptionMixedScript(safePrefix, l.language); err != nil {
		return err
	}
	if err := l.downstream(safePrefix[len(l.emitted):]); err != nil {
		return err
	}
	l.emitted = safePrefix
	return nil
}

func (l *descriptionStreamLimiter) Finish(finalText string) error {
	if l.downstream == nil {
		return nil
	}
	bounded := limitDescriptionLength(finalText, l.maxRunes)
	if err := validateDescriptionMixedScript(bounded, l.language); err != nil {
		return err
	}
	if bounded == "" || bounded == l.emitted || !strings.HasPrefix(bounded, l.emitted) {
		return nil
	}
	if err := l.downstream(bounded[len(l.emitted):]); err != nil {
		return err
	}
	l.emitted = bounded
	return nil
}

func newDescriptionStreamGate(language string, downstream func(string) error) *descriptionStreamGate {
	return &descriptionStreamGate{language: language, downstream: downstream}
}

func (g *descriptionStreamGate) Write(delta string) error {
	if g.downstream == nil || delta == "" {
		return nil
	}
	if g.released {
		return g.downstream(delta)
	}

	g.pending.WriteString(delta)
	pending := g.pending.String()
	pendingRunes := len([]rune(pending))
	if pendingRunes < 80 || (!strings.Contains(pending, "\n\n") && pendingRunes < 220) {
		return nil
	}

	visible := stripResearchNarration(pending, g.language)
	if err := validateDescriptionLanguage(visible, g.language, true); err != nil {
		// A stream chunk is not a complete language sample. Keep buffering so an
		// English tool preamble or a short proper name cannot abort an otherwise
		// valid response. The complete response is validated before Finish.
		return nil
	}
	g.released = true
	return g.downstream(visible)
}

func (g *descriptionStreamGate) Finish(finalText string) error {
	if g.downstream == nil || g.released || finalText == "" {
		return nil
	}
	if err := validateDescriptionLanguage(finalText, g.language, false); err != nil {
		return err
	}
	g.released = true
	return g.downstream(finalText)
}
