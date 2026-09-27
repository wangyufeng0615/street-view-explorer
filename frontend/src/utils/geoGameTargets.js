// Round target resolution for the single-player geo game: URL/language
// preferences, database entries and random backend locations.
import { getRandomLocation } from "../services/api";
import { normalizeCountryCode } from "./geoGameState";
import {
  hasSamePanoTarget,
  isRoundTargetDuplicate,
  jitterCoord,
} from "./geoGameUtils";

export const RANDOM_TARGET_MAX_ATTEMPTS = 6;
export const RANDOM_TARGET_MAX_FAILURES = 2;

export function getCountryCodeFromSearch(search) {
  const params = new URLSearchParams(search || "");
  return normalizeCountryCode(
    params.get("country") ||
      params.get("country_code") ||
      params.get("countryCode") ||
      "",
  );
}

export function getGeoLanguage(i18n) {
  const language = i18n.resolvedLanguage || i18n.language || "en";
  return language.startsWith("zh") ? "zh" : "en";
}

export function getDatabaseRoundTarget(entry, language) {
  const { lat, lng } = jitterCoord(entry.lat, entry.lng);
  const isZh = language === "zh";
  const name = isZh ? entry.nameZh : entry.name;
  const country = isZh ? entry.countryZh : entry.country;
  return { lat, lng, address: `${name}, ${country}`, country };
}

/**
 * Fetch a random backend location that does not repeat a used target.
 * Skips same-pano and too-close results; stops early after
 * RANDOM_TARGET_MAX_FAILURES failed requests. Falls back to the first
 * nearby (but different-pano) candidate, or null.
 */
export async function getRandomRoundTarget(
  language,
  countryCode,
  usedTargets = [],
) {
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

/** Resolve one round plan entry to a concrete target (or null). */
export async function resolveRoundTarget(
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
