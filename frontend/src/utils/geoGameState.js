// @ts-check
/** @typedef {import('./geoGameTypes').GameState} GameState */
/** @typedef {import('./geoGameTypes').Target} Target */
import {
  TOTAL_ROUNDS,
  START_ZOOM,
  MIN_ZOOM,
  haversineDistance,
  calculateScore,
  generateRoundPlan,
} from "./geoGameUtils";

/** @type {GameState} */
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
  countryCode: "",
  usedTargets: [],
};

/** @param {GameState} state @param {import('./geoGameTypes').GameAction} action @returns {GameState} */
function reducer(state, action) {
  switch (action.type) {
    case "START_GAME": {
      const countryCode = normalizeCountryCode(action.countryCode);
      const roundPlan = generateRoundPlan(TOTAL_ROUNDS, countryCode);
      return {
        ...initialState,
        phase: "LOADING",
        round: 1,
        aiEnabled: action.aiEnabled ?? state.aiEnabled,
        roundPlan,
        countryCode,
      };
    }
    case "SET_TARGET":
      if (state.phase !== "LOADING") return state;
      return {
        ...state,
        phase: "PLAYING",
        target: action.payload,
        usedTargets: appendUsedTarget(state.usedTargets, action.payload),
      };
    case "ZOOM_OUT":
      if (state.phase !== "PLAYING" || state.currentZoom <= MIN_ZOOM) {
        return state;
      }
      return {
        ...state,
        zoomSteps: state.zoomSteps + 1,
        currentZoom: state.currentZoom - 1,
      };
    case "PLACE_PIN":
      if (state.phase !== "PLAYING") return state;
      return { ...state, guessPin: action.payload };
    case "LOCK_IN": {
      if (state.phase !== "PLAYING" || !state.guessPin || !state.target) {
        return state;
      }
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
      if (state.phase !== "PLAYING" || !state.target) return state;
      return {
        ...state,
        phase: "ROUND_RESULT",
        guessResult: { lat: null, lng: null, distance: null, score: 0 },
        guessPin: null,
        aiGuess: null,
        aiLoading: state.aiEnabled,
      };
    case "SET_AI_GUESS":
      if (state.phase !== "ROUND_RESULT") return state;
      return { ...state, aiGuess: action.payload, aiLoading: false };
    case "SET_AI_LOADING":
      if (state.phase !== "ROUND_RESULT") return state;
      return { ...state, aiLoading: true };
    case "NEXT_ROUND": {
      if (
        state.phase !== "ROUND_RESULT" ||
        !state.target ||
        !state.guessResult
      ) {
        return state;
      }
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
        countryCode: state.countryCode,
        usedTargets: state.usedTargets,
      };
    }
    case "RESTART":
      return { ...initialState };
    default:
      return state;
  }
}

/** @param {string | undefined} countryCode */
function normalizeCountryCode(countryCode) {
  const code = (countryCode || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

/** @param {Target[]} usedTargets @param {Target | null} target */
function appendUsedTarget(usedTargets, target) {
  if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) {
    return usedTargets;
  }
  return [
    ...usedTargets,
    {
      lat: target.lat,
      lng: target.lng,
      panoId: target.panoId || target.pano_id || "",
    },
  ];
}

export { initialState, reducer, normalizeCountryCode, appendUsedTarget };

/** @param {string | undefined} value */
function sanitizePlacePart(value) {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/\b\d{4,}\b/g, "")
    .trim();
}
/** @param {string} value */
function looksLikePreciseAddress(value) {
  return (
    /^[A-Z0-9]{3,}\+/.test(value) ||
    /\d/.test(value) ||
    /\b(road|street|avenue|lane|drive|highway|route|rd|st|ave)\b/i.test(value)
  );
}
/** @param {Target | null} target */
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
