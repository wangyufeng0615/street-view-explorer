import { useEffect, useRef } from "react";
import { calculateScore, haversineDistance } from "../utils/geoGameUtils";

/**
 * Ask Atlas to guess the current satellite image once the round result is
 * shown. Atlas only sees the image at the zoom the player locked in, sized
 * like the satellite panel.
 *
 * Atlas guesses once per round result: resizing the panel or switching the UI
 * language afterwards must not re-ask (which would replace Atlas's score and
 * spend another rate-limited request), so those inputs are read from a ref at
 * request time. An aborted request is ignored instead of reported as failed.
 */
export function useGeoGameAtlasGuess({
  state,
  dispatch,
  satelliteImageSize,
  language,
}) {
  const requestInputRef = useRef(null);
  requestInputRef.current = {
    currentZoom: state.currentZoom,
    zoomSteps: state.zoomSteps,
    satelliteImageSize,
    language,
  };

  useEffect(() => {
    const target = state.target;
    if (state.phase !== "ROUND_RESULT" || !target || !state.aiEnabled) return;
    const { currentZoom, zoomSteps, satelliteImageSize, language } =
      requestInputRef.current;
    const controller = new AbortController();

    dispatch({ type: "SET_AI_LOADING" });
    fetch("/api/v1/geo/ai-guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: target.lat,
        lng: target.lng,
        zoom: currentZoom,
        width: satelliteImageSize?.width,
        height: satelliteImageSize?.height,
        lang: language,
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.success && data.data) {
          const { lat, lng, reasoning } = data.data;
          const dist = haversineDistance(lat, lng, target.lat, target.lng);
          dispatch({
            type: "SET_AI_GUESS",
            payload: {
              lat,
              lng,
              distance: dist,
              score: calculateScore(zoomSteps, dist),
              reasoning,
            },
          });
        } else {
          dispatch({ type: "SET_AI_GUESS", payload: null });
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        dispatch({ type: "SET_AI_GUESS", payload: null });
      });

    return () => {
      controller.abort();
    };
  }, [state.phase, state.target, state.aiEnabled, dispatch]);
}
