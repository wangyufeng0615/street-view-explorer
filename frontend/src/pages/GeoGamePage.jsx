import {
  initialState,
  reducer,
  normalizeCountryCode,
} from "../utils/geoGameState";
import {
  PLAYER_MARKERS,
  getCurrentPlayerScore,
  getCurrentAtlasScore,
  formatScoreboardScore,
  MarkerPin,
  WelcomeModal,
  RoundResult,
  GameOverModal,
} from "../components/GeoGameResults";
import React, {
  useReducer,
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { loadGoogleMapsScript } from "../utils/googleMaps";
import { getRandomLocation } from "../services/api";
import LanguageSwitch from "../components/LanguageSwitch";
import {
  GameFeedbackBubbles,
  GameSoundToggle,
} from "../components/GameFeedback";
import { useGameFeedback } from "../hooks/useGameFeedback";
import {
  TOTAL_ROUNDS,
  START_ZOOM,
  MIN_ZOOM,
  haversineDistance,
  calculateScore,
  hasSamePanoTarget,
  isRoundTargetDuplicate,
  jitterCoord,
} from "../utils/geoGameUtils";
import "../styles/GeoGame.css";

const RESULT_PIN_SPREAD_DISTANCE_KM = 50;
const RESULT_PIN_OFFSET_PX = 16;
const STATIC_MAP_MAX_SIDE = 640;
const STATIC_MAP_MIN_SIDE = 120;
const SATELLITE_ZOOM_TRANSITION_MS = 760;
const RANDOM_TARGET_MAX_ATTEMPTS = 6;
const RANDOM_TARGET_MAX_FAILURES = 2;

// URL preferences and satellite preparation.

function getCountryCodeFromSearch(search) {
  const params = new URLSearchParams(search || "");
  return normalizeCountryCode(
    params.get("country") ||
      params.get("country_code") ||
      params.get("countryCode") ||
      "",
  );
}

function getSatelliteRequestSize(width, height) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const aspect = width / height;
  let requestWidth;
  let requestHeight;

  if (aspect >= 1) {
    requestWidth = STATIC_MAP_MAX_SIDE;
    requestHeight = Math.round(STATIC_MAP_MAX_SIDE / aspect);
  } else {
    requestHeight = STATIC_MAP_MAX_SIDE;
    requestWidth = Math.round(STATIC_MAP_MAX_SIDE * aspect);
  }

  return {
    width: Math.max(
      STATIC_MAP_MIN_SIDE,
      Math.min(STATIC_MAP_MAX_SIDE, requestWidth),
    ),
    height: Math.max(
      STATIC_MAP_MIN_SIDE,
      Math.min(STATIC_MAP_MAX_SIDE, requestHeight),
    ),
  };
}

function getInitialSatelliteRequestSize() {
  if (typeof window === "undefined") return null;
  const rightPanelWidth = 380;
  const topbarHeight = 50;
  return getSatelliteRequestSize(
    window.innerWidth - rightPanelWidth,
    window.innerHeight - topbarHeight,
  );
}

function isSameSatelliteRequestSize(a, b) {
  return a?.width === b?.width && a?.height === b?.height;
}

