package services

import (
	"math"
	"testing"
)

func TestGeoBattleCalculateScoreMatchesSinglePlayerFormula(t *testing.T) {
	got := geoBattleCalculateScore(3, 200)
	want := int(math.Round(5000 * math.Exp(-3*0.12) * math.Exp(-200.0/1500)))
	if got != want {
		t.Fatalf("geoBattleCalculateScore(3, 200) = %d, want %d", got, want)
	}
}

func TestGeoBattleCalculateScoreTreatsPerfectRangeAsExact(t *testing.T) {
	if geoBattlePerfectDistanceKM != 1 {
		t.Fatalf("geoBattlePerfectDistanceKM = %v, want 1", geoBattlePerfectDistanceKM)
	}

	if got := geoBattleCalculateScore(0, 0.8); got != 5000 {
		t.Fatalf("geoBattleCalculateScore(0, 0.8) = %d, want 5000", got)
	}

	if got, want := geoBattleCalculateScore(4, 0.8), geoBattleCalculateScore(4, 0); got != want {
		t.Fatalf("perfect-range score = %d, exact score = %d", got, want)
	}
}

func TestGeoBattleCalculateScoreStillDecaysOutsidePerfectRange(t *testing.T) {
	close := geoBattleCalculateScore(0, geoBattlePerfectDistanceKM+0.1)
	far := geoBattleCalculateScore(0, 1000)
	if close <= far {
		t.Fatalf("score should decay with distance outside perfect range: close=%d far=%d", close, far)
	}
}
