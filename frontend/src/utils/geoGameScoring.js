// Distance, tolerance and scoring helpers shared by the single-player game
// and the online duel. Must stay free of the question bank import (see
// geoGameUtils.js) and match the backend formula in geo_battle_scoring.go.

export const PERFECT_GUESS_DISTANCE_KM = 1;
export const MAX_GUESS_TOLERANCE_KM = 100;
export const GUESS_TOLERANCE_GROWTH_PER_ZOOM_OUT = 1.45;
export const SCORE_ZOOM_DECAY_PER_STEP = 0.12;
export const SCORE_DISTANCE_DECAY_KM = 1500;

/**
 * Haversine distance between two coordinates in kilometers.
 */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Score = 5000 × zoomFactor × distanceFactor
 *
 * zoomFactor: exponential decay — no hard limit on steps.
 *   0 steps → 1.0,  5 steps → 0.55,  10 steps → 0.30,  15 steps → 0.17
 * distanceFactor: exponential decay after the zoom-aware tolerance,
 *   1500 km beyond tolerance → 0.37
 */
export function calculateScore(zoomSteps, distanceKm) {
  if (!Number.isFinite(distanceKm)) return 0;
  const steps = normalizeZoomSteps(zoomSteps);
  const zoomFactor = Math.exp(-steps * SCORE_ZOOM_DECAY_PER_STEP);
  const effectiveDistanceKm = getEffectiveDistanceKm(steps, distanceKm);
  const distanceFactor = Math.exp(
    -effectiveDistanceKm / SCORE_DISTANCE_DECAY_KM,
  );
  return Math.round(5000 * zoomFactor * distanceFactor);
}

export function getGuessToleranceKm(zoomSteps = 0) {
  const steps = normalizeZoomSteps(zoomSteps);
  return Math.min(
    MAX_GUESS_TOLERANCE_KM,
    PERFECT_GUESS_DISTANCE_KM * GUESS_TOLERANCE_GROWTH_PER_ZOOM_OUT ** steps,
  );
}

export function getEffectiveDistanceKm(zoomSteps, distanceKm) {
  if (!Number.isFinite(distanceKm)) return Number.POSITIVE_INFINITY;
  return Math.max(0, distanceKm - getGuessToleranceKm(zoomSteps));
}

export function isPerfectGuess(distanceKm, zoomSteps = 0) {
  return (
    Number.isFinite(distanceKm) && distanceKm <= getGuessToleranceKm(zoomSteps)
  );
}

function normalizeZoomSteps(zoomSteps) {
  return Math.max(0, Number.isFinite(zoomSteps) ? zoomSteps : 0);
}

/**
 * Format distance for display.
 */
export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}
