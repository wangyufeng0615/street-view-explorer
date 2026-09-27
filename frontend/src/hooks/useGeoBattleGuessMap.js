import { useCallback, useEffect, useRef, useState } from "react";

import { loadGoogleMapsScript } from "../utils/googleMaps";
import { getBattleResultOverlayKey } from "../utils/geoBattleRoomState";
import {
  createBattleMarker,
  createBattleResultOverlays,
} from "../utils/geoBattleMarkers";

const WORLD_CENTER = { lat: 20, lng: 0 };
const MAP_READY_FALLBACK_MS = 1800;
const RESULT_FIT_DELAY_MS = 280;

/**
 * Refs to the Google Maps objects of the guess map plus the imperative
 * helpers that clear overlays and reset the viewport. It has no effects, so
 * it can be called before the room sync hook, whose room reset uses these
 * helpers; `useGeoBattleGuessMap` then runs the map effects.
 */
function useGeoBattleGuessMapHandles() {
  const guessMapElRef = useRef(null);
  const guessMapRef = useRef(null);
  const mapsAPIRef = useRef(null);
  const pendingMarkerRef = useRef(null);
  const resultMarkersRef = useRef([]);
  const resultLinesRef = useRef([]);

  const clearPendingMarker = useCallback(() => {
    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setMap(null);
      pendingMarkerRef.current = null;
    }
  }, []);

  const clearResultOverlays = useCallback(() => {
    resultMarkersRef.current.forEach((marker) => marker.setMap(null));
    resultMarkersRef.current = [];
    resultLinesRef.current.forEach((line) => line.setMap(null));
    resultLinesRef.current = [];
  }, []);

  const refreshMapViewport = useCallback(() => {
    const maps = mapsAPIRef.current;
    if (maps?.event && guessMapRef.current) {
      maps.event.trigger(guessMapRef.current, "resize");
    }
  }, []);

  const resetMapViewport = useCallback(() => {
    if (guessMapRef.current) {
      refreshMapViewport();
      guessMapRef.current.setCenter(WORLD_CENTER);
      guessMapRef.current.setZoom(2);
    }
  }, [refreshMapViewport]);

  return {
    guessMapElRef,
    guessMapRef,
    mapsAPIRef,
    pendingMarkerRef,
    resultMarkersRef,
    resultLinesRef,
    clearPendingMarker,
    clearResultOverlays,
    refreshMapViewport,
    resetMapViewport,
  };
}

/**
 * Loads Google Maps, creates the guess map once the room is rendered, and
 * keeps its pending pin and reveal overlays in sync with the room phase.
 */
