// World-pixel grid keeps the number of DOM markers bounded at overview zooms.
// Each group carries a `key` that is stable for the same zoom, so callers can
// reuse markers while panning.
export function clusterFootprints(visits, zoom) {
  const buckets = new Map();
  const gridZoom = Math.max(0, Math.min(22, Math.round(zoom)));
  const worldSize = 256 * 2 ** gridZoom;
  for (const visit of visits) {
    const lat = Number(visit.latitude),
      lng = Number(visit.longitude);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      continue;
    const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
    const x = ((lng + 180) / 360) * worldSize;
    const y =
      (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize;
    const key = `${gridZoom}:${Math.floor(x / 48)}:${Math.floor(y / 48)}`;
    const group = buckets.get(key) || { key, visits: [], lat: 0, lng: 0 };
    group.visits.push(visit);
    group.lat += lat;
    group.lng += lng;
    buckets.set(key, group);
  }
  return Array.from(buckets.values(), (group) => ({
    ...group,
    lat: group.lat / group.visits.length,
    lng: group.lng / group.visits.length,
  }));
}
