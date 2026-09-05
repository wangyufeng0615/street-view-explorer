package services

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

func TestGeoBattleRejectsLateActionsBeforeTimerRuns(t *testing.T) {
	for _, action := range []string{"guess", "zoom"} {
		t.Run(action, func(t *testing.T) {
			svc, room := newTestGeoBattleServiceWithPlayingRoom()
			expired := time.Now().Add(-time.Second)
			room.PhaseDeadlineAt = &expired
			var err error
			if action == "guess" {
				lat, lng := 1.0, 2.0
				_, err = svc.SubmitGuess(room.ID, "player-a", &lat, &lng, false)
			} else {
				_, err = svc.ZoomOut(room.ID, "player-a")
			}
			if err != ErrGeoBattleInvalidPhase {
				t.Fatalf("late action error=%v", err)
			}
			if len(room.Rounds[0].Guesses) != 0 || room.Players[0].CurrentSteps != 0 {
				t.Fatal("late action mutated round")
			}
		})
	}
}

func TestGeoBattleLeaveCancelsPreparation(t *testing.T) {
	svc, room := newTestGeoBattleServiceWithPlayingRoom()
	svc.mu.Lock()
	svc.enterPreparingLocked(room, 1)
	ctx := room.PrepareContext
	svc.mu.Unlock()
	if err := svc.LeaveRoom(room.ID, "player-a"); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() != context.Canceled {
		t.Fatalf("preparation error=%v", ctx.Err())
	}
	if _, err := svc.generateRounds(ctx); err != context.Canceled {
		t.Fatalf("generation did not stop: %v", err)
	}
}

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

func TestGeoBattleRoundDurationIsOneHundredSeconds(t *testing.T) {
	if geoBattleRoundDuration != 100*time.Second {
		t.Fatalf("geoBattleRoundDuration = %v, want 100s", geoBattleRoundDuration)
	}
}

func TestGeoBattleSubmittedGuessesRevealOnlyAfterTimer(t *testing.T) {
	svc, room := newTestGeoBattleServiceWithPlayingRoom()
	latA, lngA := 51.5, -0.12
	latB, lngB := 51.52, -0.14

	first, err := svc.SubmitGuess(room.ID, "player-a", &latA, &lngA, false)
	if err != nil {
		t.Fatalf("first SubmitGuess failed: %v", err)
	}
	if first.Phase != models.GeoBattlePhasePlaying {
		t.Fatalf("phase after first submit = %s, want playing", first.Phase)
	}
	if first.Me.TotalScore != 0 {
		t.Fatalf("visible total after first submit = %d, want hidden current-round score", first.Me.TotalScore)
	}
	if first.Round.MyGuess != nil {
		t.Fatalf("current-round guess should be hidden before reveal")
	}

	second, err := svc.SubmitGuess(room.ID, "player-b", &latB, &lngB, false)
	if err != nil {
		t.Fatalf("second SubmitGuess failed: %v", err)
	}
	if second.Phase != models.GeoBattlePhasePlaying {
		t.Fatalf("phase after both submit = %s, want playing until timer expires", second.Phase)
	}
	if second.Me.TotalScore != 0 || second.Opponent.TotalScore != 0 {
		t.Fatalf("visible totals before reveal = %d:%d, want 0:0", second.Me.TotalScore, second.Opponent.TotalScore)
	}
	if second.Round.MyGuess != nil || second.Round.OpponentGuess != nil {
		t.Fatalf("round guesses should be hidden before reveal")
	}

	svc.mu.Lock()
	svc.enterRevealLocked(room, "time_up")
	revealed := svc.snapshotLocked(room, "player-a")
	svc.mu.Unlock()

	if revealed.Phase != models.GeoBattlePhaseReveal {
		t.Fatalf("phase after timer reveal = %s, want reveal", revealed.Phase)
	}
	if revealed.Me.TotalScore == 0 || revealed.Opponent.TotalScore == 0 {
		t.Fatalf("visible totals after reveal = %d:%d, want non-zero scores", revealed.Me.TotalScore, revealed.Opponent.TotalScore)
	}
	if revealed.Round.MyGuess == nil || revealed.Round.OpponentGuess == nil {
		t.Fatalf("round guesses should be visible after reveal")
	}
}

func TestGeoBattleImageNotReadyDuringCountdown(t *testing.T) {
	svc, room := newTestGeoBattleServiceWithPlayingRoom()
	room.Phase = models.GeoBattlePhaseCountdown

	if _, _, _, err := svc.GetImageSpec(room.ID, "player-a"); err != ErrGeoBattleImageNotReady {
		t.Fatalf("GetImageSpec during countdown error = %v, want ErrGeoBattleImageNotReady", err)
	}
}

