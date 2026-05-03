package services

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/my-streetview-project/backend/internal/models"
)

var (
	ErrGeoBattleRoomNotFound    = errors.New("geo battle room not found")
	ErrGeoBattleRoomFull        = errors.New("geo battle room full")
	ErrGeoBattleRoomClosed      = errors.New("geo battle room closed")
	ErrGeoBattleNotInRoom       = errors.New("geo battle player not in room")
	ErrGeoBattleInvalidPhase    = errors.New("geo battle invalid phase")
	ErrGeoBattleAlreadyQueued   = errors.New("geo battle already queued")
	ErrGeoBattleNotQueued       = errors.New("geo battle not queued")
	ErrGeoBattleAlreadyGuessed  = errors.New("geo battle already guessed")
	ErrGeoBattleAlreadyInRoom   = errors.New("geo battle already in another room")
	ErrGeoBattleInvalidNickname = errors.New("geo battle invalid nickname")
	ErrGeoBattleInvalidCode     = errors.New("geo battle invalid room code")
	ErrGeoBattleImageNotReady   = errors.New("geo battle image not ready")
)

const (
	geoBattleRoundDuration      = 30 * time.Second
	geoBattleRevealDuration     = 8 * time.Second
	geoBattleCountdownDuration  = 5 * time.Second
	geoBattleQueueTTL           = 10 * time.Minute
	geoBattleRoomTTL            = 45 * time.Minute
	geoBattleLobbyTTL           = 2 * time.Hour
	geoBattleOnlineThreshold    = 25 * time.Second
	geoBattleCleanupInterval    = 1 * time.Minute
	geoBattleRevealZoom         = 5
	geoBattlePerfectDistanceKM  = 1.0
	geoBattleMaxToleranceKM     = 100.0
	geoBattleToleranceGrowth    = 1.45
	geoBattleRoomCodeLength     = 6
	geoBattleMaxNicknameRunes   = 20
	geoBattleMaxRoundGenRetries = 32
	geoBattleMinRoundDistanceKM = 75.0
)

type GeoBattleService struct {
	locationService *LocationService
	mu              sync.Mutex
	rooms           map[string]*geoBattleRoom
	roomCodes       map[string]string
	sessionRooms    map[string]string
	queue           map[string]*geoBattleQueueEntry
}

type geoBattleRoom struct {
	ID              string
	Code            string
	Mode            string
	Phase           string
	Message         string
	HostSessionID   string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	PhaseDeadlineAt *time.Time
	Players         []*geoBattlePlayer
	Rounds          []geoBattleRound
	CurrentRound    int
	ScheduleToken   uint64
	PrepareToken    uint64
}

type geoBattlePlayer struct {
	SessionID    string
	Nickname     string
	IsHost       bool
	Ready        bool
	Left         bool
	TotalScore   int
	LastSeenAt   time.Time
	CurrentZoom  int
	CurrentSteps int
}

type geoBattleRound struct {
	Location models.Location
	Guesses  map[string]*geoBattleGuess
}

type geoBattleGuess struct {
	Lat         *float64
	Lng         *float64
	Skipped     bool
	DistanceKM  *float64
	Score       int
	ZoomSteps   int
	SubmittedAt time.Time
}

type geoBattleQueueEntry struct {
	SessionID  string
	Nickname   string
	QueuedAt   time.Time
	LastSeenAt time.Time
}

func NewGeoBattleService(locationService *LocationService) *GeoBattleService {
	svc := &GeoBattleService{
		locationService: locationService,
		rooms:           make(map[string]*geoBattleRoom),
		roomCodes:       make(map[string]string),
		sessionRooms:    make(map[string]string),
		queue:           make(map[string]*geoBattleQueueEntry),
	}

	go svc.cleanupLoop()
	return svc
}

