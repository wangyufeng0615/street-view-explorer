package services

import (
	"context"
	"fmt"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

func (s *GeoBattleService) generatePreparedRoundsAsync(roomID string, token uint64) {
	s.mu.Lock()
	room, exists := s.rooms[roomID]
	if !exists || room.PrepareToken != token || room.Phase != models.GeoBattlePhasePreparing {
		s.mu.Unlock()
		return
	}
	ctx := room.PrepareContext
	s.mu.Unlock()
	go func(expectedToken uint64) {
		rounds, err := s.generateRounds(ctx)

		s.mu.Lock()
		defer s.mu.Unlock()

		room, ok := s.rooms[roomID]
		if !ok || room.PrepareToken != expectedToken || room.Phase != models.GeoBattlePhasePreparing {
			return
		}
		cancelGeoBattlePreparation(room)

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

func (s *GeoBattleService) enterPreparingLocked(room *geoBattleRoom, token uint64) {
	cancelGeoBattlePreparation(room)
	room.PrepareContext, room.PrepareCancel = context.WithTimeout(context.Background(), 45*time.Second)
	now := time.Now()
	room.PrepareToken = token
	room.ScheduleToken++
	room.Phase = models.GeoBattlePhasePreparing
	room.PhaseDeadlineAt = nil
	room.Message = ""
	room.Rounds = nil
	room.CurrentRound = 0
	room.UpdatedAt = now
	for _, player := range room.Players {
		if player.Left {
			continue
		}
		player.Ready = false
		player.TotalScore = 0
		player.CurrentZoom = models.GeoBattleStartZoom
		player.CurrentSteps = 0
	}
}

func (s *GeoBattleService) resetRoomToLobbyLocked(room *geoBattleRoom, now time.Time) {
	cancelGeoBattlePreparation(room)
	room.Phase = models.GeoBattlePhaseLobby
	room.PhaseDeadlineAt = nil
	room.Message = ""
	room.Rounds = nil
	room.CurrentRound = 0
	room.ScheduleToken++
	room.UpdatedAt = now
	for _, player := range room.Players {
		if player.Left {
			continue
		}
		player.Ready = false
		player.TotalScore = 0
		player.CurrentZoom = models.GeoBattleStartZoom
		player.CurrentSteps = 0
	}
}

func (s *GeoBattleService) generateRounds(ctx context.Context) ([]geoBattleRound, error) {
	rounds := make([]geoBattleRound, 0, models.GeoBattleTotalRounds)
	seenPanoIDs := make(map[string]struct{})

	for len(rounds) < models.GeoBattleTotalRounds {
		var (
			loc models.Location
			err error
		)
		for attempt := 0; attempt < geoBattleMaxRoundGenRetries; attempt++ {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			loc, err = s.locationService.GetRandomLocationWithContext(ctx, "", "en")
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
	cancelGeoBattlePreparation(room)
	room.Phase = models.GeoBattlePhaseFinished
	room.PhaseDeadlineAt = nil
	room.UpdatedAt = time.Now()
	room.ScheduleToken++
}
