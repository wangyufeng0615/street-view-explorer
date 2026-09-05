// @ts-check
/** @typedef {import('../utils/geoGameTypes').GameState} GameState */
/** @typedef {import('../utils/geoGameTypes').RoundScore} RoundScore */
/** @typedef {import('../utils/geoGameTypes').Translate} Translate */
import React, { useEffect } from "react";

import LanguageSwitch from "./LanguageSwitch";

import {
  TOTAL_ROUNDS,
  formatDistance,
  isPerfectGuess,
} from "../utils/geoGameUtils";

const PLAYER_MARKERS = {
  target: {
    color: "#10b981",
    className: "geo-marker-pin--target",
  },
  player: {
    color: "#ef4444",
    className: "geo-marker-pin--player",
  },
  atlas: {
    color: "#8b5cf6",
    className: "geo-marker-pin--atlas",
  },
};

/**
 * @param {number | null} distance
 * @param {Translate} t
 */
function formatResultDistance(distance, t, compact = false, zoomSteps = 0) {
  if (isPerfectGuess(distance, zoomSteps)) {
    return compact
      ? t("geo.perfect_distance_short")
      : t("geo.perfect_guess_distance");
  }
  return formatDistance(distance);
}

/**
 * @param {Translate} t
 * @param {number} score
 */
function formatScore(t, score) {
  return t("geo.score_value", { score: score.toLocaleString() });
}

/**
 * @param {Translate} t
 * @param {number | null} score
 */
function formatPlainScore(t, score) {
  if (score == null) return "-";
  return t("geo.plain_score_value", { score: score.toLocaleString() });
}

/**
 * @param {Translate} t
 * @param {number} score
 */
function formatScoreboardScore(t, score) {
  return t("geo.scoreboard_score", { score: score.toLocaleString() });
}

/**
 * @param {number | null} lat
 * @param {number | null} lng
 */
function formatCoordinates(lat, lng) {
  if (lat == null || lng == null) return "";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * @param {number} lat
 * @param {number} lng
 */
function getGoogleMapsUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${lat},${lng}`,
  )}`;
}

/**
 * @param {GameState} state
 */
function getCurrentPlayerScore(state) {
  const completedScore = state.scores.reduce(
    (sum, r) => sum + r.playerScore,
    0,
  );
  const pendingScore =
    state.phase === "ROUND_RESULT" ? state.guessResult?.score || 0 : 0;
  return completedScore + pendingScore;
}

/**
 * @param {GameState} state
 */
function getCurrentAtlasScore(state) {
  const completedScore = state.scores.reduce(
    (sum, r) => sum + (r.aiScore || 0),
    0,
  );
  const pendingScore =
    state.phase === "ROUND_RESULT" ? state.aiGuess?.score || 0 : 0;
  return completedScore + pendingScore;
}

/**
 * @param {RoundScore} round
 * @param {Translate} t
 */
function getRoundPlace(round, t) {
  return round.locationLabel || t("geo.unknown_place");
}

/**
 * @param {RoundScore[]} rounds
 * @param {Translate} t
 */
function getUniquePlaces(rounds, t, limit = 3) {
  const seen = new Set();
  const places = [];

  for (const round of rounds) {
    const place = getRoundPlace(round, t);
    if (!seen.has(place)) {
      seen.add(place);
      places.push(place);
    }
    if (places.length >= limit) break;
  }

  return places;
}

/**
 * @param {string[]} places
 * @param {Translate} t
 */
function formatPlaceList(places, t) {
  if (places.length <= 1) return places[0] || t("geo.unknown_place");
  if (places.length === 2) {
    return t("geo.place_list_pair", {
      first: places[0],
      second: places[1],
    });
  }
  return t("geo.place_list_trio", {
    first: places[0],
    second: places[1],
    third: places[2],
  });
}

/**
 * @param {GameState} state
 * @param {Translate} t
 * @param {number} playerTotal
 * @param {number | null} aiTotal
 */
