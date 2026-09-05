import React from "react";

import {
  formatDistance,
  getEffectiveDistanceKm,
  getGuessToleranceKm,
  isPerfectGuess,
} from "../utils/geoGameUtils";

const SCORE_ZOOM_DECAY_PER_STEP = 0.12;

const SCORE_DISTANCE_DECAY_KM = 1500;

function getOutcomeLabel(room, t) {
  if (!room?.opponent) return null;
  if (room.me.total_score > room.opponent.total_score)
    return t("geo_online.win");
  if (room.me.total_score < room.opponent.total_score)
    return t("geo_online.lose");
  return t("geo_online.draw");
}

function formatBattleDistance(distanceKm, t, zoomSteps = 0) {
  if (isPerfectGuess(distanceKm, zoomSteps)) {
    return t("geo.perfect_distance_short");
  }
  return formatDistance(distanceKm);
}

function formatScoreFactor(value) {
  if (!Number.isFinite(value)) return "1.00";
  return value.toFixed(2);
}

function getBattleScoreBreakdown(zoomSteps = 0, distanceKm = null) {
  const steps = Math.max(0, Number.isFinite(zoomSteps) ? zoomSteps : 0);
  const zoomFactor = Math.exp(-steps * SCORE_ZOOM_DECAY_PER_STEP);
  const toleranceKm = getGuessToleranceKm(steps);
  const hasDistance = Number.isFinite(distanceKm);
  const effectiveDistanceKm = hasDistance
    ? getEffectiveDistanceKm(steps, distanceKm)
    : null;
  const distanceFactor = hasDistance
    ? Math.exp(-effectiveDistanceKm / SCORE_DISTANCE_DECAY_KM)
    : null;

  return {
    zoomFactor,
    toleranceKm,
    effectiveDistanceKm,
    distanceFactor,
  };
}

function BattleScoreBreakdown({ round, remainingSeconds, t }) {
  const zoomSteps = round?.zoom_steps || 0;
  const breakdown = getBattleScoreBreakdown(zoomSteps);
  const timeText =
    remainingSeconds != null
      ? t("geo_online.score_time_remaining", { seconds: remainingSeconds })
      : t("geo_online.score_time_no_penalty");

  return (
    <div className="geo-battle-score-breakdown">
      <div className="geo-battle-score-formula">
        {t("geo_online.score_formula")}
      </div>
      <div className="geo-battle-score-pills">
        <span>{t("geo_online.score_base")}</span>
        <span>
          {t("geo_online.score_zoom_factor", {
            factor: formatScoreFactor(breakdown.zoomFactor),
          })}
        </span>
        <span>
          {t("geo_online.score_tolerance", {
            distance: formatDistance(breakdown.toleranceKm),
          })}
        </span>
        <span>{timeText}</span>
      </div>
    </div>
  );
}

function getRoundPlace(round, t) {
  return (
    round?.target?.formatted_address ||
    round?.target?.country ||
    t("geo.unknown_place")
  );
}

function getRoundWinner(round) {
  const myScore = round?.my_guess?.score || 0;
  const opponentScore = round?.opponent_guess?.score || 0;
  if (myScore > opponentScore) return "you";
  if (opponentScore > myScore) return "opponent";
  return "draw";
}

function getRoundWinnerLabel(round, t) {
  const winner = getRoundWinner(round);
  if (winner === "you") return t("geo_online.round_winner_you");
  if (winner === "opponent") return t("geo_online.round_winner_opponent");
  return t("geo_online.round_winner_draw");
}

function RoundResultOverlay({ room, t }) {
  const round = room.round;
  if (!round) return null;
  const winner = getRoundWinner(round);

  return (
    <div className="geo-battle-controls geo-battle-controls--result">
      <div className="geo-battle-result-card">
        <div className="geo-battle-result-header">
          <div>
            <div className="geo-battle-result-title">
              {t("geo_online.round_result")}
            </div>
            <div className="geo-battle-result-location">
              {getRoundPlace(round, t)}
            </div>
          </div>
          <div
            className={`geo-battle-round-outcome geo-battle-round-outcome--${winner}`}
          >
            {getRoundWinnerLabel(round, t)}
          </div>
        </div>
        <div className="geo-battle-result-grid">
          <BattleGuessStat
            label={t("geo_online.you")}
            guess={round.my_guess}
            type="player"
            t={t}
          />
          <BattleGuessStat
            label={t("geo_online.opponent")}
            guess={round.opponent_guess}
            type="opponent"
            t={t}
          />
        </div>
        <div className="geo-battle-result-total">
          <span>{t("geo_online.total_score")}</span>
          <span>
            {room.me.total_score.toLocaleString()} :{" "}
            {room.opponent?.total_score?.toLocaleString() || 0}
          </span>
        </div>
      </div>
    </div>
  );
}

