// Pure utility functions for the Geo guessing game

import GEO_DATABASE from "../data/geoDatabase";

export const TOTAL_ROUNDS = 5;
export const START_ZOOM = 14;
export const MIN_ZOOM = 2;
export const PERFECT_GUESS_DISTANCE_KM = 1;
export const MAX_GUESS_TOLERANCE_KM = 100;
export const GUESS_TOLERANCE_GROWTH_PER_ZOOM_OUT = 1.45;

const COUNTRY_CODE_BY_NAME = {
  Angola: "AO",
  Argentina: "AR",
  Australia: "AU",
  Austria: "AT",
  Albania: "AL",
  Andorra: "AD",
  Armenia: "AM",
  Azerbaijan: "AZ",
  Bahamas: "BS",
  Bangladesh: "BD",
  Bahrain: "BH",
  Belgium: "BE",
  Belize: "BZ",
  Bolivia: "BO",
  "Bosnia and Herzegovina": "BA",
  Botswana: "BW",
  Brazil: "BR",
  Bulgaria: "BG",
  Cambodia: "KH",
  Canada: "CA",
  Bhutan: "BT",
  Chile: "CL",
  China: "CN",
  Colombia: "CO",
  "Costa Rica": "CR",
  Croatia: "HR",
  Cuba: "CU",
  Cyprus: "CY",
  "Czech Republic": "CZ",
  Denmark: "DK",
  "Dominican Republic": "DO",
  "DR Congo": "CD",
  Ecuador: "EC",
  Egypt: "EG",
  "El Salvador": "SV",
  Estonia: "EE",
  Ethiopia: "ET",
  Fiji: "FJ",
  Finland: "FI",
  France: "FR",
  "French Polynesia": "PF",
  Georgia: "GE",
  Germany: "DE",
  Ghana: "GH",
  Greece: "GR",
  Guam: "GU",
  Guatemala: "GT",
  Honduras: "HN",
  Hungary: "HU",
  Iceland: "IS",
  India: "IN",
  Indonesia: "ID",
  Iran: "IR",
  Iraq: "IQ",
  Ireland: "IE",
  Israel: "IL",
  Italy: "IT",
  Japan: "JP",
  Jordan: "JO",
  Kazakhstan: "KZ",
  Kenya: "KE",
  Laos: "LA",
  Latvia: "LV",
  Lebanon: "LB",
  Lithuania: "LT",
  Luxembourg: "LU",
  Madagascar: "MG",
  Malaysia: "MY",
  Maldives: "MV",
  Mali: "ML",
  Malta: "MT",
  Mauritania: "MR",
  Mauritius: "MU",
  Mexico: "MX",
  Monaco: "MC",
  Mongolia: "MN",
  Montenegro: "ME",
  Morocco: "MA",
  Mozambique: "MZ",
  Myanmar: "MM",
  Namibia: "NA",
  Nepal: "NP",
  Netherlands: "NL",
  "New Zealand": "NZ",
  Nigeria: "NG",
  "North Macedonia": "MK",
  Norway: "NO",
  Oman: "OM",
  Pakistan: "PK",
  Palau: "PW",
  Panama: "PA",
  "Papua New Guinea": "PG",
  Paraguay: "PY",
  Peru: "PE",
  Philippines: "PH",
  Poland: "PL",
  Portugal: "PT",
  Qatar: "QA",
  Romania: "RO",
  Russia: "RU",
  Rwanda: "RW",
  Samoa: "WS",
  "Saudi Arabia": "SA",
  Senegal: "SN",
  Serbia: "RS",
  Seychelles: "SC",
  Singapore: "SG",
  Slovenia: "SI",
  "South Africa": "ZA",
  "South Korea": "KR",
  Spain: "ES",
  "Sri Lanka": "LK",
  Sudan: "SD",
  Sweden: "SE",
  Switzerland: "CH",
  Taiwan: "TW",
  Tanzania: "TZ",
  Thailand: "TH",
  Tunisia: "TN",
  Tonga: "TO",
  Turkey: "TR",
  UAE: "AE",
  Uganda: "UG",
  "United Kingdom": "GB",
  "United States": "US",
  Uruguay: "UY",
  Uzbekistan: "UZ",
  Vanuatu: "VU",
  Vatican: "VA",
  Venezuela: "VE",
  Vietnam: "VN",
  Yemen: "YE",
  Zambia: "ZM",
  Zimbabwe: "ZW",
};

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
  const zoomFactor = Math.exp(-steps * 0.12);
  const effectiveDistanceKm = getEffectiveDistanceKm(steps, distanceKm);
  const distanceFactor = Math.exp(-effectiveDistanceKm / 1500);
  return Math.round(5000 * zoomFactor * distanceFactor);
}

export function getGuessToleranceKm(zoomSteps = 0) {
  const steps = normalizeZoomSteps(zoomSteps);
  return Math.min(
    MAX_GUESS_TOLERANCE_KM,
    PERFECT_GUESS_DISTANCE_KM *
      GUESS_TOLERANCE_GROWTH_PER_ZOOM_OUT ** steps,
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

// ─── Round plan generation ─────────────────────────────────

/**
 * Generate a plan for one game: which rounds use the city database,
 * which use the random API. ~50% from database, with difficulty
 * progression (easier rounds first).
 *
 * Returns: Array<{ source: 'database', entry: {...} } | { source: 'random' }>
 */
export function generateRoundPlan(totalRounds = TOTAL_ROUNDS, countryCode = "") {
  // Pick 2 or 3 database entries (avg 50%), clamped to totalRounds
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const rawCount = Math.random() < 0.5 ? 2 : 3;
  const dbCount = Math.min(
    rawCount,
    totalRounds,
    getDatabasePool(normalizedCountryCode).length,
  );
  const cities = pickCities(dbCount, normalizedCountryCode);

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
function pickCities(count, countryCode = "") {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const shuffled = [...getDatabasePool(normalizedCountryCode)];
  shuffle(shuffled);

  const picked = [];
  const usedCountries = new Set();
  const shouldAvoidSameCountry = !normalizedCountryCode;

  // First pass: pick one easy entry if possible
  if (count >= 2) {
    const easy = shuffled.find(
      (e) =>
        e.difficulty === 1 &&
        (!shouldAvoidSameCountry || !usedCountries.has(e.country)),
    );
    if (easy) {
      picked.push(easy);
      if (shouldAvoidSameCountry) usedCountries.add(easy.country);
    }
  }

  // Fill remaining slots
  for (const entry of shuffled) {
    if (picked.length >= count) break;
    if (picked.includes(entry)) continue;
    if (shouldAvoidSameCountry && usedCountries.has(entry.country)) continue;
    picked.push(entry);
    if (shouldAvoidSameCountry) usedCountries.add(entry.country);
  }

  return picked;
}

function getDatabasePool(countryCode) {
  if (!countryCode) return GEO_DATABASE;
  return GEO_DATABASE.filter((entry) => getEntryCountryCode(entry) === countryCode);
}

export function getEntryCountryCode(entry) {
  return normalizeCountryCode(entry?.countryCode || COUNTRY_CODE_BY_NAME[entry?.country]);
}

function normalizeCountryCode(countryCode) {
  const code = (countryCode || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
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