func (s *GeoBattleService) CreatePrivateRoom(sessionID, nickname string) (models.GeoBattleRoomSnapshot, error) {
	nickname, err := normalizeGeoBattleNickname(nickname)
	if err != nil {
		return models.GeoBattleRoomSnapshot{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if room := s.activeRoomForSessionLocked(sessionID); room != nil {
		if player := s.playerBySessionLocked(room, sessionID); player != nil {
			player.Nickname = nickname
		}
		s.touchRoomPlayerLocked(room, sessionID)
		return s.snapshotLocked(room, sessionID), nil
	}

	delete(s.queue, sessionID)

	roomID, err := newGeoBattleRoomID()
	if err != nil {
		return models.GeoBattleRoomSnapshot{}, err
	}

	code, err := s.newRoomCodeLocked()
	if err != nil {
		return models.GeoBattleRoomSnapshot{}, err
	}

	now := time.Now()
	room := &geoBattleRoom{
		ID:            roomID,
		Code:          code,
		Mode:          models.GeoBattleModePrivate,
		Phase:         models.GeoBattlePhaseLobby,
		HostSessionID: sessionID,
		CreatedAt:     now,
		UpdatedAt:     now,
		Players: []*geoBattlePlayer{
			{
				SessionID:   sessionID,
				Nickname:    nickname,
				IsHost:      true,
				LastSeenAt:  now,
				CurrentZoom: models.GeoBattleStartZoom,
			},
		},
	}

	s.rooms[room.ID] = room
	s.roomCodes[code] = room.ID
	s.sessionRooms[sessionID] = room.ID

	return s.snapshotLocked(room, sessionID), nil
}

func (s *GeoBattleService) JoinPrivateRoom(sessionID, nickname, code string) (models.GeoBattleRoomSnapshot, error) {
	nickname, err := normalizeGeoBattleNickname(nickname)
	if err != nil {
		return models.GeoBattleRoomSnapshot{}, err
	}
	code = normalizeGeoBattleRoomCode(code)
	if code == "" {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleInvalidCode
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if room := s.activeRoomForSessionLocked(sessionID); room != nil {
		if player := s.playerBySessionLocked(room, sessionID); player != nil {
			player.Nickname = nickname
		}
		s.touchRoomPlayerLocked(room, sessionID)
		return s.snapshotLocked(room, sessionID), nil
	}

	delete(s.queue, sessionID)

	roomID, ok := s.roomCodes[code]
	if !ok {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleRoomNotFound
	}

	room, ok := s.rooms[roomID]
	if !ok {
		delete(s.roomCodes, code)
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleRoomNotFound
	}

	if room.Mode != models.GeoBattleModePrivate {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleRoomClosed
	}
	if room.Phase != models.GeoBattlePhaseLobby && room.Phase != models.GeoBattlePhaseFinished {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleRoomClosed
	}

	if existing := s.playerBySessionLocked(room, sessionID); existing != nil {
		existing.Nickname = nickname
		s.touchRoomPlayerLocked(room, sessionID)
		return s.snapshotLocked(room, sessionID), nil
	}

	if s.activePlayerCountLocked(room) >= 2 {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleRoomFull
	}

	now := time.Now()
	room.Players = append(room.Players, &geoBattlePlayer{
		SessionID:   sessionID,
		Nickname:    nickname,
		LastSeenAt:  now,
		CurrentZoom: models.GeoBattleStartZoom,
	})
	room.UpdatedAt = now
	s.sessionRooms[sessionID] = room.ID

	return s.snapshotLocked(room, sessionID), nil
}

func (s *GeoBattleService) JoinMatchmaking(sessionID, nickname string) (models.GeoBattleMatchmakingSnapshot, error) {
	nickname, err := normalizeGeoBattleNickname(nickname)
	if err != nil {
		return models.GeoBattleMatchmakingSnapshot{}, err
	}

	s.mu.Lock()
	startRoomID := ""

	if room := s.activeRoomForSessionLocked(sessionID); room != nil {
		if room.Mode != models.GeoBattleModeMatchmaking {
			s.mu.Unlock()
			return models.GeoBattleMatchmakingSnapshot{}, ErrGeoBattleAlreadyInRoom
		}
		if player := s.playerBySessionLocked(room, sessionID); player != nil {
			player.Nickname = nickname
		}
		s.touchRoomPlayerLocked(room, sessionID)
		snapshot := s.snapshotLocked(room, sessionID)
		s.mu.Unlock()
		return models.GeoBattleMatchmakingSnapshot{
			Status: models.GeoBattleQueueMatched,
			Room:   ptrGeoBattleRoomSnapshot(snapshot),
		}, nil
	}

	now := time.Now()
	if entry, ok := s.queue[sessionID]; ok {
		entry.Nickname = nickname
		entry.LastSeenAt = now
		s.mu.Unlock()
		return models.GeoBattleMatchmakingSnapshot{
			Status:   models.GeoBattleQueueQueued,
			QueuedAt: &entry.QueuedAt,
		}, nil
	}

	var opponent *geoBattleQueueEntry
	for _, entry := range s.queue {
		if entry.SessionID == sessionID {
			continue
		}
		if now.Sub(entry.LastSeenAt) > geoBattleQueueTTL {
			delete(s.queue, entry.SessionID)
			continue
		}
		if s.activeRoomForSessionLocked(entry.SessionID) != nil {
			delete(s.queue, entry.SessionID)
			continue
		}
		if opponent == nil || entry.QueuedAt.Before(opponent.QueuedAt) {
			opponent = entry
		}
	}

	if opponent == nil {
		s.queue[sessionID] = &geoBattleQueueEntry{
			SessionID:  sessionID,
			Nickname:   nickname,
			QueuedAt:   now,
			LastSeenAt: now,
		}
		s.mu.Unlock()
		return models.GeoBattleMatchmakingSnapshot{
			Status:   models.GeoBattleQueueQueued,
			QueuedAt: &now,
		}, nil
	}

	delete(s.queue, opponent.SessionID)

	roomID, err := newGeoBattleRoomID()
	if err != nil {
		return models.GeoBattleMatchmakingSnapshot{}, err
	}

	room := &geoBattleRoom{
		ID:        roomID,
		Mode:      models.GeoBattleModeMatchmaking,
		Phase:     models.GeoBattlePhasePreparing,
		CreatedAt: now,
		UpdatedAt: now,
		Players: []*geoBattlePlayer{
			{
				SessionID:   opponent.SessionID,
				Nickname:    opponent.Nickname,
				IsHost:      true,
				Ready:       true,
				LastSeenAt:  opponent.LastSeenAt,
				CurrentZoom: models.GeoBattleStartZoom,
			},
			{
				SessionID:   sessionID,
				Nickname:    nickname,
				Ready:       true,
				LastSeenAt:  now,
				CurrentZoom: models.GeoBattleStartZoom,
			},
		},
	}

	s.rooms[room.ID] = room
	s.sessionRooms[opponent.SessionID] = room.ID
	s.sessionRooms[sessionID] = room.ID
	startRoomID = room.ID
	snapshot := s.snapshotLocked(room, sessionID)
	s.mu.Unlock()

	s.startPreparationAsync(startRoomID, 1)

	return models.GeoBattleMatchmakingSnapshot{
		Status: models.GeoBattleQueueMatched,
		Room:   ptrGeoBattleRoomSnapshot(snapshot),
	}, nil
}

func (s *GeoBattleService) GetMatchmakingStatus(sessionID string) (models.GeoBattleMatchmakingSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if room := s.activeRoomForSessionLocked(sessionID); room != nil && room.Mode == models.GeoBattleModeMatchmaking {
		s.touchRoomPlayerLocked(room, sessionID)
		return models.GeoBattleMatchmakingSnapshot{
			Status: models.GeoBattleQueueMatched,
			Room:   ptrGeoBattleRoomSnapshot(s.snapshotLocked(room, sessionID)),
		}, nil
	}

	if entry, ok := s.queue[sessionID]; ok {
		now := time.Now()
		if now.Sub(entry.LastSeenAt) > geoBattleQueueTTL {
			delete(s.queue, sessionID)
			return models.GeoBattleMatchmakingSnapshot{Status: models.GeoBattleQueueIdle}, nil
		}
		entry.LastSeenAt = now
		return models.GeoBattleMatchmakingSnapshot{
			Status:   models.GeoBattleQueueQueued,
			QueuedAt: &entry.QueuedAt,
		}, nil
	}

	return models.GeoBattleMatchmakingSnapshot{Status: models.GeoBattleQueueIdle}, nil
}

func (s *GeoBattleService) CancelMatchmaking(sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.queue[sessionID]; !ok {
		if room := s.activeRoomForSessionLocked(sessionID); room != nil && room.Mode == models.GeoBattleModeMatchmaking {
			return nil
		}
		return ErrGeoBattleNotQueued
	}

	delete(s.queue, sessionID)
	return nil
}

func (s *GeoBattleService) GetRoomSnapshot(roomID, sessionID string) (models.GeoBattleRoomSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	room, err := s.roomForSessionLocked(roomID, sessionID)
	if err != nil {
		return models.GeoBattleRoomSnapshot{}, err
	}

	s.touchRoomPlayerLocked(room, sessionID)
	return s.snapshotLocked(room, sessionID), nil
}

func (s *GeoBattleService) SetReady(roomID, sessionID string, ready bool) (models.GeoBattleRoomSnapshot, error) {
	s.mu.Lock()
	startPreparation := false
	prepareToken := uint64(0)

	room, err := s.roomForSessionLocked(roomID, sessionID)
	if err != nil {
		s.mu.Unlock()
		return models.GeoBattleRoomSnapshot{}, err
	}
	if room.Phase != models.GeoBattlePhaseLobby && room.Phase != models.GeoBattlePhaseFinished {
		s.mu.Unlock()
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleInvalidPhase
	}

	player := s.playerBySessionLocked(room, sessionID)
	player.Ready = ready
	player.LastSeenAt = time.Now()
	room.Message = ""
	room.UpdatedAt = player.LastSeenAt

	if s.activePlayerCountLocked(room) == 2 && s.everyActivePlayerReadyLocked(room) {
		startPreparation = true
		prepareToken = room.PrepareToken + 1
	}

	snapshot := s.snapshotLocked(room, sessionID)
	s.mu.Unlock()

	if startPreparation {
		s.startPreparationAsync(room.ID, prepareToken)
	}

	return snapshot, nil
}

func (s *GeoBattleService) ZoomOut(roomID, sessionID string) (models.GeoBattleRoomSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	room, err := s.roomForSessionLocked(roomID, sessionID)
	if err != nil {
		return models.GeoBattleRoomSnapshot{}, err
	}
	if room.Phase != models.GeoBattlePhasePlaying {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleInvalidPhase
	}

	player := s.playerBySessionLocked(room, sessionID)
	if player == nil || player.Left {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleNotInRoom
	}
	if s.currentGuessLocked(room, sessionID) != nil {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleAlreadyGuessed
	}
	if player.CurrentZoom <= models.GeoBattleMinZoom {
		return s.snapshotLocked(room, sessionID), nil
	}

	player.CurrentZoom--
	player.CurrentSteps++
	player.LastSeenAt = time.Now()
	room.UpdatedAt = player.LastSeenAt

	return s.snapshotLocked(room, sessionID), nil
}

func (s *GeoBattleService) SubmitGuess(roomID, sessionID string, lat, lng *float64, skipped bool) (models.GeoBattleRoomSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	room, err := s.roomForSessionLocked(roomID, sessionID)
	if err != nil {
		return models.GeoBattleRoomSnapshot{}, err
	}
	if room.Phase != models.GeoBattlePhasePlaying {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleInvalidPhase
	}

	player := s.playerBySessionLocked(room, sessionID)
	if player == nil || player.Left {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleNotInRoom
	}
	if s.currentGuessLocked(room, sessionID) != nil {
		return models.GeoBattleRoomSnapshot{}, ErrGeoBattleAlreadyGuessed
	}
	if !skipped {
		if lat == nil || lng == nil || *lat < -90 || *lat > 90 || *lng < -180 || *lng > 180 {
			return models.GeoBattleRoomSnapshot{}, fmt.Errorf("invalid guess coordinates")
		}
	}

	round := &room.Rounds[room.CurrentRound]
	now := time.Now()
	guess := &geoBattleGuess{
		Skipped:     skipped,
		ZoomSteps:   player.CurrentSteps,
		SubmittedAt: now,
	}
	if !skipped {
		guess.Lat = lat
		guess.Lng = lng
		distance := geoBattleHaversineDistance(*lat, *lng, round.Location.Latitude, round.Location.Longitude)
		guess.DistanceKM = &distance
		guess.Score = geoBattleCalculateScore(player.CurrentSteps, distance)
		player.TotalScore += guess.Score
	}

	player.LastSeenAt = now
	round.Guesses[sessionID] = guess
	room.UpdatedAt = now

	if s.everyActivePlayerSubmittedLocked(room) {
		s.enterRevealLocked(room, "")
	}

	return s.snapshotLocked(room, sessionID), nil
}

func (s *GeoBattleService) LeaveRoom(roomID, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	room, err := s.roomForSessionLocked(roomID, sessionID)
	if err != nil {
		return err
	}

	player := s.playerBySessionLocked(room, sessionID)
	if player == nil {
		return ErrGeoBattleNotInRoom
	}

	delete(s.sessionRooms, sessionID)
	now := time.Now()

	if room.Phase == models.GeoBattlePhaseLobby || room.Phase == models.GeoBattlePhaseFinished {
		idx := slices.IndexFunc(room.Players, func(candidate *geoBattlePlayer) bool {
			return candidate.SessionID == sessionID
		})
		if idx >= 0 {
			room.Players = append(room.Players[:idx], room.Players[idx+1:]...)
		}
		if len(room.Players) == 0 {
			s.deleteRoomLocked(room.ID)
			return nil
		}
		room.UpdatedAt = now
		if room.HostSessionID == sessionID {
			room.HostSessionID = room.Players[0].SessionID
			room.Players[0].IsHost = true
		}
		for _, remaining := range room.Players {
			remaining.Ready = false
			if remaining.SessionID == room.HostSessionID {
				remaining.IsHost = true
			}
		}
		room.Phase = models.GeoBattlePhaseLobby
		room.PhaseDeadlineAt = nil
		room.Message = ""
		return nil
	}

	player.Left = true
	player.LastSeenAt = now
	room.Message = "player_left:" + player.Nickname
	s.finishRoomLocked(room)
	return nil
}

func (s *GeoBattleService) GetImageSpec(roomID, sessionID string) (float64, float64, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	room, err := s.roomForSessionLocked(roomID, sessionID)
	if err != nil {
		return 0, 0, 0, err
	}
	if len(room.Rounds) == 0 || room.CurrentRound >= len(room.Rounds) {
		return 0, 0, 0, ErrGeoBattleImageNotReady
	}
	if room.Phase == models.GeoBattlePhaseLobby || room.Phase == models.GeoBattlePhasePreparing {
		return 0, 0, 0, ErrGeoBattleImageNotReady
	}

	player := s.playerBySessionLocked(room, sessionID)
	if player == nil || player.Left {
		return 0, 0, 0, ErrGeoBattleNotInRoom
	}

	zoom := player.CurrentZoom
	if room.Phase == models.GeoBattlePhaseReveal || room.Phase == models.GeoBattlePhaseFinished {
		zoom = min(zoom, geoBattleRevealZoom)
	}

	round := room.Rounds[room.CurrentRound]
	player.LastSeenAt = time.Now()
	room.UpdatedAt = player.LastSeenAt
	return round.Location.Latitude, round.Location.Longitude, zoom, nil
}

func (s *GeoBattleService) cleanupLoop() {
	ticker := time.NewTicker(geoBattleCleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()
		now := time.Now()

		for sessionID, entry := range s.queue {
			if now.Sub(entry.LastSeenAt) > geoBattleQueueTTL {
				delete(s.queue, sessionID)
			}
		}

		for roomID, room := range s.rooms {
			if len(room.Players) == 0 {
				s.deleteRoomLocked(roomID)
				continue
			}
			if room.Phase == models.GeoBattlePhaseFinished {
				if now.Sub(room.UpdatedAt) > geoBattleRoomTTL {
					s.deleteRoomLocked(roomID)
				}
				continue
			}
			if room.Phase == models.GeoBattlePhaseLobby && now.Sub(room.UpdatedAt) > geoBattleLobbyTTL {
				s.deleteRoomLocked(roomID)
			}
		}

		s.mu.Unlock()
	}
}

func (s *GeoBattleService) startPreparationAsync(roomID string, token uint64) {
	s.mu.Lock()
	room, ok := s.rooms[roomID]
	if !ok {
		s.mu.Unlock()
		return
	}
	room.PrepareToken = token
	room.ScheduleToken++
	room.Phase = models.GeoBattlePhasePreparing
	room.PhaseDeadlineAt = nil
	room.Message = ""
	room.UpdatedAt = time.Now()
	s.mu.Unlock()

	go func(expectedToken uint64) {
		rounds, err := s.generateRounds()

		s.mu.Lock()
		defer s.mu.Unlock()

		room, ok := s.rooms[roomID]
		if !ok || room.PrepareToken != expectedToken || room.Phase != models.GeoBattlePhasePreparing {
			return
		}

		if err != nil {
			room.Phase = models.GeoBattlePhaseLobby
			room.Message = "prepare_failed"
			room.UpdatedAt = time.Now()
			room.PhaseDeadlineAt = nil
			for _, player := range room.Players {
				if player.Left {
					continue
				}
				player.Ready = false
			}
			return
		}

		room.Rounds = rounds
		room.CurrentRound = 0
		for _, player := range room.Players {
			if player.Left {
				continue
			}
			player.TotalScore = 0
			player.CurrentZoom = models.GeoBattleStartZoom
			player.CurrentSteps = 0
			player.Ready = false
		}

		s.enterCountdownLocked(room, "")
	}(token)
}

func (s *GeoBattleService) generateRounds() ([]geoBattleRound, error) {
	rounds := make([]geoBattleRound, 0, models.GeoBattleTotalRounds)
	seenPanoIDs := make(map[string]struct{})

	for len(rounds) < models.GeoBattleTotalRounds {
		var (
			loc models.Location
			err error
		)
		for attempt := 0; attempt < geoBattleMaxRoundGenRetries; attempt++ {
			loc, err = s.locationService.GetRandomLocation("", "en")
			if err != nil {
				continue
			}
			if loc.PanoID != "" {
				if _, exists := seenPanoIDs[loc.PanoID]; exists {
					err = fmt.Errorf("duplicate pano")
					continue
				}
			}
			if geoBattleLocationTooClose(loc, rounds) {
				err = fmt.Errorf("nearby round location")
				continue
			}
			if loc.PanoID != "" {
				seenPanoIDs[loc.PanoID] = struct{}{}
			}
			break
		}
		if err != nil {
			return nil, err
		}

		rounds = append(rounds, geoBattleRound{
			Location: loc,
			Guesses:  make(map[string]*geoBattleGuess),
		})
	}

	return rounds, nil
}

func geoBattleLocationTooClose(loc models.Location, rounds []geoBattleRound) bool {
	for _, round := range rounds {
		distance := geoBattleHaversineDistance(
			loc.Latitude,
			loc.Longitude,
			round.Location.Latitude,
			round.Location.Longitude,
		)
		if distance < geoBattleMinRoundDistanceKM {
			return true
		}
	}
	return false
}

func (s *GeoBattleService) enterCountdownLocked(room *geoBattleRoom, message string) {
	now := time.Now()
	deadline := now.Add(geoBattleCountdownDuration)

	room.Phase = models.GeoBattlePhaseCountdown
	room.PhaseDeadlineAt = &deadline
	room.Message = message
	room.UpdatedAt = now
	room.ScheduleToken++

	for _, player := range room.Players {
		if player.Left {
			continue
		}
		player.CurrentZoom = models.GeoBattleStartZoom
		player.CurrentSteps = 0
	}

	token := room.ScheduleToken
	roomID := room.ID
	go func() {
		time.Sleep(time.Until(deadline))
		s.mu.Lock()
		defer s.mu.Unlock()

		room, ok := s.rooms[roomID]
		if !ok || room.ScheduleToken != token || room.Phase != models.GeoBattlePhaseCountdown {
			return
		}
		s.enterPlayingLocked(room)
	}()
}

func (s *GeoBattleService) enterPlayingLocked(room *geoBattleRoom) {
	now := time.Now()
	deadline := now.Add(geoBattleRoundDuration)
	room.Phase = models.GeoBattlePhasePlaying
	room.PhaseDeadlineAt = &deadline
	room.Message = ""
	room.UpdatedAt = now
	room.ScheduleToken++

	token := room.ScheduleToken
	roomID := room.ID
	go func() {
		time.Sleep(time.Until(deadline))
		s.mu.Lock()
		defer s.mu.Unlock()

		room, ok := s.rooms[roomID]
		if !ok || room.ScheduleToken != token || room.Phase != models.GeoBattlePhasePlaying {
			return
		}
		s.enterRevealLocked(room, "time_up")
	}()
}

func (s *GeoBattleService) enterRevealLocked(room *geoBattleRoom, message string) {
	round := &room.Rounds[room.CurrentRound]
	now := time.Now()
	for _, player := range room.Players {
		if player.Left {
			continue
		}
		if _, ok := round.Guesses[player.SessionID]; ok {
			continue
		}
		round.Guesses[player.SessionID] = &geoBattleGuess{
			Skipped:     true,
			ZoomSteps:   player.CurrentSteps,
			SubmittedAt: now,
		}
	}

	deadline := now.Add(geoBattleRevealDuration)
	room.Phase = models.GeoBattlePhaseReveal
	room.PhaseDeadlineAt = &deadline
	room.Message = message
	room.UpdatedAt = now
	room.ScheduleToken++

	token := room.ScheduleToken
	roomID := room.ID
	go func() {
		time.Sleep(time.Until(deadline))
		s.mu.Lock()
		defer s.mu.Unlock()

		room, ok := s.rooms[roomID]
		if !ok || room.ScheduleToken != token || room.Phase != models.GeoBattlePhaseReveal {
			return
		}
		if room.CurrentRound >= len(room.Rounds)-1 {
			s.finishRoomLocked(room)
			return
		}
		room.CurrentRound++
		s.enterCountdownLocked(room, "")
	}()
}

func (s *GeoBattleService) finishRoomLocked(room *geoBattleRoom) {
	room.Phase = models.GeoBattlePhaseFinished
	room.PhaseDeadlineAt = nil
	room.UpdatedAt = time.Now()
	room.ScheduleToken++
}

func (s *GeoBattleService) snapshotLocked(room *geoBattleRoom, sessionID string) models.GeoBattleRoomSnapshot {
	now := time.Now()
	player := s.playerBySessionLocked(room, sessionID)
	opponent := s.opponentBySessionLocked(room, sessionID)

	snapshot := models.GeoBattleRoomSnapshot{
		RoomID:          room.ID,
		RoomCode:        room.Code,
		Mode:            room.Mode,
		Phase:           room.Phase,
		Message:         room.Message,
		CreatedAt:       room.CreatedAt,
		UpdatedAt:       room.UpdatedAt,
		ServerTime:      now,
		PhaseDeadlineAt: room.PhaseDeadlineAt,
		CanReady:        (room.Phase == models.GeoBattlePhaseLobby || room.Phase == models.GeoBattlePhaseFinished) && player != nil && !player.Left && opponent != nil && !opponent.Left,
		CanZoomOut:      room.Phase == models.GeoBattlePhasePlaying && player != nil && !player.Left && player.CurrentZoom > models.GeoBattleMinZoom && s.currentGuessLocked(room, sessionID) == nil,
		CanSubmitGuess:  room.Phase == models.GeoBattlePhasePlaying && player != nil && !player.Left && s.currentGuessLocked(room, sessionID) == nil,
		CanLeave:        true,
	}

	if player != nil {
		snapshot.Me = models.GeoBattlePlayerSnapshot{
			Nickname:              player.Nickname,
			IsHost:                player.IsHost,
			IsReady:               player.Ready,
			IsOnline:              now.Sub(player.LastSeenAt) <= geoBattleOnlineThreshold,
			HasSubmittedThisRound: s.currentGuessLocked(room, sessionID) != nil,
			TotalScore:            player.TotalScore,
			Left:                  player.Left,
		}
	}

	if opponent != nil {
		snapshot.Opponent = &models.GeoBattlePlayerSnapshot{
			Nickname:              opponent.Nickname,
			IsHost:                opponent.IsHost,
			IsReady:               opponent.Ready,
			IsOnline:              now.Sub(opponent.LastSeenAt) <= geoBattleOnlineThreshold,
			HasSubmittedThisRound: s.currentGuessLocked(room, opponent.SessionID) != nil,
			TotalScore:            opponent.TotalScore,
			Left:                  opponent.Left,
		}
	}

	if len(room.Rounds) > 0 && room.CurrentRound < len(room.Rounds) {
		includeResults := room.Phase == models.GeoBattlePhaseReveal || room.Phase == models.GeoBattlePhaseFinished
		roundSnapshot := s.roundSnapshotLocked(room, room.CurrentRound, player, opponent, includeResults)
		snapshot.Round = roundSnapshot

		if includeResults {
			lastRound := room.CurrentRound
			if room.Phase == models.GeoBattlePhaseFinished {
				lastRound = len(room.Rounds) - 1
			}
			snapshot.Rounds = make([]models.GeoBattleRoundSnapshot, 0, lastRound+1)
			for index := 0; index <= lastRound; index++ {
				if index >= len(room.Rounds) {
					break
				}
				if room.roundFinishedLocked(index) {
					snapshot.Rounds = append(
						snapshot.Rounds,
						*s.roundSnapshotLocked(room, index, player, opponent, true),
					)
				}
			}
		}
	}

	if room.Phase == models.GeoBattlePhaseLobby && s.activePlayerCountLocked(room) < 2 {
		snapshot.CanReady = false
	}

	return snapshot
}

func (room *geoBattleRoom) roundFinishedLocked(index int) bool {
	if index < 0 || index >= len(room.Rounds) {
		return false
	}
	if room.Phase == models.GeoBattlePhaseFinished {
		return true
	}
	return index < room.CurrentRound || room.Phase == models.GeoBattlePhaseReveal
}

func (s *GeoBattleService) roundSnapshotLocked(room *geoBattleRoom, index int, player, opponent *geoBattlePlayer, includeResults bool) *models.GeoBattleRoundSnapshot {
	round := room.Rounds[index]
	roundSnapshot := &models.GeoBattleRoundSnapshot{
		Index:       index + 1,
		Total:       len(room.Rounds),
		CurrentZoom: models.GeoBattleStartZoom,
		MinZoom:     models.GeoBattleMinZoom,
	}

	if opponent != nil {
		roundSnapshot.OpponentLocked = round.Guesses[opponent.SessionID] != nil
	}

	if player != nil {
		if index == room.CurrentRound && room.Phase == models.GeoBattlePhasePlaying {
			roundSnapshot.CurrentZoom = player.CurrentZoom
			roundSnapshot.ZoomSteps = player.CurrentSteps
		}
		if guess := round.Guesses[player.SessionID]; guess != nil {
			roundSnapshot.MyGuess = geoBattleGuessSnapshotFromInternal(guess)
			roundSnapshot.ZoomSteps = guess.ZoomSteps
			roundSnapshot.CurrentZoom = max(models.GeoBattleMinZoom, models.GeoBattleStartZoom-guess.ZoomSteps)
		}
	}

	if includeResults && opponent != nil {
		if guess := round.Guesses[opponent.SessionID]; guess != nil {
			roundSnapshot.OpponentGuess = geoBattleGuessSnapshotFromInternal(guess)
		}
	}

	if includeResults {
		roundSnapshot.Target = &models.GeoBattleTargetSnapshot{
			Lat:              round.Location.Latitude,
			Lng:              round.Location.Longitude,
			FormattedAddress: round.Location.FormattedAddress,
			Country:          round.Location.Country,
		}
	}

	return roundSnapshot
}

func (s *GeoBattleService) activeRoomForSessionLocked(sessionID string) *geoBattleRoom {
	roomID, ok := s.sessionRooms[sessionID]
	if !ok {
		return nil
	}
	room, ok := s.rooms[roomID]
	if !ok {
		delete(s.sessionRooms, sessionID)
		return nil
	}
	if s.playerBySessionLocked(room, sessionID) == nil {
		delete(s.sessionRooms, sessionID)
		return nil
	}
	return room
}

func (s *GeoBattleService) roomForSessionLocked(roomID, sessionID string) (*geoBattleRoom, error) {
	room, ok := s.rooms[roomID]
	if !ok {
		return nil, ErrGeoBattleRoomNotFound
	}
	if s.playerBySessionLocked(room, sessionID) == nil {
		return nil, ErrGeoBattleNotInRoom
	}
	return room, nil
}

func (s *GeoBattleService) playerBySessionLocked(room *geoBattleRoom, sessionID string) *geoBattlePlayer {
	for _, player := range room.Players {
		if player.SessionID == sessionID {
			return player
		}
	}
	return nil
}

func (s *GeoBattleService) opponentBySessionLocked(room *geoBattleRoom, sessionID string) *geoBattlePlayer {
	for _, player := range room.Players {
		if player.SessionID != sessionID {
			return player
		}
	}
	return nil
}

func (s *GeoBattleService) currentGuessLocked(room *geoBattleRoom, sessionID string) *geoBattleGuess {
	if len(room.Rounds) == 0 || room.CurrentRound >= len(room.Rounds) {
		return nil
	}
	return room.Rounds[room.CurrentRound].Guesses[sessionID]
}

func (s *GeoBattleService) everyActivePlayerReadyLocked(room *geoBattleRoom) bool {
	count := 0
	for _, player := range room.Players {
		if player.Left {
			continue
		}
		count++
		if !player.Ready {
			return false
		}
	}
	return count == 2
}

func (s *GeoBattleService) everyActivePlayerSubmittedLocked(room *geoBattleRoom) bool {
	round := &room.Rounds[room.CurrentRound]
	count := 0
	for _, player := range room.Players {
		if player.Left {
			continue
		}
		count++
		if _, ok := round.Guesses[player.SessionID]; !ok {
			return false
		}
	}
	return count > 0
}

func (s *GeoBattleService) activePlayerCountLocked(room *geoBattleRoom) int {
	count := 0
	for _, player := range room.Players {
		if !player.Left {
			count++
		}
	}
	return count
}

func (s *GeoBattleService) touchRoomPlayerLocked(room *geoBattleRoom, sessionID string) {
	if player := s.playerBySessionLocked(room, sessionID); player != nil {
		player.LastSeenAt = time.Now()
		room.UpdatedAt = player.LastSeenAt
	}
}

func (s *GeoBattleService) deleteRoomLocked(roomID string) {
	room, ok := s.rooms[roomID]
	if !ok {
		return
	}
	if room.Code != "" {
		delete(s.roomCodes, room.Code)
	}
	for _, player := range room.Players {
		if currentRoomID, ok := s.sessionRooms[player.SessionID]; ok && currentRoomID == roomID {
			delete(s.sessionRooms, player.SessionID)
		}
	}
	delete(s.rooms, roomID)
}

func (s *GeoBattleService) newRoomCodeLocked() (string, error) {
	for i := 0; i < 10; i++ {
		code, err := randomGeoBattleCode()
		if err != nil {
			return "", err
		}
		if _, exists := s.roomCodes[code]; !exists {
			return code, nil
		}
	}
	return "", fmt.Errorf("failed to allocate room code")
}

func newGeoBattleRoomID() (string, error) {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "room_" + hex.EncodeToString(buf), nil
}

func randomGeoBattleCode() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	buf := make([]byte, geoBattleRoomCodeLength)
	randBytes := make([]byte, geoBattleRoomCodeLength)
	if _, err := rand.Read(randBytes); err != nil {
		return "", err
	}
	for i := range buf {
		buf[i] = alphabet[int(randBytes[i])%len(alphabet)]
	}
	return string(buf), nil
}

func normalizeGeoBattleRoomCode(code string) string {
	code = strings.TrimSpace(strings.ToUpper(code))
	if len(code) != geoBattleRoomCodeLength {
		return ""
	}
	for _, r := range code {
		if !unicode.IsDigit(r) && (r < 'A' || r > 'Z') {
			return ""
		}
	}
	return code
}

func normalizeGeoBattleNickname(nickname string) (string, error) {
	nickname = strings.TrimSpace(nickname)
	nickname = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return -1
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, nickname)
	if nickname == "" || utf8.RuneCountInString(nickname) > geoBattleMaxNicknameRunes {
		return "", ErrGeoBattleInvalidNickname
	}
	return nickname, nil
}

func geoBattleHaversineDistance(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKM = 6371
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthRadiusKM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func geoBattleCalculateScore(zoomSteps int, distanceKM float64) int {
	steps := max(0, zoomSteps)
	zoomFactor := math.Exp(-float64(steps) * 0.12)
	effectiveDistanceKM := math.Max(0, distanceKM-geoBattleGuessToleranceKM(steps))
	distanceFactor := math.Exp(-effectiveDistanceKM / 1500)
	return int(math.Round(5000 * zoomFactor * distanceFactor))
}

func geoBattleGuessToleranceKM(zoomSteps int) float64 {
	zoomSteps = max(0, zoomSteps)
	tolerance := geoBattlePerfectDistanceKM * math.Pow(geoBattleToleranceGrowth, float64(zoomSteps))
	return math.Min(geoBattleMaxToleranceKM, tolerance)
}

func geoBattleGuessSnapshotFromInternal(guess *geoBattleGuess) *models.GeoBattleGuessSnapshot {
	if guess == nil {
		return nil
	}
	return &models.GeoBattleGuessSnapshot{
		Lat:         guess.Lat,
		Lng:         guess.Lng,
		Skipped:     guess.Skipped,
		DistanceKM:  guess.DistanceKM,
		Score:       guess.Score,
		ZoomSteps:   guess.ZoomSteps,
		SubmittedAt: guess.SubmittedAt,
	}
}

func ptrGeoBattleRoomSnapshot(snapshot models.GeoBattleRoomSnapshot) *models.GeoBattleRoomSnapshot {
	return &snapshot
}
