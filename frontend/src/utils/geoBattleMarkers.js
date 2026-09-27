// Google Maps marker helpers for the online duel guess map.
// Color semantics: green = correct target, red = you, blue = opponent.
const BATTLE_MARKERS = {
  target: { color: "#10b981", zIndex: 30, scale: 17 },
  player: { color: "#ef4444", zIndex: 50, scale: 16 },
  opponent: { color: "#2563eb", zIndex: 40, scale: 16 },
};

function getBattleMarkerLabel(type, t) {
  if (type === "target") return t("geo_online.pin_target_short");
  if (type === "opponent") return t("geo_online.pin_opponent_short");
  return t("geo_online.pin_you_short");
}

function createBattleMarker(maps, map, position, type, t) {
  const marker = BATTLE_MARKERS[type] || BATTLE_MARKERS.player;
  return new maps.Marker({
    position,
    map,
    clickable: false,
    zIndex: marker.zIndex,
    icon: {
      path: maps.SymbolPath.CIRCLE,
      scale: marker.scale,
      fillColor: marker.color,
      fillOpacity: 1,
      strokeColor: "#fff",
      strokeWeight: 2.5,
    },
    label: {
      text: getBattleMarkerLabel(type, t),
      color: "#fff",
      fontSize: "11px",
      fontWeight: "800",
    },
  });
}

/**
 * Draws the reveal overlays (target, both guesses and their lines to the
 * target) for a round. Objects are created in a fixed order: target marker,
 * my marker, my line, opponent marker, opponent line.
 */
function createBattleResultOverlays(maps, map, round, t) {
  const markers = [];
  const lines = [];
  const bounds = new maps.LatLngBounds();
  const target = { lat: round.target.lat, lng: round.target.lng };
  bounds.extend(target);

  markers.push(createBattleMarker(maps, map, target, "target", t));

  if (round.my_guess?.lat != null && round.my_guess?.lng != null) {
    const myGuess = {
      lat: round.my_guess.lat,
      lng: round.my_guess.lng,
    };
    bounds.extend(myGuess);
    markers.push(createBattleMarker(maps, map, myGuess, "player", t));
    lines.push(
      new maps.Polyline({
        path: [myGuess, target],
        strokeColor: BATTLE_MARKERS.player.color,
        strokeWeight: 2,
        strokeOpacity: 0.75,
        geodesic: true,
        map,
      }),
    );
  }

  if (round.opponent_guess?.lat != null && round.opponent_guess?.lng != null) {
    const opponentGuess = {
      lat: round.opponent_guess.lat,
      lng: round.opponent_guess.lng,
    };
    bounds.extend(opponentGuess);
    markers.push(createBattleMarker(maps, map, opponentGuess, "opponent", t));
    lines.push(
      new maps.Polyline({
        path: [opponentGuess, target],
        strokeColor: BATTLE_MARKERS.opponent.color,
        strokeWeight: 1.5,
        strokeOpacity: 0.6,
        geodesic: true,
        map,
      }),
    );
  }

  return { markers, lines, bounds };
}

export {
  BATTLE_MARKERS,
  getBattleMarkerLabel,
  createBattleMarker,
  createBattleResultOverlays,
};
