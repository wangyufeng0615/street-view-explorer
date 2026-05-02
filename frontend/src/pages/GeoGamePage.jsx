import React, {
  useReducer,
  useEffect,
  useRef,
  useCallback,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { loadGoogleMapsScript } from "../utils/googleMaps";
import { getRandomLocation } from "../services/api";
import {
  TOTAL_ROUNDS,
  START_ZOOM,
  MIN_ZOOM,
  PERFECT_GUESS_DISTANCE_KM,
  haversineDistance,
  calculateScore,
  formatDistance,
  generateRoundPlan,
  isPerfectGuess,
  jitterCoord,
} from "../utils/geoGameUtils";
import "../styles/GeoGame.css";

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
const RESULT_PIN_SPREAD_DISTANCE_KM = 50;
const RESULT_PIN_OFFSET_PX = 16;

// ─── State ──────────────────────────────────────────────────

const initialState = {
  phase: "WELCOME",
  round: 0,
  scores: [],
  target: null, // { lat, lng, address?, country? }
  zoomSteps: 0,
  currentZoom: START_ZOOM,
  guessPin: null,
  guessResult: null, // { lat, lng, distance, score } or { lat:null, lng:null, distance:null, score:0 } for give-up
  aiEnabled: false,
  aiGuess: null,
  aiLoading: false,
  roundPlan: null, // Array<{ source: 'database'|'random', entry? }>
};

function reducer(state, action) {
  switch (action.type) {
    case "START_GAME": {
      const roundPlan = generateRoundPlan(TOTAL_ROUNDS);
      return {
        ...initialState,
        phase: "LOADING",
        round: 1,
        aiEnabled: action.aiEnabled ?? state.aiEnabled,
        roundPlan,
      };
    }
    case "SET_TARGET":
      return { ...state, phase: "PLAYING", target: action.payload };
    case "ZOOM_OUT":
      if (state.currentZoom <= MIN_ZOOM) return state;
      return {
        ...state,
        zoomSteps: state.zoomSteps + 1,
        currentZoom: state.currentZoom - 1,
      };
    case "PLACE_PIN":
      return { ...state, guessPin: action.payload };
    case "LOCK_IN": {
      const { lat, lng } = state.guessPin;
      const dist = haversineDistance(
        lat,
        lng,
        state.target.lat,
        state.target.lng,
      );
      const score = calculateScore(state.zoomSteps, dist);
      return {
        ...state,
        phase: "ROUND_RESULT",
        guessResult: { lat, lng, distance: dist, score },
        guessPin: null,
        aiGuess: null,
        aiLoading: state.aiEnabled,
      };
    }
    case "GIVE_UP":
      return {
        ...state,
        phase: "ROUND_RESULT",
        guessResult: { lat: null, lng: null, distance: null, score: 0 },
        guessPin: null,
        aiGuess: null,
        aiLoading: state.aiEnabled,
      };
    case "SET_AI_GUESS":
      return { ...state, aiGuess: action.payload, aiLoading: false };
    case "SET_AI_LOADING":
      return { ...state, aiLoading: true };
    case "NEXT_ROUND": {
      const roundResult = {
        playerScore: state.guessResult?.score || 0,
        distance: state.guessResult?.distance ?? null,
        zoomSteps: state.zoomSteps,
        aiScore: state.aiGuess?.score ?? null,
        aiDistance: state.aiGuess?.distance ?? null,
        locationLabel: getRoundLocationLabel(state.target),
      };
      const newScores = [...state.scores, roundResult];
      const isLast = state.round >= TOTAL_ROUNDS;
      return {
        ...state,
        scores: newScores,
        phase: isLast ? "GAME_OVER" : "LOADING",
        round: isLast ? state.round : state.round + 1,
        target: null,
        zoomSteps: 0,
        currentZoom: START_ZOOM,
        guessPin: null,
        guessResult: null,
        aiGuess: null,
        aiLoading: false,
        roundPlan: state.roundPlan, // preserve across rounds
      };
    }
    case "RESTART":
      return { ...initialState };
    default:
      return state;
  }
}

function satUrl(target, zoom) {
  return `/api/v1/geo/satellite?lat=${target.lat}&lng=${target.lng}&zoom=${zoom}`;
}

function getGeoLanguage(i18n) {
  const language = i18n.resolvedLanguage || i18n.language || "en";
  return language.startsWith("zh") ? "zh" : "en";
}

function createGuessPinIcon(maps, color, headOffsetX = 0) {
  const width = 74;
  const tipX = width / 2;
  const headX = tipX + headOffsetX;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="44" viewBox="0 0 ${width} 44">
      <path d="M${tipX} 42C${tipX + headOffsetX * 0.45} 38 ${headX + 14} 25.7 ${headX + 14} 15.4C${headX + 14} 7.8 ${headX + 7.7} 2 ${headX} 2C${headX - 7.7} 2 ${headX - 14} 7.8 ${headX - 14} 15.4C${headX - 14} 25.7 ${tipX - headOffsetX * 0.45} 38 ${tipX} 42Z" fill="${color}" stroke="#ffffff" stroke-width="3"/>
      <circle cx="${headX}" cy="15.5" r="5.5" fill="#ffffff" fill-opacity="0.94"/>
    </svg>
  `;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new maps.Size(width, 44),
    anchor: new maps.Point(tipX, 42),
  };
}

function getResultPinOffsets(target, guessResult, aiGuess) {
  const closePlayer =
    guessResult?.lat != null &&
    guessResult.distance <= RESULT_PIN_SPREAD_DISTANCE_KM;
  const closeAtlas =
    aiGuess &&
    haversineDistance(target.lat, target.lng, aiGuess.lat, aiGuess.lng) <=
      RESULT_PIN_SPREAD_DISTANCE_KM;

  if (closePlayer && closeAtlas) {
    return {
      target: 0,
      player: -RESULT_PIN_OFFSET_PX,
      atlas: RESULT_PIN_OFFSET_PX,
    };
  }
  if (closePlayer) {
    return {
      target: RESULT_PIN_OFFSET_PX / 2,
      player: -RESULT_PIN_OFFSET_PX / 2,
      atlas: 0,
    };
  }
  if (closeAtlas) {
    return {
      target: RESULT_PIN_OFFSET_PX / 2,
      player: 0,
      atlas: -RESULT_PIN_OFFSET_PX / 2,
    };
  }
  return { target: 0, player: 0, atlas: 0 };
}

function formatPerfectDistanceLabel() {
  return PERFECT_GUESS_DISTANCE_KM === 1
    ? "1 km"
    : formatDistance(PERFECT_GUESS_DISTANCE_KM);
}

function formatPerfectDistanceShortLabel(t) {
  return PERFECT_GUESS_DISTANCE_KM === 1
    ? t("geo.one_km")
    : formatDistance(PERFECT_GUESS_DISTANCE_KM);
}

function formatResultDistance(distance, t, compact = false) {
  if (isPerfectGuess(distance)) {
    if (compact) {
      return t("geo.perfect_distance_short", {
        distance: formatPerfectDistanceShortLabel(t),
      });
    }
    return t("geo.perfect_guess_distance", {
      distance: formatPerfectDistanceLabel(),
    });
  }
  return formatDistance(distance);
}

function formatScore(t, score) {
  return t("geo.score_value", { score: score.toLocaleString() });
}

function formatPlainScore(t, score) {
  if (score == null) return "-";
  return t("geo.plain_score_value", { score: score.toLocaleString() });
}

function formatScoreboardScore(t, score) {
  return t("geo.scoreboard_score", { score: score.toLocaleString() });
}

function sanitizePlacePart(value) {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/\b\d{4,}\b/g, "")
    .trim();
}

function looksLikePreciseAddress(value) {
  return (
    /^[A-Z0-9]{3,}\+/.test(value) ||
    /\d/.test(value) ||
    /\b(road|street|avenue|lane|drive|highway|route|rd|st|ave)\b/i.test(value)
  );
}

function getRoundLocationLabel(target) {
  if (!target) return "";
  const country = sanitizePlacePart(target.country);
  const address = sanitizePlacePart(target.address);
  if (!address) return country || "";

  const parts = address.split(",").map(sanitizePlacePart).filter(Boolean);
  const countryLower = country.toLowerCase();
  const broadParts = parts.filter((part) => {
    const partLower = part.toLowerCase();
    return (
      partLower !== countryLower &&
      !partLower.includes(countryLower) &&
      !looksLikePreciseAddress(part)
    );
  });
  const place = broadParts.length > 0 ? broadParts[broadParts.length - 1] : "";
  if (country && place) return `${country} · ${place}`;
  return country || place || address;
}

function getCurrentPlayerScore(state) {
  const completedScore = state.scores.reduce(
    (sum, r) => sum + r.playerScore,
    0,
  );
  const pendingScore =
    state.phase === "ROUND_RESULT" ? state.guessResult?.score || 0 : 0;
  return completedScore + pendingScore;
}

function getCurrentAtlasScore(state) {
  const completedScore = state.scores.reduce(
    (sum, r) => sum + (r.aiScore || 0),
    0,
  );
  const pendingScore =
    state.phase === "ROUND_RESULT" ? state.aiGuess?.score || 0 : 0;
  return completedScore + pendingScore;
}

function MarkerPin({ type }) {
  return (
    <span
      className={`geo-marker-pin ${PLAYER_MARKERS[type].className}`}
      aria-hidden="true"
    />
  );
}

function ResultLabel({ type, children }) {
  return (
    <div className="geo-result-label geo-result-label--with-marker">
      <MarkerPin type={type} />
      {children}
    </div>
  );
}

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
        value={formatResultDistance(distance, t, true)}
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

// ─── Component ──────────────────────────────────────────────

export default function GeoGamePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeGeoLanguage = getGeoLanguage(i18n);

  const guessMapElRef = useRef(null);
  const guessInstanceRef = useRef(null);
  const mapsAPIRef = useRef(null);
  const pendingMarkerRef = useRef(null);
  const resultMarkersRef = useRef([]);
  const resultLinesRef = useRef([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  // ─── Fetch location: database entry or random API ───
  // Active language is read via ref to avoid re-triggering round selection.
  const langRef = useRef(activeGeoLanguage);
  langRef.current = activeGeoLanguage;

  useEffect(() => {
    if (state.phase !== "LOADING" || !state.roundPlan) return;
    const plan = state.roundPlan[state.round - 1];

    // Database round — use curated entry, no network call
    if (plan && plan.source === "database") {
      const e = plan.entry;
      const { lat, lng } = jitterCoord(e.lat, e.lng);
      const isZh = langRef.current === "zh";
      const name = isZh ? e.nameZh : e.name;
      const country = isZh ? e.countryZh : e.country;
      dispatch({
        type: "SET_TARGET",
        payload: { lat, lng, address: `${name}, ${country}`, country },
      });
      return;
    }

    // Random round — call API
    let cancelled = false;
    (async () => {
      const res = await getRandomLocation(null, "geo_game");
      if (cancelled) return;
      if (res.success && res.data) {
        const d = res.data;
        dispatch({
          type: "SET_TARGET",
          payload: {
            lat: d.latitude,
            lng: d.longitude,
            address: d.formatted_address,
            country: d.country,
          },
        });
      } else {
        const retry = await getRandomLocation(null, "geo_game");
        if (cancelled) return;
        if (retry.success && retry.data) {
          const d = retry.data;
          dispatch({
            type: "SET_TARGET",
            payload: {
              lat: d.latitude,
              lng: d.longitude,
              address: d.formatted_address,
              country: d.country,
            },
          });
        } else {
          dispatch({ type: "RESTART" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.round, state.roundPlan]);

  // ─── Load Google Maps API (with error handling) ───
  useEffect(() => {
    loadGoogleMapsScript()
      .then((maps) => {
        mapsAPIRef.current = maps;
        setMapsReady(true);
      })
      .catch(() => setMapsError(true));
  }, []);

  // ─── Init guess map ───
  useEffect(() => {
    if (!mapsReady || !guessMapElRef.current || guessInstanceRef.current)
      return;
    const maps = mapsAPIRef.current;

    guessInstanceRef.current = new maps.Map(guessMapElRef.current, {
      center: { lat: 20, lng: 0 },
      zoom: 2,
      mapTypeId: "roadmap",
      disableDefaultUI: true,
      zoomControl: true,
    });

    guessInstanceRef.current.addListener("click", (e) => {
      const s = stateRef.current;
      if (s.phase !== "PLAYING") return;
      const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      dispatch({ type: "PLACE_PIN", payload: pos });
      if (pendingMarkerRef.current) {
        pendingMarkerRef.current.setPosition(pos);
      } else {
        pendingMarkerRef.current = new maps.Marker({
          position: pos,
          map: guessInstanceRef.current,
          icon: createGuessPinIcon(maps, PLAYER_MARKERS.player.color),
          zIndex: 40,
        });
      }
    });
  }, [mapsReady]);

  // ─── Preload next zoom level ───
  useEffect(() => {
    if (!state.target || state.phase !== "PLAYING") return;
    const nextZoom = state.currentZoom - 1;
    if (nextZoom < MIN_ZOOM) return;
    const img = new Image();
    img.src = satUrl(state.target, nextZoom);
  }, [state.currentZoom, state.target, state.phase]);

  // ─── Reset image state on zoom change ───
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [state.currentZoom, state.target]);

  // ─── Show result markers (re-runs when AI guess arrives late) ───
  useEffect(() => {
    if (state.phase !== "ROUND_RESULT" || !mapsAPIRef.current || !state.target)
      return;
    const maps = mapsAPIRef.current;
    const tp = { lat: state.target.lat, lng: state.target.lng };

    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setMap(null);
      pendingMarkerRef.current = null;
    }
    resultMarkersRef.current.forEach((m) => m.setMap(null));
    resultMarkersRef.current = [];
    resultLinesRef.current.forEach((l) => l.setMap(null));
    resultLinesRef.current = [];
    const pinOffsets = getResultPinOffsets(
      state.target,
      state.guessResult,
      state.aiGuess,
    );

    // Target (green)
    resultMarkersRef.current.push(
      new maps.Marker({
        position: tp,
        map: guessInstanceRef.current,
        icon: createGuessPinIcon(
          maps,
          PLAYER_MARKERS.target.color,
          pinOffsets.target,
        ),
        zIndex: 20,
      }),
    );

    // Player guess (red) — skip if gave up (lat is null)
    if (state.guessResult && state.guessResult.lat != null) {
      const gp = { lat: state.guessResult.lat, lng: state.guessResult.lng };
      resultMarkersRef.current.push(
        new maps.Marker({
          position: gp,
          map: guessInstanceRef.current,
          icon: createGuessPinIcon(
            maps,
            PLAYER_MARKERS.player.color,
            pinOffsets.player,
          ),
          zIndex: 40,
        }),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [gp, tp],
          strokeColor: PLAYER_MARKERS.player.color,
          strokeWeight: 2,
          strokeOpacity: 0.7,
          geodesic: false,
          map: guessInstanceRef.current,
        }),
      );
    }

    // AI guess (purple)
    if (state.aiGuess) {
      const ap = { lat: state.aiGuess.lat, lng: state.aiGuess.lng };
      resultMarkersRef.current.push(
        new maps.Marker({
          position: ap,
          map: guessInstanceRef.current,
          icon: createGuessPinIcon(
            maps,
            PLAYER_MARKERS.atlas.color,
            pinOffsets.atlas,
          ),
          zIndex: 30,
        }),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [ap, tp],
          strokeColor: PLAYER_MARKERS.atlas.color,
          strokeWeight: 1.5,
          strokeOpacity: 0.6,
          geodesic: false,
          map: guessInstanceRef.current,
        }),
      );
    }

    const bounds = new maps.LatLngBounds();
    bounds.extend(tp);
    if (state.guessResult && state.guessResult.lat != null)
      bounds.extend({ lat: state.guessResult.lat, lng: state.guessResult.lng });
    if (state.aiGuess)
      bounds.extend({ lat: state.aiGuess.lat, lng: state.aiGuess.lng });

    const fitVisibleMap = () => {
      if (!guessInstanceRef.current) return;
      maps.event.trigger(guessInstanceRef.current, "resize");
      guessInstanceRef.current.fitBounds(bounds, 32);
    };
    const frame = window.requestAnimationFrame(fitVisibleMap);
    const timer = window.setTimeout(fitVisibleMap, 320);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [state.phase, state.aiGuess, mapsReady]);

  // ─── AI guess ───
  const aiControllerRef = useRef(null);
  useEffect(() => {
    if (state.phase !== "ROUND_RESULT" || !state.target || !state.aiEnabled)
      return;
    if (aiControllerRef.current) aiControllerRef.current.abort();
    const controller = new AbortController();
    aiControllerRef.current = controller;

    dispatch({ type: "SET_AI_LOADING" });
    fetch("/api/v1/geo/ai-guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: state.target.lat,
        lng: state.target.lng,
        zoom: state.currentZoom,
        lang: activeGeoLanguage,
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data) {
          const { lat, lng, reasoning } = data.data;
          const dist = haversineDistance(
            lat,
            lng,
            state.target.lat,
            state.target.lng,
          );
          dispatch({
            type: "SET_AI_GUESS",
            payload: {
              lat,
              lng,
              distance: dist,
              score: calculateScore(state.zoomSteps, dist),
              reasoning,
            },
          });
        } else {
          dispatch({ type: "SET_AI_GUESS", payload: null });
        }
      })
      .catch(() => dispatch({ type: "SET_AI_GUESS", payload: null }));

    return () => {
      controller.abort();
      aiControllerRef.current = null;
    };
  }, [
    state.phase,
    state.target,
    state.aiEnabled,
    state.currentZoom,
    state.zoomSteps,
    activeGeoLanguage,
  ]);

  // ─── Cleanup ───
  function cleanupMarkers() {
    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setMap(null);
      pendingMarkerRef.current = null;
    }
    resultMarkersRef.current.forEach((m) => m.setMap(null));
    resultMarkersRef.current = [];
    resultLinesRef.current.forEach((l) => l.setMap(null));
    resultLinesRef.current = [];
    if (guessInstanceRef.current) {
      guessInstanceRef.current.setCenter({ lat: 20, lng: 0 });
      guessInstanceRef.current.setZoom(2);
    }
  }
  const handleNextRound = useCallback(() => {
    if (stateRef.current.aiEnabled && stateRef.current.aiLoading) return;
    cleanupMarkers();
    dispatch({ type: "NEXT_ROUND" });
  }, []);
  const handleRestart = useCallback(() => {
    cleanupMarkers();
    dispatch({ type: "RESTART" });
  }, []);

  const satelliteUrl = state.target
    ? satUrl(state.target, state.currentZoom)
    : null;
  const canZoomOut = state.currentZoom > MIN_ZOOM && state.phase === "PLAYING";
  const playerScore = getCurrentPlayerScore(state);
  const atlasScore = state.aiEnabled ? getCurrentAtlasScore(state) : null;

  return (
    <div className="geo-game">
      {state.phase !== "WELCOME" && (
        <div className="geo-topbar">
          <div className="geo-topbar-left">
            <button className="geo-topbar-back" onClick={() => navigate("/")}>
              ← {t("geo.back")}
            </button>
            <span className="geo-topbar-title">{t("geo.title")}</span>
          </div>
          {state.round > 0 && (
            <div className="geo-topbar-right">
              <span className="geo-score-badge geo-score-badge--round">
                {t("geo.round_progress", {
                  current: state.round,
                  total: TOTAL_ROUNDS,
                })}
              </span>
              <span className="geo-score-badge geo-score-badge--player">
                <MarkerPin type="player" />
                {t("geo.you")}: {formatScoreboardScore(t, playerScore)}
              </span>
              {atlasScore !== null && (
                <span className="geo-score-badge geo-score-badge--atlas">
                  <MarkerPin type="atlas" />
                  Atlas: {formatScoreboardScore(t, atlasScore)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="geo-main">
        <div className="geo-satellite">
          {satelliteUrl && (
            <img
              key={satelliteUrl}
              src={satelliteUrl}
              className={`geo-satellite-img ${imgLoaded ? "loaded" : ""}`}
              alt=""
              draggable={false}
              onLoad={() => setImgLoaded(true)}
              onError={() => {
                setImgError(true);
                setImgLoaded(true);
              }}
            />
          )}
          {(state.phase === "LOADING" ||
            (state.phase === "PLAYING" && !imgLoaded)) && (
            <div className="geo-loading-overlay">
              <div className="geo-loading-spinner" />
              {state.phase === "LOADING" ? t("geo.loading") : ""}
            </div>
          )}
          {imgError && state.phase === "PLAYING" && (
            <div className="geo-loading-overlay">
              <span>{t("geo.image_error")}</span>
            </div>
          )}
          {state.target &&
            (state.phase === "PLAYING" || state.phase === "ROUND_RESULT") && (
              <div
                className={`geo-satellite-center-pin ${
                  state.phase === "ROUND_RESULT"
                    ? "geo-satellite-center-pin--answer"
                    : "geo-satellite-center-pin--neutral"
                }`}
                aria-label={t("geo.image_center")}
              />
            )}
          {state.phase === "PLAYING" && (
            <div className="geo-satellite-controls">
              <button
                className="geo-zoom-out-btn geo-zoom-out-btn--satellite"
                disabled={!canZoomOut}
                onClick={() => dispatch({ type: "ZOOM_OUT" })}
              >
                {t("geo.zoom_out")}
              </button>
              <span>
                {t("geo.zoom_out_count")}:{" "}
                {t("geo.zoom_out_count_value", { count: state.zoomSteps })}
              </span>
            </div>
          )}
        </div>

        <div className="geo-guess-panel">
          <div className="geo-guess-map-area">
            {mapsError ? (
              <div className="geo-map-error">{t("geo.map_error")}</div>
            ) : (
              <div ref={guessMapElRef} className="geo-map-container" />
            )}
          </div>
          {state.phase === "PLAYING" && (
            <div className="geo-guess-controls">
              {!state.guessPin && (
                <span className="geo-click-hint">{t("geo.click_map")}</span>
              )}
              <button
                className="geo-lock-in"
                disabled={!state.guessPin}
                onClick={() => dispatch({ type: "LOCK_IN" })}
              >
                {t("geo.lock_in")}
              </button>
              <button
                className="geo-give-up"
                onClick={() => dispatch({ type: "GIVE_UP" })}
              >
                {t("geo.give_up")}
              </button>
            </div>
          )}
          {state.phase === "ROUND_RESULT" && (
            <RoundResult state={state} t={t} onNext={handleNextRound} />
          )}
        </div>
      </div>

      {state.phase === "WELCOME" && (
        <WelcomeModal dispatch={dispatch} t={t} navigate={navigate} />
      )}
      {state.phase === "GAME_OVER" && (
        <GameOverModal
          state={state}
          t={t}
          onRestart={handleRestart}
          onNext={handleNextRound}
        />
      )}
    </div>
  );
}

// ─── WelcomeModal ───

function WelcomeModal({ dispatch, t, navigate }) {
  return (
    <div className="geo-modal-overlay">
      <div className="geo-modal geo-welcome-modal">
        <div className="geo-modal-title">{t("geo.title")}</div>
        <div className="geo-modal-subtitle">{t("geo.subtitle")}</div>
        <div className="geo-welcome-actions">
          <button
            className="geo-start-btn geo-start-btn--atlas"
            onClick={() => dispatch({ type: "START_GAME", aiEnabled: true })}
          >
            {t("geo.start_atlas")}
          </button>
          <button
            className="geo-secondary-btn geo-secondary-btn--friend"
            onClick={() => navigate("/geo/online")}
          >
            {t("geo.invite_friend_online")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RoundResult ───

function RoundResult({ state, t, onNext }) {
  const gaveUp = state.guessResult && state.guessResult.lat == null;

  return (
    <div className="geo-result-panel">
      <div className="geo-result-body">
        <div className="geo-result-title">
          {t("geo.round", { n: state.round })} — {t("geo.result")}
        </div>

        {/* Actual location reveal */}
        {state.target && (state.target.address || state.target.country) && (
          <div className="geo-result-location">
            <MarkerPin type="target" />
            <div>
              <span>{t("geo.actual_location")}</span>
              <strong>{state.target.address || state.target.country}</strong>
            </div>
          </div>
        )}

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

      <button
        className="geo-result-btn"
        disabled={state.aiEnabled && state.aiLoading}
        onClick={onNext}
      >
        {state.aiEnabled && state.aiLoading
          ? t("geo.ai_thinking")
          : state.round >= TOTAL_ROUNDS
            ? t("geo.see_results")
            : t("geo.next_round")}
      </button>
    </div>
  );
}

// ─── GameOverModal ───

function GameOverModal({ state, t, onRestart, onNext }) {
  useEffect(() => {
    if (state.scores.length < TOTAL_ROUNDS) onNext();
  }, []);
  const playerTotal = state.scores.reduce((s, r) => s + r.playerScore, 0);
  const aiTotal = state.aiEnabled
    ? state.scores.reduce((s, r) => s + (r.aiScore || 0), 0)
    : null;
  const playerWon = aiTotal === null || playerTotal >= aiTotal;

  return (
    <div className="geo-modal-overlay">
      <div className="geo-modal geo-gameover-modal">
        <div className="geo-gameover-header">
          <div>
            <div className="geo-gameover-kicker">
              {state.aiEnabled
                ? playerWon
                  ? t("geo.gameover_win")
                  : t("geo.gameover_lose")
                : t("geo.total_score")}
            </div>
            <div className="geo-modal-title">{t("geo.game_over")}</div>
          </div>
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
                    ? formatResultDistance(r.distance, t, true)
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
