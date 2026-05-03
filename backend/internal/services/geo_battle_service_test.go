package services

import (
	"math"
	"testing"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

func TestGeoBattleCalculateScoreMatchesSinglePlayerFormula(t *testing.T) {
	got := geoBattleCalculateScore(3, 200)
	effectiveDistance := 200.0 - geoBattleGuessToleranceKM(3)
	want := int(math.Round(5000 * math.Exp(-3*0.12) * math.Exp(-effectiveDistance/1500)))
	if got != want {
		t.Fatalf("geoBattleCalculateScore(3, 200) = %d, want %d", got, want)
	}
}

func TestGeoBattleCalculateScoreTreatsDynamicToleranceAsExact(t *testing.T) {
	if geoBattlePerfectDistanceKM != 1 {
		t.Fatalf("geoBattlePerfectDistanceKM = %v, want 1", geoBattlePerfectDistanceKM)
	}

	if got := geoBattleCalculateScore(0, 0.8); got != 5000 {
		t.Fatalf("geoBattleCalculateScore(0, 0.8) = %d, want 5000", got)
	}

	if got, want := geoBattleCalculateScore(4, 0.8), geoBattleCalculateScore(4, 0); got != want {
		t.Fatalf("perfect-range score = %d, exact score = %d", got, want)
	}

	tolerance := geoBattleGuessToleranceKM(10)
	if tolerance < 40 || tolerance > 42 {
		t.Fatalf("zoom step 10 tolerance = %v, want about 41 km", tolerance)
	}
	if got, want := geoBattleCalculateScore(10, 35), geoBattleCalculateScore(10, 0); got != want {
		t.Fatalf("dynamic-tolerance score = %d, exact score = %d", got, want)
	}
}

func TestGeoBattleCalculateScoreStillDecaysOutsidePerfectRange(t *testing.T) {
	close := geoBattleCalculateScore(0, geoBattlePerfectDistanceKM+0.1)
	far := geoBattleCalculateScore(0, 1000)
	if close <= far {
		t.Fatalf("score should decay with distance outside perfect range: close=%d far=%d", close, far)
	}
}

func TestGeoBattleRoundDurationIsThirtySeconds(t *testing.T) {
	if geoBattleRoundDuration != 30*time.Second {
		t.Fatalf("geoBattleRoundDuration = %v, want 30s", geoBattleRoundDuration)
	}
}

func TestGeoBattleLocationTooCloseUsesMinimumRoundDistance(t *testing.T) {
	rounds := []geoBattleRound{
		{Location: models.Location{Latitude: 51.5074, Longitude: -0.1278}},
	}

	nearLondon := models.Location{Latitude: 51.53, Longitude: -0.1}
	if !geoBattleLocationTooClose(nearLondon, rounds) {
		t.Fatalf("nearby location should be rejected")
	}

	paris := models.Location{Latitude: 48.8566, Longitude: 2.3522}
	if geoBattleLocationTooClose(paris, rounds) {
		t.Fatalf("distant location should be accepted")
	}
}
