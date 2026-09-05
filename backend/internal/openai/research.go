package openai

import "context"

type researchObserverKey struct{}

// WithResearchObserver reports provider evidence without inferring a tool run
// from the prompt or from missing usage metadata. The callback is request-scoped.
func WithResearchObserver(ctx context.Context, observer func(string)) context.Context {
	return context.WithValue(ctx, researchObserverKey{}, observer)
}

func reportResearch(ctx context.Context, searchRequests int) {
	status := "unverified"
	if searchRequests > 0 {
		status = "verified"
	}
	if observer, ok := ctx.Value(researchObserverKey{}).(func(string)); ok {
		observer(status)
	}
}
