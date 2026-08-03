package atlas

import (
	"strings"
	"testing"
)

func TestTextSystemPromptRequiresSubstantiveLetter(t *testing.T) {
	prompt := TextSystemPrompt("zh-CN")
	for _, required := range []string{
		"正好 3 个正文段落",
		"第一段正好 2 句",
		"第二段正好 2 句",
		"第三段写 1-2 句",
		"260-380 个中文字",
		"一次第一人称反应",
		"一次对老朋友的轻声插话",
		"至少安排一句简短自然的话",
		"避免“值得注意的是”",
		"不要增加问候语、署名或额外方括号旁白",
		"只选择最能解释这个地点的 2 个信息点",
		"历史小故事与地方生活细节中二选一",
		"第三段只能把前两段中的一个信息点连接到当代生计、日常习惯或近年变化",
		"必须以一行独立的方括号旁白开头",
		"第一人称小念头",
		"每次随地点变化",
		"不能套用",
		"不计入正文段落",
		"同时核对具体地点",
		"避免把同名地点的资料混进来",
		"绝不悄悄拼接",
		"不会假装亲眼看见用户当前的街景画面",
		"不能声称看到了当前街景",
	} {
		if !strings.Contains(prompt, required) {
			t.Fatalf("TextSystemPrompt() missing richness instruction %q", required)
		}
	}
	if strings.Contains(prompt, "around 150 words total") {
		t.Fatal("TextSystemPrompt() still contains the old short-letter cap")
	}
	for _, obsolete := range []string{"写 4-6 个有内容的正文段落", "450-650 个中文字", "通常以 5 段为默认", "绝不能超过 450 个中文字"} {
		if strings.Contains(prompt, obsolete) {
			t.Fatalf("TextSystemPrompt() still contains obsolete length instruction %q", obsolete)
		}
	}
	if strings.Contains(prompt, "BAD:") || strings.Contains(prompt, "不是靠旅游") {
		t.Fatal("TextSystemPrompt() should not prime the model with forbidden contrastive examples")
	}
	for _, forbidden := range []string{"RHYTHM — THIS IS A CHAT", "CRITICAL FORMATTING RULES", "WEB RESEARCH:"} {
		if strings.Contains(prompt, forbidden) {
			t.Fatalf("Chinese TextSystemPrompt still contains English instruction block %q", forbidden)
		}
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
