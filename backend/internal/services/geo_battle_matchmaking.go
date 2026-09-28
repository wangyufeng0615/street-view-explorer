package services

import (
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

func (s *GeoBattleService) JoinMatchmaking(sessionID, nickname string) (models.GeoBattleMatchmakingSnapshot, error) {
	nickname, err := normalizeGeoBattleNickname(nickname)
	if err != nil {
		return models.GeoBattleMatchmakingSnapshot{}, err
	}

	s.mu.Lock()
	startRoomID := ""
	prepareToken := uint64(0)

	s.releaseFinishedMatchmakingLocked(sessionID)
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
		// A queued page polls every few seconds; one that stopped polling
		// has been closed, so matching it would leave the newcomer alone.
		if now.Sub(entry.LastSeenAt) > geoBattleOnlineThreshold {
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
	s.enterPreparingLocked(room, room.PrepareToken+1)

	s.rooms[room.ID] = room
	s.sessionRooms[opponent.SessionID] = room.ID
	s.sessionRooms[sessionID] = room.ID
	startRoomID = room.ID
	prepareToken = room.PrepareToken
	snapshot := s.snapshotLocked(room, sessionID)
	s.mu.Unlock()

	s.generatePreparedRoundsAsync(startRoomID, prepareToken)

	return models.GeoBattleMatchmakingSnapshot{
		Status: models.GeoBattleQueueMatched,
		Room:   ptrGeoBattleRoomSnapshot(snapshot),
	}, nil
}

func (s *GeoBattleService) GetMatchmakingStatus(sessionID string) (models.GeoBattleMatchmakingSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.releaseFinishedMatchmakingLocked(sessionID)
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
