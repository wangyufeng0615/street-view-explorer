// Street View mixes Google's own imagery with user-contributed photospheres.
// Photosphere tiles come from lh3.googleusercontent.com, which throttles
// shared proxy IPs with HTTP 429 and leaves the panorama black, so the app
// only ever shows official imagery.

// Explicit lookups (shared links, map picks, place search) may land on a
// photosphere; look this far around it for the nearest official panorama.
export const OFFICIAL_PANO_SEARCH_RADIUS_M = 5000;

/**
 * Official panorama IDs are 22 characters; user photospheres use longer IDs.
 * The backend verifies random panoramas by metadata copyright, so this only
 * decides whether a search can be skipped.
 */
export function isOfficialPanoId(panoId) {
  return (
    typeof panoId === "string" &&
    panoId.length > 0 &&
    panoId.length <= 22 &&
    !panoId.startsWith("CIHM0og")
  );
}

/**
 * Returns the panorama to display: the given ID when it is official (no extra
 * request), otherwise the nearest official panorama, or null when there is
 * none nearby. Network failures are rethrown so the caller can say so.
 */
export async function resolveOfficialPanoId(maps, { lat, lng, panoId }) {
  if (isOfficialPanoId(panoId)) return panoId;

  try {
    const { data } = await new maps.StreetViewService().getPanorama({
      location: { lat, lng },
      radius: OFFICIAL_PANO_SEARCH_RADIUS_M,
      sources: [maps.StreetViewSource.GOOGLE],
      preference: maps.StreetViewPreference.NEAREST,
    });
    return data?.location?.pano || null;
  } catch (error) {
    if (error?.code === "ZERO_RESULTS") return null;
    throw error;
  }
}
