package api

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/my-streetview-project/backend/internal/services"
)

func TestInterestErrorMessageFollowsLanguage(t *testing.T) {
	wrapped := fmt.Errorf("check: %w", services.ErrInterestTooLong)
	if got := interestErrorMessage(wrapped, "en"); !strings.Contains(got, "too long") {
		t.Fatalf("english too-long message = %q", got)
	}
	if got := interestErrorMessage(wrapped, "zh"); !strings.Contains(got, "太长") {
		t.Fatalf("chinese too-long message = %q", got)
	}

	other := errors.New("database is locked")
	if got := interestErrorMessage(other, "en"); strings.Contains(got, "database") || strings.ContainsAny(got, "数据库") {
		t.Fatalf("internal error leaked into %q", got)
	}
	if isInterestInputError(other) {
		t.Fatal("a storage failure is not an input problem and should be reported")
	}
	if !isInterestInputError(services.ErrInterestNotUnderstood) {
		t.Fatal("an interest the AI cannot map is an input problem")
	}
}