func TestGeoBattlePreparingClearsStaleRoundState(t *testing.T) {
	svc, room := newTestGeoBattleServiceWithPlayingRoom()
	room.Phase = models.GeoBattlePhaseFinished
	room.CurrentRound = 0
	room.Players[0].TotalScore = 4200
	room.Players[1].TotalScore = 3900

	svc.mu.Lock()
	svc.enterPreparingLocked(room, room.PrepareToken+1)
	snapshot := svc.snapshotLocked(room, "player-a")
	svc.mu.Unlock()

	if snapshot.Phase != models.GeoBattlePhasePreparing {
		t.Fatalf("phase = %s, want preparing", snapshot.Phase)
	}
	if snapshot.Round != nil || len(snapshot.Rounds) != 0 {
		t.Fatalf("preparing snapshot should not expose stale rounds: round=%v rounds=%d", snapshot.Round, len(snapshot.Rounds))
	}
	if snapshot.Me.TotalScore != 0 || snapshot.Opponent.TotalScore != 0 {
		t.Fatalf("preparing totals = %d:%d, want reset scores", snapshot.Me.TotalScore, snapshot.Opponent.TotalScore)
	}
}

func TestGeoBattleFinishedSnapshotOnlyIncludesReachedRounds(t *testing.T) {
	svc, room := newTestGeoBattleServiceWithPlayingRoom()
	room.Rounds = append(room.Rounds,
		geoBattleRound{
			Location: models.Location{Latitude: 48.8566, Longitude: 2.3522, FormattedAddress: "Paris"},
			Guesses:  map[string]*geoBattleGuess{},
		},
		geoBattleRound{
			Location: models.Location{Latitude: 35.6762, Longitude: 139.6503, FormattedAddress: "Tokyo"},
			Guesses:  map[string]*geoBattleGuess{},
		},
	)
	room.CurrentRound = 1

	svc.mu.Lock()
	svc.finishRoomLocked(room)
	snapshot := svc.snapshotLocked(room, "player-a")
	svc.mu.Unlock()

	if snapshot.Phase != models.GeoBattlePhaseFinished {
		t.Fatalf("phase = %s, want finished", snapshot.Phase)
	}
	if got, want := len(snapshot.Rounds), 2; got != want {
		t.Fatalf("finished rounds length = %d, want only reached rounds %d", got, want)
	}
	for _, round := range snapshot.Rounds {
		if round.Index > 2 {
			t.Fatalf("finished snapshot leaked unreached round index %d", round.Index)
		}
	}
}

func TestGeoBattleJoiningFinishedRoomStartsFreshLobby(t *testing.T) {
	svc, room := newTestGeoBattleServiceWithPlayingRoom()
	room.Phase = models.GeoBattlePhaseFinished
	room.Players = room.Players[:1]
	room.Players[0].TotalScore = 4200
	delete(svc.sessionRooms, "player-b")

	snapshot, err := svc.JoinPrivateRoom("player-c", "C", room.Code)
	if err != nil {
		t.Fatalf("JoinPrivateRoom failed: %v", err)
	}

	if snapshot.Phase != models.GeoBattlePhaseLobby {
		t.Fatalf("phase = %s, want fresh lobby", snapshot.Phase)
	}
	if snapshot.Round != nil || len(snapshot.Rounds) != 0 {
		t.Fatalf("fresh lobby should not expose old rounds: round=%v rounds=%d", snapshot.Round, len(snapshot.Rounds))
	}
	if snapshot.Me.TotalScore != 0 || snapshot.Opponent.TotalScore != 0 {
		t.Fatalf("fresh lobby totals = %d:%d, want reset scores", snapshot.Me.TotalScore, snapshot.Opponent.TotalScore)
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

func newTestGeoBattleServiceWithPlayingRoom() (*GeoBattleService, *geoBattleRoom) {
	now := time.Now()
	deadline := now.Add(geoBattleRoundDuration)
	room := &geoBattleRoom{
		ID:              "room-1",
		Code:            "ABC123",
		Mode:            models.GeoBattleModePrivate,
		Phase:           models.GeoBattlePhasePlaying,
		HostSessionID:   "player-a",
		CreatedAt:       now,
		UpdatedAt:       now,
		PhaseDeadlineAt: &deadline,
		Players: []*geoBattlePlayer{
			{
				SessionID:   "player-a",
				Nickname:    "A",
				IsHost:      true,
				LastSeenAt:  now,
				CurrentZoom: models.GeoBattleStartZoom,
			},
			{
				SessionID:   "player-b",
				Nickname:    "B",
				LastSeenAt:  now,
				CurrentZoom: models.GeoBattleStartZoom,
			},
		},
		Rounds: []geoBattleRound{
			{
				Location: models.Location{
					Latitude:         51.5074,
					Longitude:        -0.1278,
					FormattedAddress: "London",
					Country:          "United Kingdom",
				},
				Guesses: map[string]*geoBattleGuess{},
			},
		},
	}

	return &GeoBattleService{
		rooms: map[string]*geoBattleRoom{
			room.ID: room,
		},
		roomCodes: map[string]string{
			room.Code: room.ID,
		},
		sessionRooms: map[string]string{
			"player-a": room.ID,
			"player-b": room.ID,
		},
		queue: map[string]*geoBattleQueueEntry{},
	}, room
}
