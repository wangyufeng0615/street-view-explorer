// Google 地图标记和监听的清理工具，兼容旧版 Marker 和 AdvancedMarkerElement。
export function removeMapListener(listenerRef) {
  if (listenerRef.current) {
    listenerRef.current.remove();
    listenerRef.current = null;
  }
}

export function removeMarker(markerRef) {
  if (!markerRef.current) return;

  if (typeof markerRef.current.setMap === "function") {
    markerRef.current.setMap(null);
  } else {
    markerRef.current.map = null;
  }
  markerRef.current = null;
}

export function setMarkerPosition(marker, position) {
  if (!marker) return;

  if (typeof marker.setPosition === "function") {
    marker.setPosition(position);
    return;
  }
  marker.position = position;
}
