// @ts-check
/** @type {Record<string, number>} */
const directionWords = {
  north: 0,
  northeast: 45,
  east: 90,
  southeast: 135,
  south: 180,
  southwest: 225,
  west: 270,
  northwest: 315,
  forward: 0,
  left: -90,
  right: 90,
  back: 180,
};

/**
 * @param {unknown} heading
 */
function normalizeHeading(heading) {
  return ((Number(heading) % 360) + 360) % 360;
}

/**
 * @param {string | undefined} direction
 * @param {number} currentHeading
 */
function headingFromDirection(direction, currentHeading) {
  const normalized = String(direction || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  /** @type {Record<string, number>} */
  const absoluteDirections = {
    north: 0,
    northeast: 45,
    east: 90,
    southeast: 135,
    south: 180,
    southwest: 225,
    west: 270,
    northwest: 315,
  };

  if (Object.prototype.hasOwnProperty.call(absoluteDirections, normalized)) {
    return absoluteDirections[normalized];
  }

  /** @type {Record<string, number>} */
  const relativeTurns = {
    forward: 0,
    left: -90,
    right: 90,
    back: 180,
  };

  if (Object.prototype.hasOwnProperty.call(relativeTurns, normalized)) {
    return normalizeHeading(
      Number(currentHeading || 0) + relativeTurns[normalized],
    );
  }

  return null;
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {number} bearingDeg
 * @param {number} distanceMeters
 */
function destinationPoint(lat, lng, bearingDeg, distanceMeters) {
  const radiusMeters = 6371000;
  const angularDistance = distanceMeters / radiusMeters;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (((lng2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

/**
 * @param {string | undefined} direction
 * @param {number} currentHeading
 */
function nearbyBearing(direction, currentHeading) {
  const normalized = String(direction || "forward")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  const baseHeading = Number(currentHeading || 0);
  if (Object.prototype.hasOwnProperty.call(directionWords, normalized)) {
    const value = directionWords[normalized];
    const isRelative = ["forward", "left", "right", "back"].includes(
      normalized,
    );
    return normalizeHeading((isRelative ? baseHeading : 0) + value);
  }
  return normalizeHeading(baseHeading + (Math.random() * 90 - 45));
}

export {
  directionWords,
  normalizeHeading,
  headingFromDirection,
  destinationPoint,
  clampNumber,
  nearbyBearing,
};
