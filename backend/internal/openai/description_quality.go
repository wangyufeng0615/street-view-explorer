package openai

import (
	"fmt"
	"regexp"
	"strings"
)

// A local name may be retained in parentheses, but an English word glued into
// Chinese grammar (e.g. "把Back往") is not a proper-name transcription.
var embeddedLatinWord = regexp.MustCompile(`[\p{Han}]([A-Za-z]{2,})[\p{Han}]`)

func validateDescriptionMixedScript(text, language string) error {
	if !isChineseLanguage(language) {
		return nil
	}
	for _, match := range embeddedLatinWord.FindAllStringSubmatch(text, -1) {
		word := match[1]
		// Conventional acronyms such as GPS/AI are allowed, not arbitrary prose.
		if word != strings.ToUpper(word) || len(word) > 8 {
			return fmt.Errorf("AI 描述包含不自然的中英文混写，请重试")
		}
	}
	return nil
}

const descriptionGroundingRules = `Location grounding rules (apply in every output language):
- Coordinates and the supplied street address are the location anchor. Reverse geocoding is approximate, not proof of a village boundary. Never replace the address locality with a village found in search results. If locality/address evidence conflicts, describe the confirmed island or region and explicitly qualify nearby places as nearby.
- The image proves visible features only. It cannot prove a population, administrative boundary, historical event, or that the camera is physically on a road; a panorama may be aerial.
- Prefer stable geographic facts. Omit exact population counts and other changing statistics unless the source explicitly states BOTH the year and the same geographic scope, and include those qualifiers in the prose. Never describe an old count as today's population.
- A search result about a neighbouring village is regional context, not evidence that its schools, residents or disasters are at this coordinate. Do not invent travel actions or conversations as personal memories.
- Use natural, complete sentences in the requested language. Chinese proper names may include a parenthesized original spelling; do not insert English filler words into Chinese grammar. If evidence is thin, write less rather than invent details.`
