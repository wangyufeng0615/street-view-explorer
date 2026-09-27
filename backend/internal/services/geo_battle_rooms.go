package services

import (
	"fmt"
	"slices"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

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
	if room.Phase == models.GeoBattlePhaseFinished {
		s.resetRoomToLobbyLocked(room, now)
	}

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
	startRoomID := ""

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
		startRoomID = room.ID
		s.enterPreparingLocked(room, prepareToken)
	}

	snapshot := s.snapshotLocked(room, sessionID)
	s.mu.Unlock()

	if startPreparation {
		s.generatePreparedRoundsAsync(startRoomID, prepareToken)
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
	if room.Phase != models.GeoBattlePhasePlaying || room.PhaseDeadlineAt == nil || !time.Now().Before(*room.PhaseDeadlineAt) {
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
	now := time.Now()
	if room.Phase != models.GeoBattlePhasePlaying || room.PhaseDeadlineAt == nil || !now.Before(*room.PhaseDeadlineAt) {
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
		}
		for _, remaining := range room.Players {
			remaining.IsHost = remaining.SessionID == room.HostSessionID
		}
		s.resetRoomToLobbyLocked(room, now)
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
	if room.Phase == models.GeoBattlePhaseLobby ||
		room.Phase == models.GeoBattlePhasePreparing ||
		room.Phase == models.GeoBattlePhaseCountdown {
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
