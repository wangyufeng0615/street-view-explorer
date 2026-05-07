import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  cancelGeoBattleMatchmaking,
  createGeoBattleRoom,
  fetchGeoBattleImage,
  getGeoBattleMatchmakingStatus,
  getGeoBattleRoom,
  joinGeoBattleMatchmaking,
  joinGeoBattleRoom,
  leaveGeoBattleRoom,
  setGeoBattleReady,
  submitGeoBattleGuess,
  zoomOutGeoBattle,
} from "../services/api";
import { loadGoogleMapsScript } from "../utils/googleMaps";
import {
  formatDistance,
  getEffectiveDistanceKm,
  getGuessToleranceKm,
  isPerfectGuess,
} from "../utils/geoGameUtils";
import LanguageSwitch from "../components/LanguageSwitch";
import {
  GameFeedbackBubbles,
  GameSoundToggle,
} from "../components/GameFeedback";
import { useGameFeedback } from "../hooks/useGameFeedback";
import "../styles/GeoBattle.css";

const NICKNAME_STORAGE_KEY = "geoBattleNickname";
const WORLD_CENTER = { lat: 20, lng: 0 };
const SYNC_INTERVAL_PLAYING = 1500;
const SYNC_INTERVAL_IDLE = 2500;
const SATELLITE_ZOOM_TRANSITION_MS = 760;
const SCORE_ZOOM_DECAY_PER_STEP = 0.12;
const SCORE_DISTANCE_DECAY_KM = 1500;
const BATTLE_MARKERS = {
  target: { color: "#10b981", zIndex: 30, scale: 17 },
  player: { color: "#ef4444", zIndex: 50, scale: 16 },
  opponent: { color: "#2563eb", zIndex: 40, scale: 16 },
};
const NICKNAMES = {
  zh: [
    "星图旅人",
    "云层观察员",
    "海岸猎手",
    "地图玩家",
    "经纬探员",
    "山脊向导",
  ],
  en: ["Sky Mapper", "Cloud Scout", "Coast Hunter", "Map Runner", "Geo Pilot"],
};

function readSavedNickname() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NICKNAME_STORAGE_KEY) || "";
}

function saveNickname(nickname) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
}

function getGeoLanguage(i18n) {
  const language = i18n.resolvedLanguage || i18n.language || "en";
  return language.startsWith("zh") ? "zh" : "en";
}

function generateNickname(language = "en") {
  const names = NICKNAMES[language] || NICKNAMES.en;
  const name = names[Math.floor(Math.random() * names.length)];
  return `${name}${Math.floor(100 + Math.random() * 900)}`;
}

function normalizeRoomCode(code) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function getRemainingSeconds(deadlineAt, clockOffset = 0, now = Date.now()) {
  if (!deadlineAt) return null;
  const deadline = Date.parse(deadlineAt);
  if (Number.isNaN(deadline)) return null;
  const serverNow = now + clockOffset;
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}

