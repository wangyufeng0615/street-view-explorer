package services

import (
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

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

// opponentBySessionLocked prefers a player still in the room. A departed
// player is only returned when nobody else is left, so a finished match can
// still show who walked out.
func (s *GeoBattleService) opponentBySessionLocked(room *geoBattleRoom, sessionID string) *geoBattlePlayer {
	var departed *geoBattlePlayer
	for _, player := range room.Players {
		if player.SessionID == sessionID {
			continue
		}
		if !player.Left {
			return player
		}
		if departed == nil {
			departed = player
		}
	}
	return departed
}

// removeDepartedPlayersLocked drops players who left mid-match before a room is
// reused, so they can neither appear as the opponent nor keep the host role.
func (s *GeoBattleService) removeDepartedPlayersLocked(room *geoBattleRoom) {
	remaining := make([]*geoBattlePlayer, 0, len(room.Players))
	for _, player := range room.Players {
		if !player.Left {
			remaining = append(remaining, player)
			continue
		}
		if currentRoomID, ok := s.sessionRooms[player.SessionID]; ok && currentRoomID == room.ID {
			delete(s.sessionRooms, player.SessionID)
		}
	}
	room.Players = remaining
	s.reassignHostLocked(room)
}

func (s *GeoBattleService) reassignHostLocked(room *geoBattleRoom) {
	if len(room.Players) == 0 {
		return
	}
	if s.playerBySessionLocked(room, room.HostSessionID) == nil {
		room.HostSessionID = room.Players[0].SessionID
	}
	for _, player := range room.Players {
		player.IsHost = player.SessionID == room.HostSessionID
	}
}

// releaseFinishedMatchmakingLocked takes a session out of a finished random
// match. A matchmaking room is never refilled, so returning to the lobby must
// start fresh instead of reopening the old result screen.
func (s *GeoBattleService) releaseFinishedMatchmakingLocked(sessionID string) {
	room := s.activeRoomForSessionLocked(sessionID)
	if room == nil || room.Mode != models.GeoBattleModeMatchmaking || room.Phase != models.GeoBattlePhaseFinished {
		return
	}
	if player := s.playerBySessionLocked(room, sessionID); player != nil {
		s.leaveRoomLocked(room, player)
	}
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
	cancelGeoBattlePreparation(room)
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