function getGameOverAtlasMessage(state, t, playerTotal, aiTotal) {
  const guessedRounds = state.scores.filter(
    /** @returns {r is RoundScore & {distance: number}} */
    (r) => typeof r.distance === "number" && Number.isFinite(r.distance),
  );
  const outcome =
    state.aiEnabled && aiTotal != null
      ? playerTotal >= aiTotal
        ? t("geo.gameover_atlas_outcome_win")
        : t("geo.gameover_atlas_outcome_lose")
      : "";

  if (guessedRounds.length === 0) {
    return t("geo.gameover_atlas_note_giveup", {
      score: formatPlainScore(t, playerTotal),
      outcome,
    }).trim();
  }

  const sortedRounds = [...guessedRounds].sort(
    (a, b) => a.distance - b.distance,
  );
  const bestRound = sortedRounds[0];
  const secondRound = sortedRounds[1] || bestRound;
  const roughRound = sortedRounds[sortedRounds.length - 1] || bestRound;
  const perfectRounds = sortedRounds.filter((round) =>
    isPerfectGuess(round.distance, round.zoomSteps),
  );
  const perfectPlaces = getUniquePlaces(perfectRounds, t, 3);
  const highlightPlaces = getUniquePlaces(sortedRounds, t, 3);
  const averageDistance =
    guessedRounds.reduce((sum, round) => sum + round.distance, 0) /
    guessedRounds.length;
  const params = {
    place: getRoundPlace(bestRound, t),
    bestPlace: getRoundPlace(bestRound, t),
    secondPlace: getRoundPlace(secondRound, t),
    roughPlace: getRoundPlace(roughRound, t),
    placeList: formatPlaceList(highlightPlaces, t),
    perfectPlaceList: formatPlaceList(perfectPlaces, t),
    perfectCount: perfectRounds.length,
    distance: formatResultDistance(
      bestRound.distance,
      t,
      true,
      bestRound.zoomSteps,
    ),
    score: formatPlainScore(t, playerTotal),
    outcome,
  };

  if (perfectRounds.length >= 2) {
    return t("geo.gameover_atlas_note_multi_hit", params).trim();
  }
  if (perfectRounds.length === 1 && guessedRounds.length >= 3) {
    return t("geo.gameover_atlas_note_mixed_hit", params).trim();
  }
  if (averageDistance <= 250 || playerTotal >= 12000) {
    return t("geo.gameover_atlas_note_good", params).trim();
  }
  return t("geo.gameover_atlas_note_rough", params).trim();
}

/**
 * @param {{type: keyof typeof PLAYER_MARKERS}} props
 */
function MarkerPin({ type }) {
  return (
    <span
      className={`geo-marker-pin ${PLAYER_MARKERS[type].className}`}
      aria-hidden="true"
    />
  );
}

/**
 * @param {{type: keyof typeof PLAYER_MARKERS, children: React.ReactNode}} props
 */
function ResultLabel({ type, children }) {
  return (
    <div className="geo-result-label geo-result-label--with-marker">
      <MarkerPin type={type} />
      {children}
    </div>
  );
}

/**
 * @param {{label: string, value: React.ReactNode, highlight?: boolean, variant?: string}} props
 */
function ResultMetric({ label, value, highlight = false, variant = "" }) {
  return (
    <div
      className={`geo-result-metric ${
        variant ? `geo-result-metric--${variant}` : ""
      }`}
    >
      <span>{label}</span>
      <strong className={highlight ? "geo-result-metric-value--highlight" : ""}>
        {value}
      </strong>
    </div>
  );
}

/**
 * @param {{score: number, distance: number | null, zoomSteps?: number, t: Translate}} props
 */