function useGeoBattleGuessMap({
  handles,
  room,
  roomRef,
  guessPin,
  setGuessPin,
  feedbackRef,
  t,
}) {
  const {
    guessMapElRef,
    guessMapRef,
    mapsAPIRef,
    pendingMarkerRef,
    resultMarkersRef,
    resultLinesRef,
    clearPendingMarker,
    clearResultOverlays,
    refreshMapViewport,
    resetMapViewport,
  } = handles;
  const [mapsReady, setMapsReady] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const roomId = room?.room_id;
  const roomPhase = room?.phase;
  const resultOverlayKey = getBattleResultOverlayKey(room);

  useEffect(() => {
    loadGoogleMapsScript()
      .then((maps) => {
        mapsAPIRef.current = maps;
        setMapsReady(true);
      })
      .catch(() => {
        setMapsError(true);
      });
  }, [mapsAPIRef]);

  useEffect(() => {
    if (
      !roomId ||
      !mapsReady ||
      !guessMapElRef.current ||
      guessMapRef.current
    ) {
      return;
    }

    let cancelled = false;
    const maps = mapsAPIRef.current;
    if (!maps) return;
    const map = new maps.Map(guessMapElRef.current, {
      center: WORLD_CENTER,
      zoom: 2,
      mapTypeId: "roadmap",
      disableDefaultUI: true,
      zoomControl: true,
    });

    map.addListener("click", (event) => {
      const currentRoom = roomRef.current;
      if (
        !currentRoom ||
        currentRoom.phase !== "playing" ||
        !currentRoom.can_submit_guess
      ) {
        return;
      }

      const pos = { lat: event.latLng.lat(), lng: event.latLng.lng() };
      const hadPin = Boolean(pendingMarkerRef.current);
      setGuessPin(pos);
      feedbackRef.current.playFeedback("place");
      feedbackRef.current.showFeedbackBubble(
        feedbackRef.current.t(
          hadPin
            ? "geo_online.feedback_pin_moved"
            : "geo_online.feedback_pin_placed",
        ),
        "player",
      );
    });

    guessMapRef.current = map;
    setMapReady(false);

    const fallbackId = window.setTimeout(() => {
      if (!cancelled) setMapReady(true);
    }, MAP_READY_FALLBACK_MS);

    if (maps.event?.addListenerOnce) {
      maps.event.addListenerOnce(map, "idle", () => {
        if (!cancelled) {
          window.clearTimeout(fallbackId);
          setMapReady(true);
        }
      });
    } else {
      window.setTimeout(() => {
        if (!cancelled) setMapReady(true);
      }, 0);
    }

    window.requestAnimationFrame(() => {
      if (cancelled) return;
      refreshMapViewport();
      map.setCenter(WORLD_CENTER);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackId);
      if (guessMapRef.current === map) {
        maps.event?.clearInstanceListeners?.(map);
        guessMapRef.current = null;
      }
    };
  }, [
    feedbackRef,
    guessMapElRef,
    guessMapRef,
    mapsAPIRef,
    mapsReady,
    pendingMarkerRef,
    refreshMapViewport,
    roomId,
    roomRef,
    setGuessPin,
  ]);

  useEffect(() => {
    if (!roomId || !guessMapRef.current) return undefined;

    const refresh = () => {
      refreshMapViewport();
    };

    refresh();

    if (typeof ResizeObserver === "undefined" || !guessMapElRef.current) {
      window.addEventListener("resize", refresh);
      return () => window.removeEventListener("resize", refresh);
    }

    const observer = new ResizeObserver(refresh);
    observer.observe(guessMapElRef.current);
    return () => observer.disconnect();
  }, [guessMapElRef, guessMapRef, refreshMapViewport, roomId]);

  useEffect(() => {
    if (!mapsReady || !guessMapRef.current) return;
    const maps = mapsAPIRef.current;

    if (!guessPin || roomPhase !== "playing") {
      clearPendingMarker();
      return;
    }

    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setPosition(guessPin);
      return;
    }

    pendingMarkerRef.current = createBattleMarker(
      maps,
      guessMapRef.current,
      guessPin,
      "player",
      t,
    );
  }, [
    clearPendingMarker,
    guessMapRef,
    guessPin,
    mapsAPIRef,
    mapsReady,
    pendingMarkerRef,
    roomPhase,
    t,
  ]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;

    clearResultOverlays();

    if (room.phase !== "reveal" && room.phase !== "finished") {
      if (room.phase !== "playing") {
        clearPendingMarker();
        resetMapViewport();
      }
      return;
    }

    clearPendingMarker();
    if (!mapsReady || !guessMapRef.current || !room.round?.target) return;

    const { markers, lines, bounds } = createBattleResultOverlays(
      mapsAPIRef.current,
      guessMapRef.current,
      room.round,
      t,
    );
    resultMarkersRef.current.push(...markers);
    resultLinesRef.current.push(...lines);

    const fitVisibleMap = () => {
      if (!guessMapRef.current) return;
      refreshMapViewport();
      guessMapRef.current.fitBounds(bounds, 40);
    };
    const frameId = window.requestAnimationFrame(fitVisibleMap);
    const timerId = window.setTimeout(fitVisibleMap, RESULT_FIT_DELAY_MS);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [
    clearPendingMarker,
    clearResultOverlays,
    guessMapRef,
    mapsAPIRef,
    mapsReady,
    refreshMapViewport,
    resetMapViewport,
    resultLinesRef,
    resultMarkersRef,
    resultOverlayKey,
    roomRef,
    t,
  ]);

  const roundIndex = room?.round?.index;
  useEffect(() => {
    setGuessPin(null);
    clearPendingMarker();
    clearResultOverlays();
    // Reads the phase at the time the round changes; a later phase change
    // alone must not clear the player's pin.
    if (roomRef.current?.phase !== "playing") {
      resetMapViewport();
    }
  }, [
    clearPendingMarker,
    clearResultOverlays,
    resetMapViewport,
    roomRef,
    roundIndex,
    setGuessPin,
  ]);

  return { mapsReady, mapReady, mapsError };
}

export { useGeoBattleGuessMapHandles, useGeoBattleGuessMap, WORLD_CENTER };