function FinalResultOverlay({
  room,
  outcomeLabel,
  actionBusy,
  onReady,
  onLeave,
  t,
}) {
  const rounds = room.rounds?.length
    ? room.rounds
    : room.round
      ? [room.round]
      : [];
  const outcomeKey =
    room.me.total_score > (room.opponent?.total_score || 0)
      ? "win"
      : room.me.total_score < (room.opponent?.total_score || 0)
        ? "lose"
        : "draw";

  return (
    <div className="geo-battle-controls geo-battle-controls--final">
      <div
        className={`geo-battle-final-card geo-battle-final-card--${outcomeKey}`}
      >
        <div className="geo-battle-final-hero">
          <span>{t("geo_online.finished")}</span>
          <strong>{outcomeLabel}</strong>
          <em>
            {t(`geo_online.final_subtitle_${outcomeKey}`, {
              yourScore: room.me.total_score.toLocaleString(),
              opponentScore: (room.opponent?.total_score || 0).toLocaleString(),
            })}
          </em>
        </div>
        <div className="geo-battle-final-scoreboard">
          <div className="geo-battle-final-score geo-battle-final-score--player">
            <span>{t("geo_online.you")}</span>
            <strong>{room.me.total_score.toLocaleString()}</strong>
          </div>
          <div className="geo-battle-final-score geo-battle-final-score--opponent">
            <span>{t("geo_online.opponent")}</span>
            <strong>
              {(room.opponent?.total_score || 0).toLocaleString()}
            </strong>
          </div>
        </div>
        <div className="geo-battle-rounds-title">
          {t("geo_online.final_rounds_title")}
        </div>
        <div className="geo-battle-round-list">
          {rounds.map((round) => (
            <div className="geo-battle-round-row" key={round.index}>
              <div className="geo-battle-round-row-main">
                <strong>{t("geo.round", { n: round.index })}</strong>
                <span>{getRoundPlace(round, t)}</span>
              </div>
              <div className="geo-battle-round-row-scores">
                <span className="geo-battle-round-row-score geo-battle-round-row-score--player">
                  {round.my_guess?.score?.toLocaleString() || 0}
                </span>
                <em>{getRoundWinnerLabel(round, t)}</em>
                <span className="geo-battle-round-row-score geo-battle-round-row-score--opponent">
                  {round.opponent_guess?.score?.toLocaleString() || 0}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="geo-battle-final-actions">
          <button
            type="button"
            className="geo-battle-primary-btn"
            disabled={!room.can_ready || actionBusy !== ""}
            onClick={onReady}
          >
            {actionBusy === "ready"
              ? t("geo_online.loading")
              : t("geo_online.play_again")}
          </button>
          <button
            type="button"
            className="geo-battle-secondary-btn"
            onClick={onLeave}
          >
            {t("geo_online.leave_room")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlayerStatusCard({
  title,
  player,
  playerRole = "player",
  currentPhase,
  t,
}) {
  if (!player) {
    return null;
  }
  const role = playerRole === "opponent" ? "opponent" : "player";

  let statusTone = player.is_online ? "online" : "offline";
  let status = player.is_online
    ? t("geo_online.status_online")
    : t("geo_online.status_offline");

  if (player.left) {
    status = t("geo_online.opponent_left");
    statusTone = "left";
  } else if (currentPhase === "lobby" || currentPhase === "finished") {
    status = player.is_ready
      ? t("geo_online.ready_state")
      : t("geo_online.not_ready");
    statusTone = player.is_ready ? "ready" : "waiting";
  } else if (player.has_submitted_this_round) {
    status = t("geo_online.locked");
    statusTone = "locked";
  }

  return (
    <div className={`geo-battle-player-card geo-battle-player-card--${role}`}>
      <div
        className={`geo-battle-player-label geo-battle-player-label--${role}`}
      >
        {title}
      </div>
      <div className="geo-battle-player-name">{player.nickname}</div>
      <div className="geo-battle-player-meta">
        <span
          className={`geo-battle-player-status geo-battle-player-status--${statusTone}`}
        >
          {status}
        </span>
        <span className="geo-battle-player-score">
          {player.total_score.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

export {
  getOutcomeLabel,
  BattleScoreBreakdown,
  RoundResultOverlay,
  FinalResultOverlay,
  PlayerStatusCard,
};

function BattleGuessStat({ label, guess, type = "player", t }) {
  const score = guess?.score || 0;
  const breakdown = getBattleScoreBreakdown(
    guess?.zoom_steps || 0,
    guess?.distance_km,
  );
  const statType = type === "opponent" ? "opponent" : "player";
  return (
    <div className={`geo-battle-guess-stat geo-battle-guess-stat--${statType}`}>
      <span>{label}</span>
      <strong>+{score.toLocaleString()}</strong>
      <em>
        {guess?.distance_km != null
          ? formatBattleDistance(guess.distance_km, t, guess.zoom_steps)
          : t("geo.gave_up")}
      </em>
      {guess && !guess.skipped && (
        <small>
          {t("geo_online.score_result_factors", {
            zoom: formatScoreFactor(breakdown.zoomFactor),
            distance:
              breakdown.distanceFactor == null
                ? "--"
                : formatScoreFactor(breakdown.distanceFactor),
          })}
        </small>
      )}
    </div>
  );
}
