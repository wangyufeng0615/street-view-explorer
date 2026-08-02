package atlas

import (
	"strings"
	"testing"
)

func TestTextSystemPromptRequiresSubstantiveLetter(t *testing.T) {
	prompt := TextSystemPrompt("zh-CN")
	for _, required := range []string{
		"正文写 4-6 个有内容的段落",
		"450-650 个中文字",
		"通常以 5 个正文段落为默认",
		"historical mini-story",
		"detail a curious friend would remember",
		"Always start with one bracket line",
		"不计入正文段落",
		"exact locality together with its history and local life",
		"Same-name places are common",
		"never silently blend conflicting records",
		"不会假装亲眼看见用户当前的街景画面",
		"must not claim current visual evidence",
	} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("TextSystemPrompt() missing richness instruction %q", required)
		}
	}
	if strings.Contains(prompt, "around 150 words total") {
		t.Fatal("TextSystemPrompt() still contains the old short-letter cap")
	}
	if strings.Contains(prompt, "BAD:") || strings.Contains(prompt, "不是靠旅游") {
		t.Fatal("TextSystemPrompt() should not prime the model with forbidden contrastive examples")
	}
	for _, forbidden := range []string{"边看边聊", "visible terrain", "what's at this exact spot", "Atlas at the scene"} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("TextSystemPrompt() still contains visual-only instruction %q", forbidden)
		}
	}
}

func TestRealtimeInstructionsAllowCompleteArrivalStory(t *testing.T) {
	zh := RealtimeInstructions("zh")
	for _, required := range []string{
		"默认 2-4 句",
		"80-160 个中文字",
		"历史或生活趣闻",
		"不要只报年份和统计数字",
	} {
		if !strings.Contains(zh, required) {
			t.Fatalf("RealtimeInstructions(zh) missing %q", required)
		}
	}
	if strings.Contains(zh, "默认 1-2 句") || strings.Contains(zh, "只用一句") {
		t.Fatal("RealtimeInstructions(zh) still forces abrupt one-line replies")
	}

	en := RealtimeInstructions("en")
	if !strings.Contains(en, "Default to 2-4 complete sentences") ||
		!strings.Contains(en, "grounded historical or everyday-life curiosity") {
		t.Fatal("RealtimeInstructions(en) did not receive the richer arrival guidance")
	}
}
