// Pure utility functions for the Geo guessing game

import GEO_DATABASE from "../data/geoDatabase";

export const TOTAL_ROUNDS = 5;
export const START_ZOOM = 14;
export const MIN_ZOOM = 2;
export const PERFECT_GUESS_DISTANCE_KM = 1;

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
 * distanceFactor: exponential decay, perfect range → 1.0, 1500 km → 0.37
 */
export function calculateScore(zoomSteps, distanceKm) {
  const zoomFactor = Math.exp(-zoomSteps * 0.12);
  const effectiveDistanceKm = isPerfectGuess(distanceKm) ? 0 : distanceKm;
  const distanceFactor = Math.exp(-effectiveDistanceKm / 1500);
  return Math.round(5000 * zoomFactor * distanceFactor);
}

export function isPerfectGuess(distanceKm) {
  return Number.isFinite(distanceKm) && distanceKm <= PERFECT_GUESS_DISTANCE_KM;
}

/**
 * Format distance for display.
 */
export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

// ─── Round plan generation ─────────────────────────────────

/**
 * Generate a plan for one game: which rounds use the city database,
 * which use the random API. ~50% from database, with difficulty
 * progression (easier rounds first).
 *
 * Returns: Array<{ source: 'database', entry: {...} } | { source: 'random' }>
 */
export function generateRoundPlan(totalRounds = TOTAL_ROUNDS) {
  // Pick 2 or 3 database entries (avg 50%), clamped to totalRounds
  const rawCount = Math.random() < 0.5 ? 2 : 3;
  const dbCount = Math.min(rawCount, totalRounds);
  const cities = pickCities(dbCount);

  // Build plan: database entries + random slots
  const plan = [
    ...cities.map((entry) => ({ source: "database", entry })),
    ...Array(totalRounds - cities.length)
      .fill(null)
      .map(() => ({ source: "random" })),
  ];

  // Shuffle, then sort by intended difficulty: easier entries first
  shuffle(plan);
  plan.sort((a, b) => {
    const da = a.source === "database" ? a.entry.difficulty : 2.5;
    const db = b.source === "database" ? b.entry.difficulty : 2.5;
    return da - db;
  });

  return plan;
}

/**
 * Pick N unique cities from the database. Avoids repeating the same
 * country, and balances difficulty (at least one easy if count >= 2).
 */
function pickCities(count) {
  const shuffled = [...GEO_DATABASE];
  shuffle(shuffled);

  const picked = [];
  const usedCountries = new Set();

  // First pass: pick one easy entry if possible
  if (count >= 2) {
    const easy = shuffled.find(
      (e) => e.difficulty === 1 && !usedCountries.has(e.country),
    );
    if (easy) {
      picked.push(easy);
      usedCountries.add(easy.country);
    }
  }

  // Fill remaining slots
  for (const entry of shuffled) {
    if (picked.length >= count) break;
    if (picked.includes(entry)) continue;
    if (usedCountries.has(entry.country)) continue;
    picked.push(entry);
    usedCountries.add(entry.country);
  }

  return picked;
}

/** Apply a small random offset so the same city shows different views. */
export function jitterCoord(lat, lng) {
  const offset = () => (Math.random() - 0.5) * 0.004; // ±0.002° ≈ ±200 m
  return { lat: lat + offset(), lng: lng + offset() };
}

/** Fisher-Yates shuffle (in place). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