function parseSnapshotTime(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function isOlderRoomSnapshot(room, latest) {
  const serverTimeMs = parseSnapshotTime(room?.server_time);
  const updatedAtMs = parseSnapshotTime(room?.updated_at);

  if (
    serverTimeMs != null &&
    latest.serverTimeMs != null &&
    serverTimeMs < latest.serverTimeMs
  ) {
    return true;
  }

  if (
    (serverTimeMs == null || serverTimeMs === latest.serverTimeMs) &&
    updatedAtMs != null &&
    latest.updatedAtMs != null &&
    updatedAtMs < latest.updatedAtMs
  ) {
    return true;
  }

  return false;
}

function rememberRoomSnapshot(room, latest) {
  const serverTimeMs = parseSnapshotTime(room?.server_time);
  const updatedAtMs = parseSnapshotTime(room?.updated_at);

  if (serverTimeMs != null) {
    latest.serverTimeMs =
      latest.serverTimeMs == null
        ? serverTimeMs
        : Math.max(latest.serverTimeMs, serverTimeMs);
  }

  if (updatedAtMs != null) {
    latest.updatedAtMs =
      latest.updatedAtMs == null
        ? updatedAtMs
        : Math.max(latest.updatedAtMs, updatedAtMs);
  }
}

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

function getBattleMarkerLabel(type, t) {
  if (type === "target") return t("geo_online.pin_target_short");
  if (type === "opponent") return t("geo_online.pin_opponent_short");
  return t("geo_online.pin_you_short");
}

function createBattleMarker(maps, map, position, type, t) {
  const marker = BATTLE_MARKERS[type] || BATTLE_MARKERS.player;
  return new maps.Marker({
    position,
    map,
    clickable: false,
    zIndex: marker.zIndex,
    icon: {
      path: maps.SymbolPath.CIRCLE,
      scale: marker.scale,
      fillColor: marker.color,
      fillOpacity: 1,
      strokeColor: "#fff",
      strokeWeight: 2.5,
    },
    label: {
      text: getBattleMarkerLabel(type, t),
      color: "#fff",
      fontSize: "11px",
      fontWeight: "800",
    },
  });
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

function getRoomMessage(room, t) {
  if (!room) return "";
  if (room.message?.startsWith("player_left:")) {
    return t("geo_online.left_notice", {
      name: room.message.slice("player_left:".length),
    });
  }
  if (room.message === "prepare_failed") {
    return t("geo_online.prepare_failed");
  }
  if (room.message === "time_up") {
    return t("geo.time_up");
  }
  return room.message || t(`geo_online.phase_${room.phase}`);
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

function GeoBattleHubPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const activeLanguage = getGeoLanguage(i18n);
  const [nickname, setNickname] = useState(
    () => readSavedNickname() || generateNickname(activeLanguage),
  );
  const [roomCode, setRoomCode] = useState("");
  const [matchmaking, setMatchmaking] = useState({ status: "idle" });
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    saveNickname(nickname);
  }, [nickname]);

  const syncMatchmaking = useCallback(async () => {
    const res = await getGeoBattleMatchmakingStatus();
    if (!res.success || !res.data) return;

    if (res.data.status === "matched" && res.data.room?.room_id) {
      navigate(`/guess/online/${res.data.room.room_id}`, { replace: true });
      return;
    }

    setMatchmaking(res.data);
  }, [navigate]);

  useEffect(() => {
    syncMatchmaking();
  }, [syncMatchmaking]);

  useEffect(() => {
    if (matchmaking.status !== "queued") return undefined;

    const timer = window.setInterval(syncMatchmaking, SYNC_INTERVAL_PLAYING);
    return () => {
      window.clearInterval(timer);
    };
  }, [matchmaking.status, syncMatchmaking]);

  const withNickname = useCallback(() => {
    const value = nickname.trim();
    if (!value) {
      setError(t("geo_online.need_nickname"));
      return null;
    }
    saveNickname(value);
    setError("");
    return value;
  }, [nickname, t]);

  const handleCreateRoom = async () => {
    const value = withNickname();
    if (!value) return;

    setBusyAction("create");
    const res = await createGeoBattleRoom(value);
    setBusyAction("");

    if (!res.success || !res.data?.room?.room_id) {
      setError(res.error || t("geo_online.generic_error"));
      return;
    }

    navigate(`/guess/online/${res.data.room.room_id}`);
  };

  const handleJoinRoom = async () => {
    const value = withNickname();
    if (!value) return;

    const code = normalizeRoomCode(roomCode);
    if (!code) {
      setError(t("geo_online.need_room_code"));
      return;
    }

    setBusyAction("join");
    const res = await joinGeoBattleRoom(code, value);
    setBusyAction("");

    if (!res.success || !res.data?.room?.room_id) {
      setError(res.error || t("geo_online.generic_error"));
      return;
    }

    navigate(`/guess/online/${res.data.room.room_id}`);
  };

  const handleMatchmaking = async () => {
    const value = withNickname();
    if (!value) return;

    setBusyAction("match");
    const res = await joinGeoBattleMatchmaking(value);
    setBusyAction("");

    if (!res.success || !res.data) {
      if (res.status === 409) {
        setError(t("geo_online.already_in_room"));
      } else {
        setError(res.error || t("geo_online.generic_error"));
      }
      return;
    }

    if (res.data.status === "matched" && res.data.room?.room_id) {
      navigate(`/guess/online/${res.data.room.room_id}`);
      return;
    }

    setMatchmaking(res.data);
  };

  const handleCancelMatchmaking = async () => {
    setBusyAction("cancel-match");
    await cancelGeoBattleMatchmaking();
    setBusyAction("");
    setMatchmaking({ status: "idle" });
  };

  const handleRandomNickname = () => {
    setNickname(generateNickname(activeLanguage));
    setError("");
  };

  return (
    <div className="geo-battle-page">
      <div className="geo-battle-shell geo-battle-shell--hub">
        <div className="geo-battle-topbar">
          <button
            className="geo-battle-back"
            onClick={() => navigate("/guess")}
            type="button"
          >
            ← {t("geo_online.back_single")}
          </button>
          <div className="geo-battle-title-block">
            <div className="geo-battle-title">{t("geo_online.title")}</div>
          </div>
        </div>

        <div className="geo-battle-lobby">
          <div className="geo-battle-panel geo-battle-profile-panel">
            <label className="geo-battle-field">
              <span>{t("geo_online.nickname")}</span>
              <div className="geo-battle-nickname-row">
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder={t("geo_online.nickname_placeholder")}
                  maxLength={20}
                />
                <button
                  type="button"
                  className="geo-battle-icon-btn"
                  aria-label={t("geo_online.randomize_nickname")}
                  title={t("geo_online.randomize_nickname")}
                  onClick={handleRandomNickname}
                >
                  ↻
                </button>
              </div>
            </label>
          </div>

          <div className="geo-battle-hub-grid">
            <section className="geo-battle-panel geo-battle-private-panel">
              <div className="geo-battle-choice-title">
                {t("geo_online.private_room")}
              </div>
              <div className="geo-battle-private-actions">
                <button
                  type="button"
                  className="geo-battle-primary-btn"
                  disabled={
                    busyAction !== "" || matchmaking.status === "queued"
                  }
                  onClick={handleCreateRoom}
                >
                  {busyAction === "create"
                    ? t("geo_online.loading")
                    : t("geo_online.create_room")}
                </button>
                <div className="geo-battle-join-row">
                  <label className="geo-battle-field geo-battle-field--compact">
                    <span>{t("geo_online.room_code")}</span>
                    <input
                      value={roomCode}
                      onChange={(event) => setRoomCode(event.target.value)}
                      placeholder={t("geo_online.room_code_placeholder")}
                      maxLength={6}
                    />
                  </label>
                  <button
                    type="button"
                    className="geo-battle-secondary-btn"
                    disabled={
                      busyAction !== "" || matchmaking.status === "queued"
                    }
                    onClick={handleJoinRoom}
                  >
                    {busyAction === "join"
                      ? t("geo_online.loading")
                      : t("geo_online.join_room")}
                  </button>
                </div>
              </div>
            </section>

            <section className="geo-battle-panel geo-battle-match-panel">
              <div className="geo-battle-choice-title">
                {t("geo_online.match_room")}
              </div>
              {matchmaking.status !== "queued" && (
                <button
                  type="button"
                  className="geo-battle-secondary-btn geo-battle-match-btn"
                  disabled={
                    busyAction !== "" || matchmaking.status === "queued"
                  }
                  onClick={handleMatchmaking}
                >
                  {busyAction === "match"
                    ? t("geo_online.loading")
                    : t("geo_online.matchmaking")}
                </button>
              )}

              {matchmaking.status === "queued" && (
                <div className="geo-battle-matchmaking-card">
                  <div className="geo-battle-matchmaking-visual" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </div>
                  <div>
                    <div className="geo-battle-side-title">
                      {t("geo_online.matchmaking_wait")}
                    </div>
                    <div className="geo-battle-side-copy">
                      {t("geo_online.matchmaking_wait_hint")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="geo-battle-secondary-btn"
                    disabled={busyAction !== ""}
                    onClick={handleCancelMatchmaking}
                  >
                    {busyAction === "cancel-match"
                      ? t("geo_online.loading")
                      : t("geo_online.cancel_matchmaking")}
                  </button>
                </div>
              )}
            </section>
          </div>

          {error && <div className="geo-battle-banner">{error}</div>}
        </div>
      </div>
    </div>
  );
}

function GeoBattleRoomPage({ roomId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [fatalError, setFatalError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [syncFailures, setSyncFailures] = useState(0);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [guessPin, setGuessPin] = useState(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imageObjectUrl, setImageObjectUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [displayedImageVersion, setDisplayedImageVersion] = useState("");
  const [zoomTransition, setZoomTransition] = useState(null);
  const {
    bubbles: feedbackBubbles,
    showFeedbackBubble,
    playFeedback,
    soundEnabled,
    toggleSound,
  } = useGameFeedback({ storageKey: "geoBattleSound" });

  const guessMapElRef = useRef(null);
  const guessMapRef = useRef(null);
  const mapsAPIRef = useRef(null);
  const pendingMarkerRef = useRef(null);
  const resultMarkersRef = useRef([]);
  const resultLinesRef = useRef([]);
  const roomRef = useRef(room);
  const imageObjectUrlRef = useRef(null);
  const displayedImageVersionRef = useRef("");
  const zoomTransitionRequestRef = useRef(0);
  const zoomTransitionTimerRef = useRef(null);
  const latestRoomSnapshotRef = useRef({
    serverTimeMs: null,
    updatedAtMs: null,
  });
  const feedbackRef = useRef({ showFeedbackBubble, playFeedback, t });
  feedbackRef.current = { showFeedbackBubble, playFeedback, t };
  const roomFeedbackRef = useRef(null);
  roomRef.current = room;
  const clockOffsetRef = useRef(0);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!room?.server_time) return;
    const serverMs = Date.parse(room.server_time);
    if (!Number.isNaN(serverMs)) {
      clockOffsetRef.current = serverMs - Date.now();
    }
  }, [room?.server_time]);

  useEffect(() => {
    if (!room?.phase_deadline_at) return undefined;
    const id = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [room?.phase_deadline_at]);

  const clearPendingMarker = useCallback(() => {
    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setMap(null);
      pendingMarkerRef.current = null;
    }
  }, []);

  const clearResultOverlays = useCallback(() => {
    resultMarkersRef.current.forEach((marker) => marker.setMap(null));
    resultMarkersRef.current = [];
    resultLinesRef.current.forEach((line) => line.setMap(null));
    resultLinesRef.current = [];
  }, []);

  const refreshMapViewport = useCallback(() => {
    const maps = mapsAPIRef.current;
    if (maps?.event && guessMapRef.current) {
      maps.event.trigger(guessMapRef.current, "resize");
    }
  }, []);

  const resetMapViewport = useCallback(() => {
    if (guessMapRef.current) {
      refreshMapViewport();
      guessMapRef.current.setCenter(WORLD_CENTER);
      guessMapRef.current.setZoom(2);
    }
  }, [refreshMapViewport]);

  const applyRoomSnapshot = useCallback((nextRoom) => {
    if (isOlderRoomSnapshot(nextRoom, latestRoomSnapshotRef.current)) {
      return false;
    }
    rememberRoomSnapshot(nextRoom, latestRoomSnapshotRef.current);
    setRoom(nextRoom);
    return true;
  }, []);

  const applyRoomResponse = useCallback(
    (response) => {
      if (!response.success || !response.data?.room) {
        setActionError(response.error || t("geo_online.generic_error"));
        return false;
      }
      applyRoomSnapshot(response.data.room);
      setActionError("");
      return true;
    },
    [applyRoomSnapshot, t],
  );

  useEffect(() => {
    latestRoomSnapshotRef.current = {
      serverTimeMs: null,
      updatedAtMs: null,
    };
    setRoom(null);
    setFatalError("");
    setActionError("");
    setActionNotice("");
    setSyncFailures(0);
    setGuessPin(null);
    clearPendingMarker();
    clearResultOverlays();
    resetMapViewport();
  }, [clearPendingMarker, clearResultOverlays, resetMapViewport, roomId]);

  const loadRoomSnapshot = useCallback(async () => {
    let res;
    try {
      res = await getGeoBattleRoom(roomId);
    } catch (error) {
      res = { success: false, error: error.message };
    }
    if (res.success && res.data?.room) {
      const accepted = applyRoomSnapshot(res.data.room);
      if (accepted) {
        setFatalError("");
      }
      setSyncFailures(0);
      return true;
    }

    setSyncFailures((prev) => {
      const next = prev + 1;
      if (next >= 3 && !roomRef.current) {
        setFatalError(res.error || t("geo_online.room_missing"));
      }
      return next;
    });
    return false;
  }, [applyRoomSnapshot, roomId, t]);

  useEffect(() => {
    loadRoomSnapshot();
  }, [loadRoomSnapshot]);

  useEffect(() => {
    if (!room?.phase_deadline_at) return undefined;
    const deadlineMs = Date.parse(room.phase_deadline_at);
    if (Number.isNaN(deadlineMs)) return undefined;

    const delayMs = Math.max(
      0,
      deadlineMs - (Date.now() + clockOffsetRef.current) + 80,
    );
    const timeoutId = window.setTimeout(() => {
      loadRoomSnapshot();
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadRoomSnapshot, room?.phase, room?.phase_deadline_at]);

  useEffect(() => {
    const interval = window.setInterval(
      () => {
        loadRoomSnapshot();
      },
      room?.phase === "playing" ? SYNC_INTERVAL_PLAYING : SYNC_INTERVAL_IDLE,
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [loadRoomSnapshot, room?.phase]);

  useEffect(() => {
    loadGoogleMapsScript()
      .then((maps) => {
        mapsAPIRef.current = maps;
        setMapsReady(true);
      })
      .catch(() => {
        setMapsError(true);
      });
  }, []);

  useEffect(() => {
    if (!room || !mapsReady || !guessMapElRef.current || guessMapRef.current) {
      return;
    }

    let cancelled = false;
    const maps = mapsAPIRef.current;
    if (!maps) return;
    const map = new maps.Map(guessMapElRef.current, {
      center: WORLD_CENTER,
      zoom: 2,
      mapTypeId: "roadmap",
      disableDefaultUI: true,
      zoomControl: true,
    });

    map.addListener("click", (event) => {
      const currentRoom = roomRef.current;
      if (
        !currentRoom ||
        currentRoom.phase !== "playing" ||
        !currentRoom.can_submit_guess
      ) {
        return;
      }

      const pos = { lat: event.latLng.lat(), lng: event.latLng.lng() };
      const hadPin = Boolean(pendingMarkerRef.current);
      setGuessPin(pos);
      feedbackRef.current.playFeedback("place");
      feedbackRef.current.showFeedbackBubble(
        feedbackRef.current.t(
          hadPin
            ? "geo_online.feedback_pin_moved"
            : "geo_online.feedback_pin_placed",
        ),
        "player",
      );
    });

    guessMapRef.current = map;
    setMapReady(false);

    const fallbackId = window.setTimeout(() => {
      if (!cancelled) setMapReady(true);
    }, 1800);

    if (maps.event?.addListenerOnce) {
      maps.event.addListenerOnce(map, "idle", () => {
        if (!cancelled) {
          window.clearTimeout(fallbackId);
          setMapReady(true);
        }
      });
    } else {
      window.setTimeout(() => {
        if (!cancelled) setMapReady(true);
      }, 0);
    }

    window.requestAnimationFrame(() => {
      if (cancelled) return;
      refreshMapViewport();
      map.setCenter(WORLD_CENTER);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackId);
      if (guessMapRef.current === map) {
        maps.event?.clearInstanceListeners?.(map);
        guessMapRef.current = null;
      }
    };
  }, [mapsReady, refreshMapViewport, room?.room_id]);

  useEffect(() => {
    if (!room || !guessMapRef.current) return undefined;

    const refresh = () => {
      refreshMapViewport();
    };

    refresh();

    if (typeof ResizeObserver === "undefined" || !guessMapElRef.current) {
      window.addEventListener("resize", refresh);
      return () => window.removeEventListener("resize", refresh);
    }

    const observer = new ResizeObserver(refresh);
    observer.observe(guessMapElRef.current);
    return () => observer.disconnect();
  }, [refreshMapViewport, room?.room_id]);

  useEffect(() => {
    if (!mapsReady || !guessMapRef.current) return;
    const maps = mapsAPIRef.current;

    if (!guessPin || room?.phase !== "playing") {
      clearPendingMarker();
      return;
    }

    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setPosition(guessPin);
      return;
    }

    pendingMarkerRef.current = createBattleMarker(
      maps,
      guessMapRef.current,
      guessPin,
      "player",
      t,
    );
  }, [clearPendingMarker, guessPin, mapsReady, room?.phase, t]);

  useEffect(() => {
    if (!room) return;

    clearResultOverlays();

    if (room.phase !== "reveal" && room.phase !== "finished") {
      if (room.phase !== "playing") {
        clearPendingMarker();
        resetMapViewport();
      }
      return;
    }

    clearPendingMarker();
    if (!mapsReady || !guessMapRef.current || !room.round?.target) return;

    const maps = mapsAPIRef.current;
    const bounds = new maps.LatLngBounds();
    const target = { lat: room.round.target.lat, lng: room.round.target.lng };
    bounds.extend(target);

    resultMarkersRef.current.push(
      createBattleMarker(maps, guessMapRef.current, target, "target", t),
    );

    if (room.round.my_guess?.lat != null && room.round.my_guess?.lng != null) {
      const myGuess = {
        lat: room.round.my_guess.lat,
        lng: room.round.my_guess.lng,
      };
      bounds.extend(myGuess);
      resultMarkersRef.current.push(
        createBattleMarker(maps, guessMapRef.current, myGuess, "player", t),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [myGuess, target],
          strokeColor: BATTLE_MARKERS.player.color,
          strokeWeight: 2,
          strokeOpacity: 0.75,
          geodesic: true,
          map: guessMapRef.current,
        }),
      );
    }

    if (
      room.round.opponent_guess?.lat != null &&
      room.round.opponent_guess?.lng != null
    ) {
      const opponentGuess = {
        lat: room.round.opponent_guess.lat,
        lng: room.round.opponent_guess.lng,
      };
      bounds.extend(opponentGuess);
      resultMarkersRef.current.push(
        createBattleMarker(
          maps,
          guessMapRef.current,
          opponentGuess,
          "opponent",
          t,
        ),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [opponentGuess, target],
          strokeColor: BATTLE_MARKERS.opponent.color,
          strokeWeight: 1.5,
          strokeOpacity: 0.6,
          geodesic: true,
          map: guessMapRef.current,
        }),
      );
    }

    const fitVisibleMap = () => {
      if (!guessMapRef.current) return;
      refreshMapViewport();
      guessMapRef.current.fitBounds(bounds, 40);
    };
    const frameId = window.requestAnimationFrame(fitVisibleMap);
    const timerId = window.setTimeout(fitVisibleMap, 280);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [
    clearPendingMarker,
    clearResultOverlays,
    mapsReady,
    refreshMapViewport,
    resetMapViewport,
    room,
    t,
  ]);

  useEffect(() => {
    setGuessPin(null);
    clearPendingMarker();
    clearResultOverlays();
    if (room?.phase !== "playing") {
      resetMapViewport();
    }
  }, [
    clearPendingMarker,
    clearResultOverlays,
    resetMapViewport,
    room?.round?.index,
  ]);

  useEffect(() => {
    if (!room) {
      roomFeedbackRef.current = null;
      return;
    }

    const nextSnapshot = {
      phase: room.phase,
      roundIndex: room.round?.index || 0,
      opponentLocked: Boolean(room.round?.opponent_locked),
      meSubmitted: Boolean(room.me?.has_submitted_this_round),
    };
    const previous = roomFeedbackRef.current;
    if (!previous) {
      roomFeedbackRef.current = nextSnapshot;
      return;
    }

    const phaseChanged =
      previous.phase !== nextSnapshot.phase ||
      previous.roundIndex !== nextSnapshot.roundIndex;
    if (phaseChanged) {
      if (room.phase === "countdown") {
        playFeedback("ready");
        showFeedbackBubble(t("geo_online.feedback_countdown"), "success");
      } else if (room.phase === "playing") {
        playFeedback("ready");
        showFeedbackBubble(t("geo_online.feedback_round_start"), "target");
      } else if (room.phase === "reveal") {
        playFeedback("reveal");
        showFeedbackBubble(t("geo_online.feedback_reveal"), "target");
      } else if (room.phase === "finished") {
        playFeedback("finish");
        showFeedbackBubble(t("geo_online.feedback_finished"), "success");
      }
    }

    if (
      room.phase === "playing" &&
      !nextSnapshot.meSubmitted &&
      !previous.opponentLocked &&
      nextSnapshot.opponentLocked
    ) {
      playFeedback("place");
      showFeedbackBubble(t("geo_online.feedback_opponent_locked"), "opponent");
    }

    roomFeedbackRef.current = nextSnapshot;
  }, [room, playFeedback, showFeedbackBubble, t]);

  const runAction = useCallback(async (actionName, runner) => {
    setActionBusy(actionName);
    setActionError("");
    try {
      return await runner();
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      setActionBusy("");
    }
  }, []);

  const handleReadyToggle = async () => {
    if (!room) return;
    const readying = !room.me.is_ready;
    const res = await runAction("ready", () =>
      setGeoBattleReady(room.room_id, readying),
    );
    if (applyRoomResponse(res)) {
      playFeedback("ready");
      showFeedbackBubble(
        t(
          readying
            ? "geo_online.feedback_ready"
            : "geo_online.feedback_unready",
        ),
        "success",
      );
    } else {
      playFeedback("error");
      showFeedbackBubble(t("geo_online.feedback_error"), "danger");
    }
  };

  const handleZoomOut = async () => {
    if (!room) return;
    const res = await runAction("zoom", () => zoomOutGeoBattle(room.room_id));
    if (applyRoomResponse(res)) {
      playFeedback("zoom");
      showFeedbackBubble(t("geo_online.feedback_zoom_out"), "zoom");
    } else {
      playFeedback("error");
      showFeedbackBubble(t("geo_online.feedback_error"), "danger");
    }
  };

  const handleSubmitGuess = async () => {
    if (!room || !guessPin) return;
    const res = await runAction("guess", () =>
      submitGeoBattleGuess(room.room_id, {
        lat: guessPin.lat,
        lng: guessPin.lng,
      }),
    );
    if (applyRoomResponse(res)) {
      playFeedback("lock");
      showFeedbackBubble(t("geo_online.feedback_locked"), "target");
      setGuessPin(null);
    } else {
      playFeedback("error");
      showFeedbackBubble(t("geo_online.feedback_error"), "danger");
    }
  };

  const handleGiveUp = async () => {
    if (!room) return;
    const res = await runAction("give-up", () =>
      submitGeoBattleGuess(room.room_id, { give_up: true }),
    );
    if (applyRoomResponse(res)) {
      playFeedback("skip");
      showFeedbackBubble(t("geo_online.feedback_gave_up"), "warning");
      setGuessPin(null);
    } else {
      playFeedback("error");
      showFeedbackBubble(t("geo_online.feedback_error"), "danger");
    }
  };

  const handleLeaveRoom = async () => {
    if (!room) {
      navigate("/guess/online");
      return;
    }

    await runAction("leave", () => leaveGeoBattleRoom(room.room_id));
    navigate("/guess/online");
  };

  const handleCopyCode = async () => {
    if (!room?.room_code) return;
    try {
      await navigator.clipboard.writeText(room.room_code);
      setActionNotice(t("geo_online.code_copied"));
      playFeedback("place");
      showFeedbackBubble(t("geo_online.code_copied"), "success");
      window.setTimeout(() => setActionNotice(""), 1500);
    } catch {
      setActionError(t("geo_online.copy_failed"));
      playFeedback("error");
      showFeedbackBubble(t("geo_online.copy_failed"), "danger");
    }
  };

  const imageVersion = room
    ? `${room.phase}-${room.round?.index || 0}-${room.round?.current_zoom || 0}-${room.round?.zoom_steps || 0}`
    : "0";
  const imageAvailable = Boolean(
    room?.round &&
      (room.phase === "playing" ||
        room.phase === "reveal" ||
        room.phase === "finished"),
  );
  const imageForCurrentState =
    imageAvailable && displayedImageVersion === imageVersion;
  const imageInteractionPending =
    imageAvailable && !imageForCurrentState && !imgError;
  const showImageLoading =
    imageAvailable && imageLoading && !imageObjectUrl && !imgError;
  const remainingSeconds = getRemainingSeconds(
    room?.phase_deadline_at,
    clockOffsetRef.current,
    nowTick,
  );
  const outcomeLabel = getOutcomeLabel(room, t);

  useEffect(() => {
    if (!imageAvailable || !room?.room_id) {
      setImageObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        imageObjectUrlRef.current = null;
        return null;
      });
      displayedImageVersionRef.current = "";
      setDisplayedImageVersion("");
      setImageLoading(false);
      setImgLoaded(false);
      setImgError(false);
      setZoomTransition(null);
      return undefined;
    }

    let cancelled = false;
    let createdUrl = null;
    let activatedUrl = false;
    const controller = new AbortController();
    const hadVisibleImage = Boolean(imageObjectUrlRef.current);
    const previousImageVersion = displayedImageVersionRef.current;
    const transitionRequestId = zoomTransitionRequestRef.current + 1;
    zoomTransitionRequestRef.current = transitionRequestId;
    setImageLoading(true);
    if (!hadVisibleImage) {
      setImgLoaded(false);
    }
    setImgError(false);

    fetchGeoBattleImage(room.room_id, imageVersion, controller.signal)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        activatedUrl = true;
        const shouldAnimateZoom =
          hadVisibleImage &&
          previousImageVersion &&
          previousImageVersion !== imageVersion &&
          room?.phase === "playing" &&
          !(
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
          );
        setImageObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          imageObjectUrlRef.current = url;
          return url;
        });
        displayedImageVersionRef.current = imageVersion;
        setDisplayedImageVersion(imageVersion);
        setImageLoading(false);
        setImgLoaded(true);
        setImgError(false);
        if (shouldAnimateZoom) {
          setZoomTransition({
            toUrl: url,
            requestId: transitionRequestId,
            animationDone: false,
          });
          if (zoomTransitionTimerRef.current) {
            window.clearTimeout(zoomTransitionTimerRef.current);
          }
          zoomTransitionTimerRef.current = window.setTimeout(() => {
            setZoomTransition((current) =>
              current?.requestId === transitionRequestId
                ? { ...current, animationDone: true }
                : current,
            );
            zoomTransitionTimerRef.current = null;
          }, SATELLITE_ZOOM_TRANSITION_MS);
        } else {
          setZoomTransition(null);
        }
      })
      .catch((err) => {
        if (cancelled || err.name === "AbortError") return;
        setImageLoading(false);
        setImgError(true);
        setImgLoaded(true);
        feedbackRef.current.playFeedback("error");
        feedbackRef.current.showFeedbackBubble(
          feedbackRef.current.t("geo_online.feedback_image_error"),
          "danger",
        );
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (createdUrl && !activatedUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [imageAvailable, room?.room_id, imageVersion]);

  useEffect(() => {
    if (!zoomTransition?.animationDone || !imgLoaded) return;
    setZoomTransition(null);
  }, [zoomTransition, imgLoaded]);

  useEffect(() => {
    return () => {
      zoomTransitionRequestRef.current += 1;
      if (zoomTransitionTimerRef.current) {
        window.clearTimeout(zoomTransitionTimerRef.current);
      }
      if (imageObjectUrlRef.current) {
        URL.revokeObjectURL(imageObjectUrlRef.current);
        imageObjectUrlRef.current = null;
      }
    };
  }, []);

  if (fatalError && !room) {
    return (
      <div className="geo-battle-page">
        <div className="geo-battle-shell geo-battle-shell--error">
          <div className="geo-battle-title">{t("geo_online.room_missing")}</div>
          <div className="geo-battle-banner">{fatalError}</div>
          <button
            type="button"
            className="geo-battle-primary-btn"
            onClick={() => navigate("/guess/online")}
          >
            {t("geo_online.return_lobby")}
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="geo-battle-page">
        <div className="geo-battle-shell geo-battle-shell--loading">
          <div className="geo-battle-title">{t("geo_online.loading_room")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="geo-battle-page">
      <div className="geo-battle-shell">
        <div className="geo-battle-topbar">
          <button
            className="geo-battle-back"
            type="button"
            onClick={handleLeaveRoom}
          >
            ← {t("geo_online.leave_room")}
          </button>
          <div className="geo-battle-title-block">
            <div className="geo-battle-title">{t("geo_online.title")}</div>
            <div className="geo-battle-subtitle">
              {room.mode === "private"
                ? t("geo_online.private_room")
                : t("geo_online.match_room")}
            </div>
          </div>
          <div className="geo-battle-room-meta">
            <LanguageSwitch />
            {room.room_code && (
              <button
                type="button"
                className="geo-battle-room-code"
                onClick={handleCopyCode}
              >
                {t("geo_online.room_code_short")}: {room.room_code}
              </button>
            )}
            <GameSoundToggle
              enabled={soundEnabled}
              onToggle={toggleSound}
              enabledLabel={t("geo.feedback_sound_on")}
              disabledLabel={t("geo.feedback_sound_off")}
            />
            {syncFailures > 0 && (
              <span className="geo-battle-sync-warning">
                {t("geo_online.connection_unstable")}
              </span>
            )}
          </div>
        </div>

        <div className="geo-battle-status-bar">
          <PlayerStatusCard
            title={t("geo_online.you")}
            player={room.me}
            playerRole="player"
            currentPhase={room.phase}
            t={t}
          />
          <div
            className={`geo-battle-phase-card geo-battle-phase-card--${room.phase}`}
          >
            <div className="geo-battle-phase-label">
              {t("geo.round", { n: room.round?.index || 1 })} /{" "}
              {room.round?.total || 5}
            </div>
            <div className="geo-battle-phase-main">
              {getRoomMessage(room, t)}
            </div>
            {remainingSeconds !== null && (
              <div className="geo-battle-phase-timer">{remainingSeconds}s</div>
            )}
          </div>
          <PlayerStatusCard
            title={t("geo_online.opponent")}
            player={room.opponent}
            playerRole="opponent"
            currentPhase={room.phase}
            t={t}
          />
        </div>

        {(actionError || fatalError) && (
          <div className="geo-battle-banner">{actionError || fatalError}</div>
        )}
        {actionNotice && (
          <div className="geo-battle-notice">{actionNotice}</div>
        )}

        <div className="geo-battle-board">
          <div className="geo-battle-satellite">
            {imageAvailable ? (
              <>
                {imageObjectUrl && (
                  <img
                    key={imageObjectUrl}
                    src={imageObjectUrl}
                    alt=""
                    className={`geo-battle-satellite-img ${imgLoaded ? "loaded" : ""} ${
                      zoomTransition ? "geo-battle-satellite-img--handoff" : ""
                    }`}
                    onLoad={() => setImgLoaded(true)}
                    onError={() => {
                      setImgLoaded(true);
                      setImgError(true);
                      playFeedback("error");
                      showFeedbackBubble(
                        t("geo_online.feedback_image_error"),
                        "danger",
                      );
                    }}
                    draggable={false}
                  />
                )}
                {zoomTransition && (
                  <div
                    className="geo-battle-satellite-transition"
                    aria-hidden="true"
                  >
                    <img
                      src={zoomTransition.toUrl}
                      className="geo-battle-satellite-transition-img"
                      alt=""
                      draggable={false}
                      onAnimationEnd={() =>
                        setZoomTransition((current) =>
                          current?.requestId === zoomTransition.requestId
                            ? { ...current, animationDone: true }
                            : current,
                        )
                      }
                    />
                  </div>
                )}
                {showImageLoading && (
                  <div className="geo-battle-overlay">
                    <div className="geo-battle-spinner" />
                    <span>{t("geo_online.loading_image")}</span>
                  </div>
                )}
                {imgError && (
                  <div className="geo-battle-overlay">
                    <span>{t("geo_online.image_error")}</span>
                  </div>
                )}
                {imageObjectUrl && !imgError && (
                  <div
                    className={`geo-battle-satellite-center-pin ${
                      room.phase === "playing"
                        ? "geo-battle-satellite-center-pin--neutral"
                        : "geo-battle-satellite-center-pin--answer"
                    }`}
                    aria-label={t("geo.image_center")}
                  />
                )}
                {room.phase === "playing" && (
                  <div className="geo-battle-satellite-controls">
                    <button
                      type="button"
                      className="geo-battle-zoom-btn"
                      disabled={
                        !room.can_zoom_out ||
                        actionBusy !== "" ||
                        imageInteractionPending
                      }
                      onClick={handleZoomOut}
                      aria-busy={actionBusy === "zoom"}
                    >
                      {actionBusy === "zoom"
                        ? t("geo_online.loading")
                        : t("geo_online.zoom_out")}
                    </button>
                    <span>
                      {t("geo.zoom_out_count")}:{" "}
                      {t("geo.zoom_out_count_value", {
                        count: room.round?.zoom_steps || 0,
                      })}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="geo-battle-overlay geo-battle-overlay--placeholder">
                <span>{t("geo_online.waiting_image")}</span>
              </div>
            )}
          </div>

          <div className="geo-battle-map-panel">
            {mapsError ? (
              <div className="geo-battle-map-error">
                {t("geo_online.map_error")}
              </div>
            ) : (
              <div className="geo-battle-map-stage">
                <div ref={guessMapElRef} className="geo-battle-map" />
                {(!mapsReady || !mapReady) && (
                  <div className="geo-battle-map-loading">
                    <div className="geo-battle-spinner" />
                    <span>{t("geo_online.map_loading")}</span>
                  </div>
                )}

                {room.phase === "lobby" && (
                  <div className="geo-battle-controls geo-battle-controls--lobby">
                    <button
                      type="button"
                      className="geo-battle-primary-btn"
                      disabled={!room.can_ready || actionBusy !== ""}
                      onClick={handleReadyToggle}
                    >
                      {actionBusy === "ready"
                        ? t("geo_online.loading")
                        : room.me.is_ready
                          ? t("geo_online.unready")
                          : t("geo_online.ready")}
                    </button>
                    <button
                      type="button"
                      className="geo-battle-secondary-btn"
                      onClick={handleLeaveRoom}
                    >
                      {t("geo_online.leave_room")}
                    </button>
                  </div>
                )}

                {room.phase === "playing" && (
                  <div className="geo-battle-controls geo-battle-controls--playing">
                    {!guessPin && !room.me.has_submitted_this_round && (
                      <div className="geo-battle-click-hint">
                        {t("geo_online.place_guess")}
                      </div>
                    )}
                    <button
                      type="button"
                      className="geo-battle-primary-btn"
                      disabled={
                        !guessPin ||
                        !room.can_submit_guess ||
                        actionBusy !== "" ||
                        imageInteractionPending
                      }
                      onClick={handleSubmitGuess}
                    >
                      {actionBusy === "guess"
                        ? t("geo_online.loading")
                        : t("geo_online.submit_guess")}
                    </button>
                    <button
                      type="button"
                      className="geo-battle-secondary-btn"
                      disabled={!room.can_submit_guess || actionBusy !== ""}
                      onClick={handleGiveUp}
                    >
                      {actionBusy === "give-up"
                        ? t("geo_online.loading")
                        : t("geo_online.skip_round")}
                    </button>
                    <div className="geo-battle-side-copy">
                      {room.me.has_submitted_this_round
                        ? t("geo_online.locked_waiting")
                        : room.round?.opponent_locked
                          ? t("geo_online.opponent_locked")
                          : t("geo_online.place_guess")}
                    </div>
                    <BattleScoreBreakdown
                      round={room.round}
                      remainingSeconds={remainingSeconds}
                      t={t}
                    />
                  </div>
                )}

                {(room.phase === "preparing" || room.phase === "countdown") && (
                  <div className="geo-battle-controls geo-battle-controls--status">
                    <div className="geo-battle-side-copy">
                      {room.phase === "preparing"
                        ? t("geo_online.preparing")
                        : t("geo_online.round_starts_soon")}
                    </div>
                  </div>
                )}

                {room.phase === "reveal" && (
                  <RoundResultOverlay room={room} t={t} />
                )}

                {room.phase === "finished" && (
                  <FinalResultOverlay
                    room={room}
                    outcomeLabel={outcomeLabel}
                    actionBusy={actionBusy}
                    onReady={handleReadyToggle}
                    onLeave={handleLeaveRoom}
                    t={t}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <GameFeedbackBubbles bubbles={feedbackBubbles} />
    </div>
  );
}

export default function GeoBattlePage() {
  const { roomId } = useParams();

  if (roomId) {
    return <GeoBattleRoomPage roomId={roomId} />;
  }

  return <GeoBattleHubPage />;
}