function satUrl(target, zoom, size) {
  const params = new URLSearchParams({
    lat: String(target.lat),
    lng: String(target.lng),
    zoom: String(zoom),
  });
  if (size) {
    params.set("width", String(size.width));
    params.set("height", String(size.height));
  }
  return `/api/v1/geo/satellite?${params.toString()}`;
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

function getDatabaseRoundTarget(entry, language) {
  const { lat, lng } = jitterCoord(entry.lat, entry.lng);
  const isZh = language === "zh";
  const name = isZh ? entry.nameZh : entry.name;
  const country = isZh ? entry.countryZh : entry.country;
  return { lat, lng, address: `${name}, ${country}`, country };
}

async function getRandomRoundTarget(language, countryCode, usedTargets = []) {
  let failures = 0;
  let nearestFallback = null;
  for (let attempt = 0; attempt < RANDOM_TARGET_MAX_ATTEMPTS; attempt++) {
    const res = await getRandomLocation(language, "geo_game", countryCode);
    if (res.success && res.data) {
      const d = res.data;
      const target = {
        lat: d.latitude,
        lng: d.longitude,
        address: d.formatted_address,
        country: d.country,
        panoId: d.pano_id || d.panoId || "",
      };
      if (isRoundTargetDuplicate(target, usedTargets)) {
        if (!hasSamePanoTarget(target, usedTargets) && !nearestFallback) {
          nearestFallback = target;
        }
        continue;
      }
      return target;
    }
    failures += 1;
    if (failures >= RANDOM_TARGET_MAX_FAILURES) break;
  }
  return nearestFallback;
}

async function resolveRoundTarget(
  plan,
  language,
  countryCode,
  usedTargets = [],
) {
  if (plan?.source === "database") {
    const target = getDatabaseRoundTarget(plan.entry, language);
    if (!isRoundTargetDuplicate(target, usedTargets)) return target;
    return getRandomRoundTarget(language, countryCode, usedTargets);
  }
  return getRandomRoundTarget(language, countryCode, usedTargets);
}

// ─── Component ──────────────────────────────────────────────

export default function GeoGamePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeGeoLanguage = getGeoLanguage(i18n);
  const countryCodeFromUrl = useMemo(
    () =>
      getCountryCodeFromSearch(
        typeof window === "undefined" ? "" : window.location.search,
      ),
    [],
  );

  const satelliteElRef = useRef(null);
  const guessMapElRef = useRef(null);
  const guessInstanceRef = useRef(null);
  const mapsAPIRef = useRef(null);
  const pendingMarkerRef = useRef(null);
  const resultMarkersRef = useRef([]);
  const resultLinesRef = useRef([]);
  const stateRef = useRef(state);
  const preloadedTargetsRef = useRef({});
  stateRef.current = state;

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [zoomTransition, setZoomTransition] = useState(null);
  const [zoomTransitionLoading, setZoomTransitionLoading] = useState(false);
  const [satelliteImageSize, setSatelliteImageSize] = useState(
    getInitialSatelliteRequestSize,
  );
  const {
    bubbles: feedbackBubbles,
    showFeedbackBubble,
    playFeedback,
    soundEnabled,
    toggleSound,
  } = useGameFeedback({ storageKey: "geoGameSound" });
  const zoomTransitionRequestRef = useRef(0);
  const zoomTransitionTimerRef = useRef(null);
  const feedbackRef = useRef({ showFeedbackBubble, playFeedback, t });
  feedbackRef.current = { showFeedbackBubble, playFeedback, t };
  const phaseFeedbackRef = useRef({
    phase: initialState.phase,
    round: initialState.round,
    aiGuessReady: false,
  });

  // ─── Fetch location: database entry or random API ───
  // Active language is read via ref to avoid re-triggering round selection.
  const langRef = useRef(activeGeoLanguage);
  langRef.current = activeGeoLanguage;

  useEffect(() => {
    if (state.phase !== "LOADING" || !state.roundPlan) return;
    const plan = state.roundPlan[state.round - 1];
    const preloadedTarget = preloadedTargetsRef.current[state.round];
    if (preloadedTarget) {
      delete preloadedTargetsRef.current[state.round];
      if (!isRoundTargetDuplicate(preloadedTarget, state.usedTargets)) {
        dispatch({ type: "SET_TARGET", payload: preloadedTarget });
        return;
      }
    }

    let cancelled = false;
    (async () => {
      const target = await resolveRoundTarget(
        plan,
        langRef.current,
        state.countryCode,
        state.usedTargets,
      );
      if (cancelled) return;
      dispatch(
        target ? { type: "SET_TARGET", payload: target } : { type: "RESTART" },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    state.phase,
    state.round,
    state.roundPlan,
    state.countryCode,
    state.usedTargets,
  ]);

  // ─── Load Google Maps API (with error handling) ───
  useEffect(() => {
    loadGoogleMapsScript()
      .then((maps) => {
        mapsAPIRef.current = maps;
        setMapsReady(true);
      })
      .catch(() => setMapsError(true));
  }, []);

  useEffect(() => {
    if (state.phase === "WELCOME") return;
    const el = satelliteElRef.current;
    if (!el) return;

    const updateSatelliteSize = () => {
      const rect = el.getBoundingClientRect();
      const nextSize = getSatelliteRequestSize(rect.width, rect.height);
      if (!nextSize) return;
      setSatelliteImageSize((currentSize) =>
        isSameSatelliteRequestSize(currentSize, nextSize)
          ? currentSize
          : nextSize,
      );
    };

    updateSatelliteSize();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateSatelliteSize);
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateSatelliteSize);
    return () => window.removeEventListener("resize", updateSatelliteSize);
  }, [state.phase]);

  // ─── Init guess map ───
  useEffect(() => {
    if (state.phase === "WELCOME") return;
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
      const hadPin = Boolean(s.guessPin);
      dispatch({ type: "PLACE_PIN", payload: pos });
      feedbackRef.current.playFeedback("place");
      feedbackRef.current.showFeedbackBubble(
        feedbackRef.current.t(
          hadPin ? "geo.feedback_pin_moved" : "geo.feedback_pin_placed",
        ),
        "player",
      );
      if (pendingMarkerRef.current) {
        pendingMarkerRef.current.setPosition(pos);
      } else {
        pendingMarkerRef.current = new maps.Marker({
          position: pos,
          map: guessInstanceRef.current,
          icon: createGuessPinIcon(maps, PLAYER_MARKERS.player.color),
          clickable: false,
          zIndex: 40,
        });
      }
    });
  }, [mapsReady, state.phase]);

  // ─── Preload next zoom level ───
  useEffect(() => {
    if (!state.target || state.phase !== "PLAYING") return;
    const nextZoom = state.currentZoom - 1;
    if (nextZoom < MIN_ZOOM) return;
    const img = new Image();
    img.src = satUrl(state.target, nextZoom, satelliteImageSize);
  }, [state.currentZoom, state.target, state.phase, satelliteImageSize]);

  // ─── Preload next round after lock-in ───
  useEffect(() => {
    if (
      state.phase !== "ROUND_RESULT" ||
      !state.roundPlan ||
      state.round >= TOTAL_ROUNDS
    ) {
      return;
    }
    const nextRound = state.round + 1;
    if (preloadedTargetsRef.current[nextRound]) return;

    let cancelled = false;
    const plan = state.roundPlan[nextRound - 1];
    (async () => {
      const target = await resolveRoundTarget(
        plan,
        langRef.current,
        state.countryCode,
        state.usedTargets,
      );
      if (cancelled || !target) return;
      preloadedTargetsRef.current[nextRound] = target;
      const img = new Image();
      img.src = satUrl(target, START_ZOOM, satelliteImageSize);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    state.phase,
    state.round,
    state.roundPlan,
    state.countryCode,
    state.usedTargets,
    satelliteImageSize,
  ]);

  // ─── Reset image state on zoom change ───
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
    setZoomTransitionLoading(false);
  }, [state.currentZoom, state.target]);

  useEffect(() => {
    setZoomTransition(null);
    setZoomTransitionLoading(false);
    zoomTransitionRequestRef.current += 1;
    if (zoomTransitionTimerRef.current) {
      window.clearTimeout(zoomTransitionTimerRef.current);
      zoomTransitionTimerRef.current = null;
    }
  }, [state.target]);

  useEffect(
    () => () => {
      zoomTransitionRequestRef.current += 1;
      if (zoomTransitionTimerRef.current) {
        window.clearTimeout(zoomTransitionTimerRef.current);
      }
    },
    [],
  );

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
        width: satelliteImageSize?.width,
        height: satelliteImageSize?.height,
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
    satelliteImageSize,
    activeGeoLanguage,
  ]);

  useEffect(() => {
    const previous = phaseFeedbackRef.current;
    const aiGuessReady =
      state.phase === "ROUND_RESULT" && Boolean(state.aiGuess);

    if (previous.phase === "LOADING" && state.phase === "PLAYING") {
      playFeedback("ready");
      showFeedbackBubble(t("geo.feedback_round_ready"), "success");
    }

    if (!previous.aiGuessReady && aiGuessReady) {
      playFeedback("place");
      showFeedbackBubble(t("geo.feedback_ai_done"), "atlas");
    }

    if (previous.phase !== "GAME_OVER" && state.phase === "GAME_OVER") {
      playFeedback("finish");
      showFeedbackBubble(t("geo.feedback_game_finished"), "success");
    }

    phaseFeedbackRef.current = {
      phase: state.phase,
      round: state.round,
      aiGuessReady,
    };
  }, [
    state.phase,
    state.round,
    state.aiGuess,
    playFeedback,
    showFeedbackBubble,
    t,
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

  const cancelSatelliteZoomTransition = useCallback(() => {
    zoomTransitionRequestRef.current += 1;
    if (zoomTransitionTimerRef.current) {
      window.clearTimeout(zoomTransitionTimerRef.current);
      zoomTransitionTimerRef.current = null;
    }
    setZoomTransition(null);
    setZoomTransitionLoading(false);
  }, []);

  useEffect(() => {
    if (state.phase === "PLAYING") return;
    cancelSatelliteZoomTransition();
  }, [state.phase, cancelSatelliteZoomTransition]);

  useEffect(() => {
    if (state.phase !== "WELCOME") return;
    cleanupMarkers();
    guessInstanceRef.current = null;
  }, [state.phase]);

  const handleNextRound = useCallback(() => {
    cleanupMarkers();
    cancelSatelliteZoomTransition();
    dispatch({ type: "NEXT_ROUND" });
  }, [cancelSatelliteZoomTransition]);
  const handleRestart = useCallback(() => {
    cleanupMarkers();
    preloadedTargetsRef.current = {};
    cancelSatelliteZoomTransition();
    dispatch({ type: "RESTART" });
  }, [cancelSatelliteZoomTransition]);
  const handleLockIn = useCallback(() => {
    const currentState = stateRef.current;
    if (
      currentState.phase !== "PLAYING" ||
      !currentState.guessPin ||
      !currentState.target
    ) {
      return;
    }
    cancelSatelliteZoomTransition();
    playFeedback("lock");
    showFeedbackBubble(t("geo.feedback_locked"), "target");
    dispatch({ type: "LOCK_IN" });
  }, [cancelSatelliteZoomTransition, playFeedback, showFeedbackBubble, t]);
  const handleGiveUp = useCallback(() => {
    const currentState = stateRef.current;
    if (currentState.phase !== "PLAYING" || !currentState.target) return;
    cancelSatelliteZoomTransition();
    playFeedback("skip");
    showFeedbackBubble(t("geo.feedback_gave_up"), "warning");
    dispatch({ type: "GIVE_UP" });
  }, [cancelSatelliteZoomTransition, playFeedback, showFeedbackBubble, t]);
  const handleStartGame = useCallback(
    (options) => {
      preloadedTargetsRef.current = {};
      cancelSatelliteZoomTransition();
      playFeedback("ready");
      showFeedbackBubble(t("geo.feedback_game_started"), "success");
      dispatch({ type: "START_GAME", ...options });
    },
    [
      cancelSatelliteZoomTransition,
      dispatch,
      playFeedback,
      showFeedbackBubble,
      t,
    ],
  );

  const satelliteUrl = state.target
    ? satUrl(state.target, state.currentZoom, satelliteImageSize)
    : null;
  const canZoomOut =
    state.currentZoom > MIN_ZOOM &&
    state.phase === "PLAYING" &&
    imgLoaded &&
    !zoomTransition &&
    !zoomTransitionLoading;
  const handleZoomOut = useCallback(() => {
    const currentState = stateRef.current;
    if (
      currentState.phase !== "PLAYING" ||
      !currentState.target ||
      currentState.currentZoom <= MIN_ZOOM ||
      zoomTransition ||
      zoomTransitionLoading
    ) {
      return;
    }

    const nextZoom = currentState.currentZoom - 1;
    const toUrl = satUrl(currentState.target, nextZoom, satelliteImageSize);
    const requestId = zoomTransitionRequestRef.current + 1;
    zoomTransitionRequestRef.current = requestId;
    setZoomTransitionLoading(true);
    setImgError(false);

    const img = new Image();
    img.onload = () => {
      if (zoomTransitionRequestRef.current !== requestId) return;

      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

      setZoomTransitionLoading(false);
      if (!prefersReducedMotion) {
        setZoomTransition({
          toUrl,
          requestId,
          animationDone: false,
        });
      }
      dispatch({ type: "ZOOM_OUT" });
      playFeedback("zoom");
      showFeedbackBubble(t("geo.feedback_zoom_out"), "zoom");

      if (!prefersReducedMotion) {
        if (zoomTransitionTimerRef.current) {
          window.clearTimeout(zoomTransitionTimerRef.current);
        }
        zoomTransitionTimerRef.current = window.setTimeout(() => {
          setZoomTransition((current) =>
            current?.requestId === requestId
              ? { ...current, animationDone: true }
              : current,
          );
          zoomTransitionTimerRef.current = null;
        }, SATELLITE_ZOOM_TRANSITION_MS);
      }
    };
    img.onerror = () => {
      if (zoomTransitionRequestRef.current !== requestId) return;
      setZoomTransitionLoading(false);
      setImgError(true);
      playFeedback("error");
      showFeedbackBubble(t("geo.feedback_image_error"), "danger");
    };
    img.src = toUrl;
  }, [
    satelliteImageSize,
    zoomTransition,
    zoomTransitionLoading,
    playFeedback,
    showFeedbackBubble,
    t,
  ]);

  useEffect(() => {
    if (!zoomTransition?.animationDone || !imgLoaded) return;
    setZoomTransition(null);
  }, [zoomTransition, imgLoaded]);

  const playerScore = getCurrentPlayerScore(state);
  const atlasScore = state.aiEnabled ? getCurrentAtlasScore(state) : null;

  return (
    <div
      className={`geo-game ${
        state.phase === "WELCOME" ? "geo-game--welcome" : ""
      }`}
    >
      {state.phase === "WELCOME" ? (
        <WelcomeModal
          onStart={handleStartGame}
          t={t}
          navigate={navigate}
          countryCode={countryCodeFromUrl}
        />
      ) : (
        <>
          <div className="geo-topbar">
            <div className="geo-topbar-left">
              <button className="geo-topbar-back" onClick={() => navigate("/")}>
                ← {t("geo.back")}
              </button>
              <span className="geo-topbar-title">{t("geo.title")}</span>
            </div>
            <div className="geo-topbar-right">
              {state.round > 0 && (
                <>
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
                </>
              )}
              <GameSoundToggle
                enabled={soundEnabled}
                onToggle={toggleSound}
                enabledLabel={t("geo.feedback_sound_on")}
                disabledLabel={t("geo.feedback_sound_off")}
              />
              <LanguageSwitch className="geo-topbar-language" />
            </div>
          </div>

          <div className="geo-main">
            <div ref={satelliteElRef} className="geo-satellite">
              {satelliteUrl && (
                <img
                  key={satelliteUrl}
                  src={satelliteUrl}
                  className={`geo-satellite-img ${
                    imgLoaded ? "loaded" : ""
                  } ${zoomTransition ? "geo-satellite-img--handoff" : ""}`}
                  alt=""
                  draggable={false}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => {
                    setImgError(true);
                    setImgLoaded(true);
                    playFeedback("error");
                    showFeedbackBubble(t("geo.feedback_image_error"), "danger");
                  }}
                />
              )}
              {zoomTransition && (
                <div className="geo-satellite-transition" aria-hidden="true">
                  <img
                    src={zoomTransition.toUrl}
                    className="geo-satellite-transition-img"
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
              {(state.phase === "LOADING" ||
                ((state.phase === "PLAYING" ||
                  state.phase === "ROUND_RESULT") &&
                  !imgLoaded &&
                  !zoomTransition)) && (
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
                (state.phase === "PLAYING" ||
                  state.phase === "ROUND_RESULT") && (
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
                    onClick={handleZoomOut}
                    aria-busy={zoomTransitionLoading}
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
                  <>
                    <div ref={guessMapElRef} className="geo-map-container" />
                    {!mapsReady && (
                      <div className="geo-map-loading">
                        <div className="geo-loading-spinner" />
                        <span>{t("geo.map_loading")}</span>
                      </div>
                    )}
                  </>
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
                    onClick={handleLockIn}
                  >
                    {t("geo.lock_in")}
                  </button>
                  <button className="geo-give-up" onClick={handleGiveUp}>
                    {t("geo.give_up")}
                  </button>
                </div>
              )}
              {state.phase === "ROUND_RESULT" && (
                <RoundResult state={state} t={t} onNext={handleNextRound} />
              )}
            </div>
          </div>
        </>
      )}
      {state.phase === "GAME_OVER" && (
        <GameOverModal
          state={state}
          t={t}
          onRestart={handleRestart}
          onNext={handleNextRound}
        />
      )}
      <GameFeedbackBubbles bubbles={feedbackBubbles} />
    </div>
  );
}

// ─── WelcomeModal ───

// ─── RoundResult ───

// ─── GameOverModal ───

export { getGameOverAtlasMessage } from "../components/GeoGameResults";
