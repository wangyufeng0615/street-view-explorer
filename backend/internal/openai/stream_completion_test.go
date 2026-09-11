package openai

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

type deadlineAfterStream struct {
	reads int
}

func (r *deadlineAfterStream) Read([]byte) (int, error) {
	r.reads++
	return 0, context.DeadlineExceeded
}

func TestStreamDoneDoesNotWaitForConnectionClose(t *testing.T) {
	after := &deadlineAfterStream{}
	body := io.MultiReader(strings.NewReader(
		"data: {\"id\":\"gen-test\",\"provider\":\"test\",\"choices\":[{\"delta\":{\"content\":\"Completed answer\"}}]}\n\n"+
			"data: {\"choices\":[],\"usage\":{\"server_tool_use\":{\"web_search_requests\":1}}}\n\n"+
			"data: [DONE]\n\n"), after)
	var visible strings.Builder
	resp, err := readChatCompletionStream(body, func(delta string) error {
		visible.WriteString(delta)
		return nil
	})
	if err != nil {
		t.Fatalf("completed response reported as failure: %v", err)
	}
	if after.reads != 0 {
		t.Fatal("read beyond DONE; a persistent connection would stall here")
	}
	if resp.Choices[0].Message.Content != "Completed answer" || visible.String() != "Completed answer" {
		t.Fatalf("lost final content: %+v", resp)
	}
	if resp.ID != "gen-test" || resp.Provider != "test" || resp.Usage.webSearchRequests() != 1 {
		t.Fatalf("lost completion metadata: %+v", resp)
	}
}

func TestStreamIgnoresBufferedDataAfterDone(t *testing.T) {
	_, err := readChatCompletionStream(strings.NewReader("data: [DONE]\n\ndata: invalid-json\n\n"), nil)
	if err != nil {
		t.Fatalf("read data after terminal event: %v", err)
	}
}

func TestStreamKeepsDeadlineBeforeDoneAsFailure(t *testing.T) {
	_, err := readChatCompletionStream(io.MultiReader(
		strings.NewReader("data: {\"choices\":[{\"delta\":{\"content\":\"Partial answer\"}}]}\n\n"),
		&deadlineAfterStream{},
	), nil)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unfinished response lost deadline error: %v", err)
	}
}

func TestStreamKeepsConsumerCancellation(t *testing.T) {
	_, err := readChatCompletionStream(strings.NewReader(
		"data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\ndata: [DONE]\n\n",
	), func(string) error { return context.Canceled })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("consumer cancellation lost: %v", err)
	}
}
