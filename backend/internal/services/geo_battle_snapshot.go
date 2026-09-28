package services

import (
	"math"
	"time"

	"github.com/my-streetview-project/backend/internal/models"
)

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
			TotalScore:            s.visibleTotalScoreLocked(room, player),
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
			TotalScore:            s.visibleTotalScoreLocked(room, opponent),
			Left:                  opponent.Left,
		}
	}

	if len(room.Rounds) > 0 && room.CurrentRound < len(room.Rounds) {
		includeResults := room.Phase == models.GeoBattlePhaseReveal || room.Phase == models.GeoBattlePhaseFinished
		roundSnapshot := s.roundSnapshotLocked(room, room.CurrentRound, player, opponent, includeResults)
		snapshot.Round = roundSnapshot

		if includeResults {
			lastRound := min(room.CurrentRound, len(room.Rounds)-1)
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
		return index <= room.CurrentRound
	}
	return index < room.CurrentRound || room.Phase == models.GeoBattlePhaseReveal
}

func (s *GeoBattleService) visibleTotalScoreLocked(room *geoBattleRoom, player *geoBattlePlayer) int {
	if room == nil || player == nil {
		return 0
	}
	if room.Phase != models.GeoBattlePhasePlaying ||
		room.CurrentRound < 0 ||
		room.CurrentRound >= len(room.Rounds) {
		return player.TotalScore
	}
	if guess := room.Rounds[room.CurrentRound].Guesses[player.SessionID]; guess != nil {
		return player.TotalScore - guess.Score
	}
	return player.TotalScore
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
			roundSnapshot.ZoomSteps = guess.ZoomSteps
			roundSnapshot.CurrentZoom = max(models.GeoBattleMinZoom, models.GeoBattleStartZoom-guess.ZoomSteps)
			if includeResults || index < room.CurrentRound || room.Phase == models.GeoBattlePhaseFinished {
				roundSnapshot.MyGuess = geoBattleGuessSnapshotFromInternal(guess)
			}
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

func geoBattleGuessSnapshotFromInternal(guess *geoBattleGuess) *models.GeoBattleGuessSnapshot {
	if guess == nil {
		return nil
	}
	// JSON cannot encode NaN or Inf; one bad value would break the whole
	// room snapshot for both players.
	distanceKM := guess.DistanceKM
	if distanceKM != nil && (math.IsNaN(*distanceKM) || math.IsInf(*distanceKM, 0)) {
		distanceKM = nil
	}
	return &models.GeoBattleGuessSnapshot{
		Lat:         guess.Lat,
		Lng:         guess.Lng,
		Skipped:     guess.Skipped,
		DistanceKM:  distanceKM,
		Score:       guess.Score,
		ZoomSteps:   guess.ZoomSteps,
		SubmittedAt: guess.SubmittedAt,
	}
}

func ptrGeoBattleRoomSnapshot(snapshot models.GeoBattleRoomSnapshot) *models.GeoBattleRoomSnapshot {
	return &snapshot
}
