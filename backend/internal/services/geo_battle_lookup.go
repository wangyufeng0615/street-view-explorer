package services

import "time"

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