function ResultStats({ score, distance, zoomSteps, t }) {
  return (
    <div className="geo-result-stats">
      <ResultMetric
        label={t("geo.score")}
        value={formatScore(t, score)}
        highlight
      />
      <ResultMetric
        label={t("geo.distance_error")}
        value={formatResultDistance(distance, t, true, zoomSteps)}
        variant="distance"
      />
      {zoomSteps !== undefined && (
        <ResultMetric
          label={t("geo.zoom_out_count")}
          value={t("geo.zoom_out_count_value", { count: zoomSteps })}
        />
      )}
    </div>
  );
}

/**
 * @param {{onStart: (options: {aiEnabled: boolean, countryCode: string}) => void, t: Translate, navigate: (url: string) => void, countryCode: string}} props
 */
function WelcomeModal({ onStart, t, navigate, countryCode }) {
  return (
    <div className="geo-welcome-page">
      <div className="geo-welcome-card">
        <div className="geo-modal-header">
          <div className="geo-modal-title">{t("geo.title")}</div>
          <LanguageSwitch />
        </div>
        <div className="geo-modal-subtitle">{t("geo.subtitle")}</div>
        <div className="geo-welcome-actions">
          <button
            className="geo-start-btn geo-start-btn--atlas"
            onClick={() => onStart({ aiEnabled: true, countryCode })}
          >
            {t("geo.start_atlas")}
          </button>
          <button
            className="geo-secondary-btn geo-secondary-btn--friend"
            onClick={() => navigate("/guess/online")}
          >
            {t("geo.invite_friend_online")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * @param {{state: GameState, t: Translate, onNext: () => void}} props
 */
function RoundResult({ state, t, onNext }) {
  const gaveUp = state.guessResult && state.guessResult.lat == null;
  const targetCoordinates = state.target
    ? formatCoordinates(state.target.lat, state.target.lng)
    : "";
  const targetMapsUrl = state.target
    ? getGoogleMapsUrl(state.target.lat, state.target.lng)
    : "";

  return (
    <div className="geo-result-panel">
      <div className="geo-result-body">
        <div className="geo-result-summary">
          <div className="geo-result-title">
            {t("geo.round", { n: state.round })}
          </div>

          {/* Actual location reveal */}
          {state.target && (state.target.address || state.target.country) && (
            <div className="geo-result-location">
              <MarkerPin type="target" />
              <span className="geo-result-location-label">
                {t("geo.actual_location")}
              </span>
              <strong>{state.target.address || state.target.country}</strong>
              <span className="geo-result-coordinates">
                {targetCoordinates}
                <a href={targetMapsUrl} target="_blank" rel="noreferrer">
                  {t("geo.open_google_maps")}
                </a>
              </span>
            </div>
          )}
        </div>

        <div className="geo-result-section">
          <ResultLabel type="player">{t("geo.your_guess")}</ResultLabel>
          {gaveUp ? (
            <div className="geo-result-distance">{t("geo.gave_up")}</div>
          ) : state.guessResult ? (
            <ResultStats
              score={state.guessResult.score}
              distance={state.guessResult.distance}
              zoomSteps={state.zoomSteps}
              t={t}
            />
          ) : (
            <div className="geo-result-distance">{t("geo.no_guess")}</div>
          )}
        </div>

        {state.aiEnabled && (
          <>
            <div className="geo-result-divider" />
            <div className="geo-result-ai-section">
              <ResultLabel type="atlas">Atlas</ResultLabel>
              {state.aiGuess ? (
                <>
                  <ResultStats
                    score={state.aiGuess.score}
                    distance={state.aiGuess.distance}
                    zoomSteps={state.zoomSteps}
                    t={t}
                  />
                  {state.aiGuess.reasoning && (
                    <div className="geo-result-ai-reasoning">
                      &ldquo;{state.aiGuess.reasoning}&rdquo;
                    </div>
                  )}
                </>
              ) : (
                <div className="geo-result-ai-distance">
                  {state.aiLoading
                    ? t("geo.ai_thinking")
                    : t("geo.ai_unavailable")}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <button className="geo-result-btn" onClick={onNext}>
        {state.round >= TOTAL_ROUNDS
          ? t("geo.see_results")
          : t("geo.next_round")}
      </button>
    </div>
  );
}

/**
 * @param {{state: GameState, t: Translate, onRestart: () => void, onNext: () => void}} props
 */
function GameOverModal({ state, t, onRestart, onNext }) {
  useEffect(() => {
    if (state.scores.length < TOTAL_ROUNDS) onNext();
  }, []);
  const playerTotal = state.scores.reduce((s, r) => s + r.playerScore, 0);
  const aiTotal = state.aiEnabled
    ? state.scores.reduce((s, r) => s + (r.aiScore || 0), 0)
    : null;
  const atlasMessage = getGameOverAtlasMessage(state, t, playerTotal, aiTotal);

  return (
    <div className="geo-modal-overlay">
      <div className="geo-modal geo-gameover-modal">
        <div className="geo-gameover-header">
          <div>
            <div className="geo-modal-title">{t("geo.game_over")}</div>
            <div className="geo-gameover-subtitle">
              {t("geo.gameover_summary", {
                score: formatPlainScore(t, playerTotal),
              })}
            </div>
          </div>
        </div>

        <div className="geo-gameover-atlas-note">
          <div>
            <MarkerPin type="atlas" />
            <span>{t("geo.gameover_atlas_note_title")}</span>
          </div>
          <p>{atlasMessage}</p>
        </div>

        <div
          className={`geo-gameover-scoreboard ${
            state.aiEnabled ? "geo-gameover-scoreboard--duel" : ""
          }`}
        >
          <div className="geo-gameover-player-card geo-gameover-player-card--you">
            <div>
              <MarkerPin type="player" />
              <span>{t("geo.you")}</span>
            </div>
            <strong>{formatPlainScore(t, playerTotal)}</strong>
          </div>
          {aiTotal !== null && (
            <div className="geo-gameover-player-card geo-gameover-player-card--atlas">
              <div>
                <MarkerPin type="atlas" />
                <span>Atlas</span>
              </div>
              <strong>{formatPlainScore(t, aiTotal)}</strong>
            </div>
          )}
        </div>

        <div className="geo-gameover-rounds">
          {state.scores.map((r, i) => (
            <div key={i} className="geo-gameover-round">
              <div className="geo-gameover-round-main">
                <span className="geo-gameover-round-label">
                  {t("geo.round", { n: i + 1 })}
                </span>
                <strong>{r.locationLabel || t("geo.unknown_place")}</strong>
              </div>
              <div className="geo-gameover-round-meta">
                <span>
                  {t("geo.zoom_out_count")}:{" "}
                  {t("geo.zoom_out_count_value", { count: r.zoomSteps })}
                </span>
                <span>
                  {t("geo.distance_error")}:{" "}
                  {r.distance !== null
                    ? formatResultDistance(r.distance, t, true, r.zoomSteps)
                    : t("geo.gave_up")}
                </span>
              </div>
              <div
                className={`geo-gameover-round-scores ${
                  state.aiEnabled ? "geo-gameover-round-scores--duel" : ""
                }`}
              >
                <span>
                  <MarkerPin type="player" />
                  {formatPlainScore(t, r.playerScore)}
                </span>
                {state.aiEnabled && (
                  <span>
                    <MarkerPin type="atlas" />
                    {r.aiScore != null ? formatPlainScore(t, r.aiScore) : "-"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <button className="geo-start-btn" onClick={onRestart}>
          {t("geo.play_again")}
        </button>
      </div>
    </div>
  );
}

export {
  PLAYER_MARKERS,
  getCurrentPlayerScore,
  getCurrentAtlasScore,
  getGameOverAtlasMessage,
  formatScoreboardScore,
  MarkerPin,
  ResultStats,
  WelcomeModal,
  RoundResult,
  GameOverModal,
};
