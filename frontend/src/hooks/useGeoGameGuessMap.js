import { useCallback, useEffect, useRef, useState } from "react";
import { loadGoogleMapsScript } from "../utils/googleMaps";
import { PLAYER_MARKERS } from "../components/GeoGameResults";
import {
  createGuessPinIcon,
  getResultPinOffsets,
} from "../utils/geoGameMapPins";

/**
 * Google Maps guess map: loads the Maps API, creates the map once the game
 * leaves WELCOME, places the player's pending pin on click, and draws the
 * result markers/lines (re-drawn when the Atlas guess arrives late).
 *
 * Attach `guessMapElRef` to the map container. `cleanupMarkers` removes every
 * pin/line and recenters the map; it only touches refs, so it is stable.
 */
export function useGeoGameGuessMap({
  state,
  stateRef,
  dispatch,
  playFeedback,
  showFeedbackBubble,
  t,
}) {
  const guessMapElRef = useRef(null);
  const guessInstanceRef = useRef(null);
  const mapsAPIRef = useRef(null);
  const pendingMarkerRef = useRef(null);
  const resultMarkersRef = useRef([]);
  const resultLinesRef = useRef([]);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const feedbackRef = useRef({ showFeedbackBubble, playFeedback, t });
  feedbackRef.current = { showFeedbackBubble, playFeedback, t };

  // ─── Load Google Maps API (with error handling) ───
  useEffect(() => {
    loadGoogleMapsScript()
      .then((maps) => {
        mapsAPIRef.current = maps;
        setMapsReady(true);
      })
      .catch(() => setMapsError(true));
  }, []);

  // ─── Init guess map ───
  useEffect(() => {
    if (state.phase === "WELCOME") return;
    if (!mapsReady || !guessMapElRef.current || guessInstanceRef.current)
      return;
    const maps = mapsAPIRef.current;

    guessInstanceRef.current = new maps.Map(guessMapElRef.current, {
      center: { lat: 20, lng: 0 },
      zoom: 2,
      mapTypeId: "roadmap",
      disableDefaultUI: true,
      zoomControl: true,
    });

    guessInstanceRef.current.addListener("click", (e) => {
      const s = stateRef.current;
      if (s.phase !== "PLAYING") return;
      const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const hadPin = Boolean(s.guessPin);
      dispatch({ type: "PLACE_PIN", payload: pos });
      feedbackRef.current.playFeedback("place");
      feedbackRef.current.showFeedbackBubble(
        feedbackRef.current.t(
          hadPin ? "geo.feedback_pin_moved" : "geo.feedback_pin_placed",
        ),
        "player",
      );
      if (pendingMarkerRef.current) {
        pendingMarkerRef.current.setPosition(pos);
      } else {
        pendingMarkerRef.current = new maps.Marker({
          position: pos,
          map: guessInstanceRef.current,
          icon: createGuessPinIcon(maps, PLAYER_MARKERS.player.color),
          clickable: false,
          zIndex: 40,
        });
      }
    });
  }, [dispatch, mapsReady, state.phase, stateRef]);

  // ─── Show result markers (re-runs when AI guess arrives late) ───
  useEffect(() => {
    if (state.phase !== "ROUND_RESULT" || !mapsAPIRef.current || !state.target)
      return;
    const maps = mapsAPIRef.current;
    const tp = { lat: state.target.lat, lng: state.target.lng };

    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setMap(null);
      pendingMarkerRef.current = null;
    }
    resultMarkersRef.current.forEach((m) => m.setMap(null));
    resultMarkersRef.current = [];
    resultLinesRef.current.forEach((l) => l.setMap(null));
    resultLinesRef.current = [];
    const pinOffsets = getResultPinOffsets(
      state.target,
      state.guessResult,
      state.aiGuess,
    );

    // Target (green)
    resultMarkersRef.current.push(
      new maps.Marker({
        position: tp,
        map: guessInstanceRef.current,
        icon: createGuessPinIcon(
          maps,
          PLAYER_MARKERS.target.color,
          pinOffsets.target,
        ),
        zIndex: 20,
      }),
    );

    // Player guess (red) — skip if gave up (lat is null)
    if (state.guessResult && state.guessResult.lat != null) {
      const gp = { lat: state.guessResult.lat, lng: state.guessResult.lng };
      resultMarkersRef.current.push(
        new maps.Marker({
          position: gp,
          map: guessInstanceRef.current,
          icon: createGuessPinIcon(
            maps,
            PLAYER_MARKERS.player.color,
            pinOffsets.player,
          ),
          zIndex: 40,
        }),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [gp, tp],
          strokeColor: PLAYER_MARKERS.player.color,
          strokeWeight: 2,
          strokeOpacity: 0.7,
          geodesic: false,
          map: guessInstanceRef.current,
        }),
      );
    }

    // AI guess (purple)
    if (state.aiGuess) {
      const ap = { lat: state.aiGuess.lat, lng: state.aiGuess.lng };
      resultMarkersRef.current.push(
        new maps.Marker({
          position: ap,
          map: guessInstanceRef.current,
          icon: createGuessPinIcon(
            maps,
            PLAYER_MARKERS.atlas.color,
            pinOffsets.atlas,
          ),
          zIndex: 30,
        }),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [ap, tp],
          strokeColor: PLAYER_MARKERS.atlas.color,
          strokeWeight: 1.5,
          strokeOpacity: 0.6,
          geodesic: false,
          map: guessInstanceRef.current,
        }),
      );
    }

    const bounds = new maps.LatLngBounds();
    bounds.extend(tp);
    if (state.guessResult && state.guessResult.lat != null)
      bounds.extend({ lat: state.guessResult.lat, lng: state.guessResult.lng });
    if (state.aiGuess)
      bounds.extend({ lat: state.aiGuess.lat, lng: state.aiGuess.lng });

    const fitVisibleMap = () => {
      if (!guessInstanceRef.current) return;
      maps.event.trigger(guessInstanceRef.current, "resize");
      guessInstanceRef.current.fitBounds(bounds, 32);
    };
    const frame = window.requestAnimationFrame(fitVisibleMap);
    const timer = window.setTimeout(fitVisibleMap, 320);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
    // guessResult and target only change in the same update as the phase.
  }, [state.phase, state.aiGuess, state.guessResult, state.target, mapsReady]);

  // ─── Cleanup ───
  const cleanupMarkers = useCallback(() => {
    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setMap(null);
      pendingMarkerRef.current = null;
    }
    resultMarkersRef.current.forEach((m) => m.setMap(null));
    resultMarkersRef.current = [];
    resultLinesRef.current.forEach((l) => l.setMap(null));
    resultLinesRef.current = [];
    if (guessInstanceRef.current) {
      guessInstanceRef.current.setCenter({ lat: 20, lng: 0 });
      guessInstanceRef.current.setZoom(2);
    }
  }, []);

  // The map container unmounts on WELCOME; drop the stale map instance.
  useEffect(() => {
    if (state.phase !== "WELCOME") return;
    cleanupMarkers();
    guessInstanceRef.current = null;
  }, [cleanupMarkers, state.phase]);

  return { guessMapElRef, mapsReady, mapsError, cleanupMarkers };
}
