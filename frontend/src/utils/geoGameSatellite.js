// Satellite image request sizing and URLs for the single-player geo game.
// Google Static Maps caps each side at 640px; the backend rejects < 120px.

export const STATIC_MAP_MAX_SIDE = 640;
export const STATIC_MAP_MIN_SIDE = 120;
// The short side snaps to this step so small layout changes (window drags,
// scrollbars) map to the same request and reuse the cached image instead of
// fetching a new one for every pixel of aspect ratio.
export const STATIC_MAP_SIZE_STEP = 16;

// Layout used before the satellite panel has been measured.
const INITIAL_RIGHT_PANEL_WIDTH = 380;
const INITIAL_TOPBAR_HEIGHT = 50;

/**
 * Pick a Static Maps request size matching the panel aspect ratio.
 * The long side is always STATIC_MAP_MAX_SIDE; the short side is snapped to
 * STATIC_MAP_SIZE_STEP, and both sides are clamped to
 * [STATIC_MAP_MIN_SIDE, STATIC_MAP_MAX_SIDE]. Returns null for unmeasurable
 * panels.
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

  const snap = (value) =>
    Math.round(value / STATIC_MAP_SIZE_STEP) * STATIC_MAP_SIZE_STEP;

  if (aspect >= 1) {
    requestWidth = STATIC_MAP_MAX_SIDE;
    requestHeight = snap(STATIC_MAP_MAX_SIDE / aspect);
  } else {
    requestHeight = STATIC_MAP_MAX_SIDE;
    requestWidth = snap(STATIC_MAP_MAX_SIDE * aspect);
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
