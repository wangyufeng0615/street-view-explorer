package services

import (
	"context"
	"errors"
	"sync"
	"time"

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
	geoBattleRoundDuration      = 100 * time.Second
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

// GeoBattleService owns process-local duel rooms and matchmaking state.
// Restarting the backend intentionally drops this state; callers must not
// treat a room snapshot as durable storage.
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
	PrepareContext  context.Context
	PrepareCancel   context.CancelFunc
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

func cancelGeoBattlePreparation(room *geoBattleRoom) {
	if room.PrepareCancel != nil {
		room.PrepareCancel()
		room.PrepareCancel = nil
	}
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
