package models

import "time"

const (
	GeoBattleModePrivate     = "private"
	GeoBattleModeMatchmaking = "matchmaking"

	GeoBattlePhaseLobby     = "lobby"
	GeoBattlePhasePreparing = "preparing"
	GeoBattlePhaseCountdown = "countdown"
	GeoBattlePhasePlaying   = "playing"
	GeoBattlePhaseReveal    = "reveal"
	GeoBattlePhaseFinished  = "finished"
	GeoBattleQueueIdle      = "idle"
	GeoBattleQueueQueued    = "queued"
	GeoBattleQueueMatched   = "matched"
	GeoBattleTotalRounds    = 5
	GeoBattleStartZoom      = 14
	GeoBattleMinZoom        = 2
)

type GeoBattleGuessSnapshot struct {
	Lat         *float64  `json:"lat,omitempty"`
	Lng         *float64  `json:"lng,omitempty"`
	Skipped     bool      `json:"skipped"`
	DistanceKM  *float64  `json:"distance_km,omitempty"`
	Score       int       `json:"score"`
	ZoomSteps   int       `json:"zoom_steps"`
	SubmittedAt time.Time `json:"submitted_at"`
}

type GeoBattleTargetSnapshot struct {
	Lat              float64 `json:"lat"`
	Lng              float64 `json:"lng"`
	FormattedAddress string  `json:"formatted_address"`
	Country          string  `json:"country"`
}

type GeoBattlePlayerSnapshot struct {
	Nickname              string `json:"nickname"`
	IsHost                bool   `json:"is_host"`
	IsReady               bool   `json:"is_ready"`
	IsOnline              bool   `json:"is_online"`
	HasSubmittedThisRound bool   `json:"has_submitted_this_round"`
	TotalScore            int    `json:"total_score"`
	Left                  bool   `json:"left"`
}

type GeoBattleRoundSnapshot struct {
	Index          int                      `json:"index"`
	Total          int                      `json:"total"`
	CurrentZoom    int                      `json:"current_zoom"`
	MinZoom        int                      `json:"min_zoom"`
	ZoomSteps      int                      `json:"zoom_steps"`
	MyGuess        *GeoBattleGuessSnapshot  `json:"my_guess,omitempty"`
	OpponentGuess  *GeoBattleGuessSnapshot  `json:"opponent_guess,omitempty"`
	OpponentLocked bool                     `json:"opponent_locked"`
	Target         *GeoBattleTargetSnapshot `json:"target,omitempty"`
}

type GeoBattleRoomSnapshot struct {
	RoomID          string                   `json:"room_id"`
	RoomCode        string                   `json:"room_code,omitempty"`
	Mode            string                   `json:"mode"`
	Phase           string                   `json:"phase"`
	Message         string                   `json:"message,omitempty"`
	CreatedAt       time.Time                `json:"created_at"`
	UpdatedAt       time.Time                `json:"updated_at"`
	ServerTime      time.Time                `json:"server_time"`
	PhaseDeadlineAt *time.Time               `json:"phase_deadline_at,omitempty"`
	Me              GeoBattlePlayerSnapshot  `json:"me"`
	Opponent        *GeoBattlePlayerSnapshot `json:"opponent,omitempty"`
	Round           *GeoBattleRoundSnapshot  `json:"round,omitempty"`
	Rounds          []GeoBattleRoundSnapshot `json:"rounds,omitempty"`
	CanReady        bool                     `json:"can_ready"`
	CanZoomOut      bool                     `json:"can_zoom_out"`
	CanSubmitGuess  bool                     `json:"can_submit_guess"`
	CanLeave        bool                     `json:"can_leave"`
}

type GeoBattleMatchmakingSnapshot struct {
	Status   string                 `json:"status"`
	QueuedAt *time.Time             `json:"queued_at,omitempty"`
	Room     *GeoBattleRoomSnapshot `json:"room,omitempty"`
}
