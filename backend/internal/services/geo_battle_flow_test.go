package services

import (
	"strings"
	"testing"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

// newBlockingGeoBattleService returns a service whose round generation blocks
// until the preparation context is canceled, so tests can observe the
// preparing phase deterministically.
func newBlockingGeoBattleService() *GeoBattleService {
	return NewGeoBattleService(NewLocationService(nil, nil, canceledMapProvider{}))
}

func waitForGeoBattleRoom(t *testing.T, svc *GeoBattleService, roomID string, done func(*geoBattleRoom) bool) *geoBattleRoom {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		svc.mu.Lock()
		room := svc.rooms[roomID]
		ok := room != nil && done(room)
		svc.mu.Unlock()
		if ok {
			return room
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("room %s did not reach expected state", roomID)
	return nil
}

func createReadyPrivateRoom(t *testing.T, svc *GeoBattleService) models.GeoBattleRoomSnapshot {
	t.Helper()
	created, err := svc.CreatePrivateRoom("player-a", "  Alice\t")
	if err != nil {
		t.Fatalf("CreatePrivateRoom failed: %v", err)
	}
	if created.Phase != models.GeoBattlePhaseLobby || created.Mode != models.GeoBattleModePrivate {
		t.Fatalf("created room phase=%s mode=%s", created.Phase, created.Mode)
	}
	if created.Me.Nickname != "Alice" || !created.Me.IsHost {
		t.Fatalf("host snapshot = %+v", created.Me)
	}

	joined, err := svc.JoinPrivateRoom("player-b", "Bob", strings.ToLower(created.RoomCode))
	if err != nil {
		t.Fatalf("JoinPrivateRoom failed: %v", err)
	}
	if joined.RoomID != created.RoomID || joined.Opponent == nil || joined.Opponent.Nickname != "Alice" {
		t.Fatalf("joined snapshot = %+v", joined)
	}

	first, err := svc.SetReady(created.RoomID, "player-a", true)
	if err != nil {
		t.Fatalf("SetReady(player-a) failed: %v", err)
	}
	if first.Phase != models.GeoBattlePhaseLobby || !first.Me.IsReady {
		t.Fatalf("after one ready: phase=%s ready=%v", first.Phase, first.Me.IsReady)
	}

	second, err := svc.SetReady(created.RoomID, "player-b", true)
	if err != nil {
		t.Fatalf("SetReady(player-b) failed: %v", err)
	}
	if second.Phase != models.GeoBattlePhasePreparing {
		t.Fatalf("after both ready phase = %s, want preparing", second.Phase)
	}
	return second
}

// newReservoirGeoBattleService makes every random candidate fail so round
// generation falls back to the verified-panorama reservoir seeded here with
// cities that are far apart from each other.
func newReservoirGeoBattleService(t *testing.T) *GeoBattleService {
	t.Helper()
	requireRandomServiceGeoData(t)
	locations, repo := newRandomTestService(t, &randomTestMapProvider{fail: true})
	cities := []struct {
		name     string
		lat, lng float64
	}{
		{"London", 51.5074, -0.1278}, {"Paris", 48.8566, 2.3522}, {"Tokyo", 35.6762, 139.6503},
		{"Sydney", -33.8688, 151.2093}, {"Nairobi", -1.2921, 36.8219}, {"Lima", -12.0464, -77.0428},
		{"Toronto", 43.6532, -79.3832}, {"Cairo", 30.0444, 31.2357}, {"Mumbai", 19.076, 72.8777},
		{"Reykjavik", 64.1466, -21.9426}, {"Santiago", -33.4489, -70.6693}, {"Seoul", 37.5665, 126.978},
	}
	for i, city := range cities {
		loc := models.Location{
			PanoID:           "pano-" + city.name,
			Latitude:         city.lat,
			Longitude:        city.lng,
			FormattedAddress: city.name,
		}
		if err := repo.RecordVisit("seed-"+city.name, loc, models.VisitSourceRandom); err != nil {
			t.Fatalf("seed visit %d: %v", i, err)
		}
	}
	return NewGeoBattleService(locations)
}

func TestGeoBattlePrivateRoomReadyGeneratesRoundsAndCountsDown(t *testing.T) {
	svc := newReservoirGeoBattleService(t)

	snapshot := createReadyPrivateRoom(t, svc)
	room := waitForGeoBattleRoom(t, svc, snapshot.RoomID, func(room *geoBattleRoom) bool {
		return room.Phase == models.GeoBattlePhaseCountdown
	})

	svc.mu.Lock()
	defer svc.mu.Unlock()
	if len(room.Rounds) != models.GeoBattleTotalRounds {
		t.Fatalf("rounds = %d, want %d", len(room.Rounds), models.GeoBattleTotalRounds)
	}
	seen := map[string]bool{}
	for i, round := range room.Rounds {
		if seen[round.Location.PanoID] {
			t.Fatalf("round %d reuses pano %s", i, round.Location.PanoID)
		}
		seen[round.Location.PanoID] = true
		if geoBattleLocationTooClose(round.Location, room.Rounds[:i]) {
			t.Fatalf("round %d is too close to an earlier round", i)
		}
	}
	if room.PrepareCancel != nil {
		t.Fatal("preparation context should be released after rounds are ready")
	}
	for _, player := range room.Players {
		if player.Ready || player.TotalScore != 0 || player.CurrentZoom != models.GeoBattleStartZoom {
			t.Fatalf("player state after preparation = %+v", player)
		}
	}
}

func TestGeoBattlePreparationFailureReturnsToLobby(t *testing.T) {
	svc := newBlockingGeoBattleService()
	snapshot := createReadyPrivateRoom(t, svc)

	svc.mu.Lock()
	svc.rooms[snapshot.RoomID].PrepareCancel()
	svc.mu.Unlock()

	room := waitForGeoBattleRoom(t, svc, snapshot.RoomID, func(room *geoBattleRoom) bool {
		return room.Phase == models.GeoBattlePhaseLobby
	})
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if room.Message != "prepare_failed" {
		t.Fatalf("message = %q, want prepare_failed", room.Message)
	}
	for _, player := range room.Players {
		if player.Ready {
			t.Fatalf("player %s should need to ready again", player.SessionID)
		}
	}
}

func TestGeoBattleSetReadyRejectedOutsideLobby(t *testing.T) {
	svc, room := newTestGeoBattleServiceWithPlayingRoom()
	if _, err := svc.SetReady(room.ID, "player-a", true); err != ErrGeoBattleInvalidPhase {
		t.Fatalf("SetReady during playing error = %v, want ErrGeoBattleInvalidPhase", err)
	}
}

func TestGeoBattlePrivateRoomRejectsThirdPlayerAndBadCodes(t *testing.T) {
	svc := newBlockingGeoBattleService()
	created, err := svc.CreatePrivateRoom("player-a", "A")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinPrivateRoom("player-b", "B", created.RoomCode); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.JoinPrivateRoom("player-c", "C", created.RoomCode); err != ErrGeoBattleRoomFull {
		t.Fatalf("third player error = %v, want ErrGeoBattleRoomFull", err)
	}
	if _, err := svc.JoinPrivateRoom("player-c", "C", "ABC"); err != ErrGeoBattleInvalidCode {
		t.Fatalf("short code error = %v, want ErrGeoBattleInvalidCode", err)
	}
	unknownCode := "ZZZZ22"
	if created.RoomCode == unknownCode {
		unknownCode = "ZZZZ23"
	}
	if _, err := svc.JoinPrivateRoom("player-c", "C", unknownCode); err != ErrGeoBattleRoomNotFound {
		t.Fatalf("unknown code error = %v, want ErrGeoBattleRoomNotFound", err)
	}

	// Creating again while already in a room returns the existing room.
	again, err := svc.CreatePrivateRoom("player-a", "A2")
	if err != nil {
		t.Fatal(err)
	}
	if again.RoomID != created.RoomID || again.Me.Nickname != "A2" {
		t.Fatalf("re-create returned room=%s nickname=%s", again.RoomID, again.Me.Nickname)
	}
}

func TestGeoBattleMatchmakingQueuesThenPairsWithWaitingPlayer(t *testing.T) {
	svc := newBlockingGeoBattleService()

	queued, err := svc.JoinMatchmaking("player-a", "A")
	if err != nil {
		t.Fatal(err)
	}
	if queued.Status != models.GeoBattleQueueQueued || queued.QueuedAt == nil {
		t.Fatalf("first join = %+v, want queued", queued)
	}
	requeued, err := svc.JoinMatchmaking("player-a", "A renamed")
	if err != nil {
		t.Fatal(err)
	}
	if requeued.Status != models.GeoBattleQueueQueued || !requeued.QueuedAt.Equal(*queued.QueuedAt) {
		t.Fatalf("repeat join should keep queue position: %+v", requeued)
	}

	matched, err := svc.JoinMatchmaking("player-b", "B")
	if err != nil {
		t.Fatal(err)
	}
	if matched.Status != models.GeoBattleQueueMatched || matched.Room == nil {
		t.Fatalf("second join = %+v, want matched", matched)
	}
	if matched.Room.Mode != models.GeoBattleModeMatchmaking || matched.Room.Phase != models.GeoBattlePhasePreparing {
		t.Fatalf("matched room mode=%s phase=%s", matched.Room.Mode, matched.Room.Phase)
	}
	if matched.Room.Opponent == nil || matched.Room.Opponent.Nickname != "A renamed" || !matched.Room.Opponent.IsHost {
		t.Fatalf("waiting player should be host opponent: %+v", matched.Room.Opponent)
	}

	status, err := svc.GetMatchmakingStatus("player-a")
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != models.GeoBattleQueueMatched || status.Room == nil || status.Room.RoomID != matched.Room.RoomID {
		t.Fatalf("waiting player status = %+v, want matched into same room", status)
	}
	if err := svc.CancelMatchmaking("player-a"); err != nil {
		t.Fatalf("cancel after match should be a no-op, got %v", err)
	}
	if len(svc.queue) != 0 {
		t.Fatalf("queue should be empty after match, has %d", len(svc.queue))
	}

	if err := svc.LeaveRoom(matched.Room.RoomID, "player-b"); err != nil {
		t.Fatal(err)
	}
}

func TestGeoBattleMatchmakingDropsStaleQueueEntries(t *testing.T) {
	svc := newBlockingGeoBattleService()
	stale := time.Now().Add(-geoBattleQueueTTL - time.Minute)
	svc.queue["player-stale"] = &geoBattleQueueEntry{
		SessionID:  "player-stale",
		Nickname:   "Stale",
		QueuedAt:   stale,
		LastSeenAt: stale,
	}

	snapshot, err := svc.JoinMatchmaking("player-b", "B")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Status != models.GeoBattleQueueQueued {
		t.Fatalf("status = %s, want queued instead of matching a stale entry", snapshot.Status)
	}
	if _, ok := svc.queue["player-stale"]; ok {
		t.Fatal("stale queue entry should be removed")
	}
}

func TestGeoBattleMatchmakingStatusAndCancel(t *testing.T) {
	svc := newBlockingGeoBattleService()

	if err := svc.CancelMatchmaking("player-a"); err != ErrGeoBattleNotQueued {
		t.Fatalf("cancel without queue error = %v, want ErrGeoBattleNotQueued", err)
	}
	if status, _ := svc.GetMatchmakingStatus("player-a"); status.Status != models.GeoBattleQueueIdle {
		t.Fatalf("idle status = %s", status.Status)
	}

	if _, err := svc.JoinMatchmaking("player-a", "A"); err != nil {
		t.Fatal(err)
	}
	if status, _ := svc.GetMatchmakingStatus("player-a"); status.Status != models.GeoBattleQueueQueued {
		t.Fatalf("queued status = %s", status.Status)
	}
	if err := svc.CancelMatchmaking("player-a"); err != nil {
		t.Fatal(err)
	}
	if status, _ := svc.GetMatchmakingStatus("player-a"); status.Status != models.GeoBattleQueueIdle {
		t.Fatalf("status after cancel = %s", status.Status)
	}

	svc.queue["player-a"] = &geoBattleQueueEntry{SessionID: "player-a", LastSeenAt: time.Now().Add(-geoBattleQueueTTL - time.Second)}
	if status, _ := svc.GetMatchmakingStatus("player-a"); status.Status != models.GeoBattleQueueIdle {
		t.Fatalf("expired queue status = %s, want idle", status.Status)
	}
}

func TestGeoBattleMatchmakingRejectsPlayerInPrivateRoom(t *testing.T) {
	svc := newBlockingGeoBattleService()
	if _, err := svc.CreatePrivateRoom("player-a", "A"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.JoinMatchmaking("player-a", "A"); err != ErrGeoBattleAlreadyInRoom {
		t.Fatalf("error = %v, want ErrGeoBattleAlreadyInRoom", err)
	}
}

func TestRandomGeoBattleCodeUsesUnambiguousAlphabet(t *testing.T) {
	for i := 0; i < 200; i++ {
		code, err := randomGeoBattleCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != geoBattleRoomCodeLength {
			t.Fatalf("code %q length = %d", code, len(code))
		}
		if strings.ContainsAny(code, "IO01") {
			t.Fatalf("code %q contains ambiguous characters", code)
		}
		if normalizeGeoBattleRoomCode(code) != code {
			t.Fatalf("generated code %q does not survive normalization", code)
		}
	}
}

func TestNormalizeGeoBattleRoomCode(t *testing.T) {
	cases := map[string]string{
		" abc234 ": "ABC234",
		"ABC23":    "",
		"ABC2345":  "",
		"ABC-23":   "",
		"":         "",
	}
	for input, want := range cases {
		if got := normalizeGeoBattleRoomCode(input); got != want {
			t.Errorf("normalizeGeoBattleRoomCode(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestNormalizeGeoBattleNickname(t *testing.T) {
	if got, err := normalizeGeoBattleNickname("  小\x00明\n "); err != nil || got != "小明" {
		t.Fatalf("control characters: got %q err %v", got, err)
	}
	if got, err := normalizeGeoBattleNickname(strings.Repeat("字", geoBattleMaxNicknameRunes)); err != nil || got == "" {
		t.Fatalf("max-length nickname rejected: %v", err)
	}
	if _, err := normalizeGeoBattleNickname(strings.Repeat("字", geoBattleMaxNicknameRunes+1)); err != ErrGeoBattleInvalidNickname {
		t.Fatalf("too long error = %v", err)
	}
	if _, err := normalizeGeoBattleNickname(" \t\n"); err != ErrGeoBattleInvalidNickname {
		t.Fatalf("blank error = %v", err)
	}
}
