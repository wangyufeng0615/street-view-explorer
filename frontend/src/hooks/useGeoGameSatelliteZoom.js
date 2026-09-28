import { useCallback, useEffect, useRef, useState } from "react";
import { MIN_ZOOM } from "../utils/geoGameUtils";
import { getSatelliteUrl } from "../utils/geoGameSatellite";

export const SATELLITE_ZOOM_TRANSITION_MS = 760;

/**
 * Satellite image state and the zoom-out handoff.
 *
 * Zooming out first loads the next static image off-screen; only once it has
 * loaded does the round zoom change, and the old image hands off to the new
 * one with a ~760ms animation (skipped for reduced motion). Any pending load
 * is invalidated via a request id when the target changes, the phase leaves
 * PLAYING, or `cancelSatelliteZoomTransition` is called.
 */
export function useGeoGameSatelliteZoom({
  state,
  stateRef,
  dispatch,
  satelliteImageSize,
  playFeedback,
  showFeedbackBubble,
  t,
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [zoomTransition, setZoomTransition] = useState(null);
  const [zoomTransitionLoading, setZoomTransitionLoading] = useState(false);
  const zoomTransitionRequestRef = useRef(0);
  const zoomTransitionTimerRef = useRef(null);

  // ─── Preload next zoom level ───
  useEffect(() => {
    if (!state.target || state.phase !== "PLAYING") return;
    const nextZoom = state.currentZoom - 1;
    if (nextZoom < MIN_ZOOM) return;
    const img = new Image();
    img.src = getSatelliteUrl(state.target, nextZoom, satelliteImageSize);
  }, [state.currentZoom, state.target, state.phase, satelliteImageSize]);

  // ─── Reset image state on zoom change ───
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
    setZoomTransitionLoading(false);
  }, [state.currentZoom, state.target]);

  // A new request size swaps the <img> for a different URL; treat it as not
  // loaded until it is, so the spinner shows and zoom-out waits for it.
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [satelliteImageSize]);

  useEffect(() => {
    setZoomTransition(null);
    setZoomTransitionLoading(false);
    zoomTransitionRequestRef.current += 1;
    if (zoomTransitionTimerRef.current) {
      window.clearTimeout(zoomTransitionTimerRef.current);
      zoomTransitionTimerRef.current = null;
    }
  }, [state.target]);

  useEffect(
    () => () => {
      zoomTransitionRequestRef.current += 1;
      if (zoomTransitionTimerRef.current) {
        window.clearTimeout(zoomTransitionTimerRef.current);
      }
    },
    [],
  );

  const cancelSatelliteZoomTransition = useCallback(() => {
    zoomTransitionRequestRef.current += 1;
    if (zoomTransitionTimerRef.current) {
      window.clearTimeout(zoomTransitionTimerRef.current);
      zoomTransitionTimerRef.current = null;
    }
    setZoomTransition(null);
    setZoomTransitionLoading(false);
  }, []);

  useEffect(() => {
    if (state.phase === "PLAYING") return;
    cancelSatelliteZoomTransition();
  }, [state.phase, cancelSatelliteZoomTransition]);

  const satelliteUrl = state.target
    ? getSatelliteUrl(state.target, state.currentZoom, satelliteImageSize)
    : null;
  const canZoomOut =
    state.currentZoom > MIN_ZOOM &&
    state.phase === "PLAYING" &&
    imgLoaded &&
    !zoomTransition &&
    !zoomTransitionLoading;
  const handleZoomOut = useCallback(() => {
    const currentState = stateRef.current;
    if (
      currentState.phase !== "PLAYING" ||
      !currentState.target ||
      currentState.currentZoom <= MIN_ZOOM ||
      zoomTransition ||
      zoomTransitionLoading
    ) {
      return;
    }

    const nextZoom = currentState.currentZoom - 1;
    const toUrl = getSatelliteUrl(
      currentState.target,
      nextZoom,
      satelliteImageSize,
    );
    const requestId = zoomTransitionRequestRef.current + 1;
    zoomTransitionRequestRef.current = requestId;
    setZoomTransitionLoading(true);
    setImgError(false);

    const img = new Image();
    img.onload = () => {
      if (zoomTransitionRequestRef.current !== requestId) return;

      const prefersReducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

      setZoomTransitionLoading(false);
      if (!prefersReducedMotion) {
        setZoomTransition({
          toUrl,
          requestId,
          animationDone: false,
        });
      }
      dispatch({ type: "ZOOM_OUT" });
      playFeedback("zoom");
      showFeedbackBubble(t("geo.feedback_zoom_out"), "zoom");

      if (!prefersReducedMotion) {
        if (zoomTransitionTimerRef.current) {
          window.clearTimeout(zoomTransitionTimerRef.current);
        }
        zoomTransitionTimerRef.current = window.setTimeout(() => {
          setZoomTransition((current) =>
            current?.requestId === requestId
              ? { ...current, animationDone: true }
              : current,
          );
          zoomTransitionTimerRef.current = null;
        }, SATELLITE_ZOOM_TRANSITION_MS);
      }
    };
    img.onerror = () => {
      if (zoomTransitionRequestRef.current !== requestId) return;
      setZoomTransitionLoading(false);
      setImgError(true);
      playFeedback("error");
      showFeedbackBubble(t("geo.feedback_image_error"), "danger");
    };
    img.src = toUrl;
  }, [
    dispatch,
    satelliteImageSize,
    stateRef,
    zoomTransition,
    zoomTransitionLoading,
    playFeedback,
    showFeedbackBubble,
    t,
  ]);

  useEffect(() => {
    if (!zoomTransition?.animationDone || !imgLoaded) return;
    setZoomTransition(null);
  }, [zoomTransition, imgLoaded]);

  // Event handlers for the rendered satellite images.
  const handleSatelliteImageLoad = () => setImgLoaded(true);
  const handleSatelliteImageError = () => {
    setImgError(true);
    setImgLoaded(true);
    playFeedback("error");
    showFeedbackBubble(t("geo.feedback_image_error"), "danger");
  };
  const handleZoomTransitionAnimationEnd = (requestId) =>
    setZoomTransition((current) =>
      current?.requestId === requestId
        ? { ...current, animationDone: true }
        : current,
    );

  return {
    satelliteUrl,
    imgLoaded,
    imgError,
    zoomTransition,
    zoomTransitionLoading,
    canZoomOut,
    handleZoomOut,
    cancelSatelliteZoomTransition,
    handleSatelliteImageLoad,
    handleSatelliteImageError,
    handleZoomTransitionAnimationEnd,
  };
}
