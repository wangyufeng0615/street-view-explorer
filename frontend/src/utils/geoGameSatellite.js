// Satellite image request sizing and URLs for the single-player geo game.
// Google Static Maps caps each side at 640px; the backend rejects < 120px.

export const STATIC_MAP_MAX_SIDE = 640;
export const STATIC_MAP_MIN_SIDE = 120;

// Layout used before the satellite panel has been measured.
const INITIAL_RIGHT_PANEL_WIDTH = 380;
const INITIAL_TOPBAR_HEIGHT = 50;

/**
 * Pick a Static Maps request size matching the panel aspect ratio.
 * The long side is always STATIC_MAP_MAX_SIDE; both sides are clamped
 * to [STATIC_MAP_MIN_SIDE, STATIC_MAP_MAX_SIDE]. Returns null for
 * unmeasurable panels.
 */
export function getSatelliteRequestSize(width, height) {
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

/** Estimate the satellite panel size from the window before first layout. */
export function getInitialSatelliteRequestSize() {
  if (typeof window === "undefined") return null;
  return getSatelliteRequestSize(
    window.innerWidth - INITIAL_RIGHT_PANEL_WIDTH,
    window.innerHeight - INITIAL_TOPBAR_HEIGHT,
  );
}

export function isSameSatelliteRequestSize(a, b) {
  return a?.width === b?.width && a?.height === b?.height;
}

/** Same-origin satellite proxy URL for a target at a zoom level. */
export function getSatelliteUrl(target, zoom, size) {
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
