// Pure utility functions for the Geo guessing game

import GEO_DATABASE from "../data/geoDatabase";
import { haversineDistance } from "./geoGameScoring";

// Scoring and distance helpers live in geoGameScoring.js so the online duel
// can use them without pulling in the question bank; re-exported here for the
// single-player modules.
export {
  PERFECT_GUESS_DISTANCE_KM,
  MAX_GUESS_TOLERANCE_KM,
  GUESS_TOLERANCE_GROWTH_PER_ZOOM_OUT,
  SCORE_ZOOM_DECAY_PER_STEP,
  SCORE_DISTANCE_DECAY_KM,
  haversineDistance,
  calculateScore,
  getGuessToleranceKm,
  getEffectiveDistanceKm,
  isPerfectGuess,
  formatDistance,
} from "./geoGameScoring";

export const TOTAL_ROUNDS = 5;
export const START_ZOOM = 14;
export const MIN_ZOOM = 2;
export const MIN_ROUND_DISTANCE_KM = 10;

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

export function isRoundTargetDuplicate(
  candidate,
  usedTargets = [],
  minDistanceKm = MIN_ROUND_DISTANCE_KM,
) {
  if (!candidate || !Array.isArray(usedTargets)) return false;
  if (hasSamePanoTarget(candidate, usedTargets)) return true;
  const candidateHasCoords = hasFiniteCoords(candidate);

  return usedTargets.some((target) => {
    if (!target) return false;
    if (!candidateHasCoords || !hasFiniteCoords(target)) return false;
    return (
      haversineDistance(candidate.lat, candidate.lng, target.lat, target.lng) <
      minDistanceKm
    );
  });
}

export function hasSamePanoTarget(candidate, usedTargets = []) {
  if (!candidate || !Array.isArray(usedTargets)) return false;
  const candidatePanoId = normalizePanoId(
    candidate.panoId || candidate.pano_id,
  );
  if (!candidatePanoId) return false;
  return usedTargets.some(
    (target) =>
      normalizePanoId(target?.panoId || target?.pano_id) === candidatePanoId,
  );
}

// ─── Round plan generation ─────────────────────────────────

/**
 * Generate a plan for one game: which rounds use the city database,
 * which use the random API. ~50% from database, with difficulty
 * progression (easier rounds first).
 *
 * Returns: Array<{ source: 'database', entry: {...} } | { source: 'random' }>
 */
export function generateRoundPlan(
  totalRounds = TOTAL_ROUNDS,
  countryCode = "",
) {
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
        canPickDatabaseEntry(e, picked, usedCountries, shouldAvoidSameCountry),
    );
    if (easy) {
      picked.push(easy);
      if (shouldAvoidSameCountry) usedCountries.add(easy.country);
    }
  }

  // Fill remaining slots
  for (const entry of shuffled) {
    if (picked.length >= count) break;
    if (
      !canPickDatabaseEntry(
        entry,
        picked,
        usedCountries,
        shouldAvoidSameCountry,
      )
    ) {
      continue;
    }
    picked.push(entry);
    if (shouldAvoidSameCountry) usedCountries.add(entry.country);
  }

  return picked;
}

function canPickDatabaseEntry(
  entry,
  picked,
  usedCountries,
  shouldAvoidSameCountry,
) {
  if (picked.includes(entry)) return false;
  if (shouldAvoidSameCountry && usedCountries.has(entry.country)) return false;
  return !isRoundTargetDuplicate(entry, picked);
}

function getDatabasePool(countryCode) {
  if (!countryCode) return GEO_DATABASE;
  return GEO_DATABASE.filter(
    (entry) => getEntryCountryCode(entry) === countryCode,
  );
}

export function getEntryCountryCode(entry) {
  return normalizeCountryCode(
    entry?.countryCode || COUNTRY_CODE_BY_NAME[entry?.country],
  );
}

export function normalizeCountryCode(countryCode) {
  const code = (countryCode || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function normalizePanoId(panoId) {
  return typeof panoId === "string" ? panoId.trim() : "";
}

function hasFiniteCoords(target) {
  return Number.isFinite(target.lat) && Number.isFinite(target.lng);
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
