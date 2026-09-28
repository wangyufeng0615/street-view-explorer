import { useEffect, useRef, useState } from "react";

import { fetchGeoBattleImage } from "../services/api";
import {
  completeZoomTransition,
  getBattleImageVersion,
  isBattleImageAvailable,
} from "../utils/geoBattleRoomState";

const SATELLITE_ZOOM_TRANSITION_MS = 760;
// Failed image requests are retried with exponential backoff (1s, 2s, 4s)
// before the error overlay is shown; polling alone never refetches because
// the image version does not change.
const IMAGE_RETRY_DELAYS_MS = [1000, 2000, 4000];

/**
 * Loads the current round's satellite image as an object URL and runs the
 * zoom-out handoff: the previous image stays visible while the next one loads,
 * then a ~760ms transition layer scales the new image from 2x down to 1x on
 * an opaque backdrop, which reads as the camera pulling back one zoom level.
 *
 * `feedbackRef` is read inside the fetch effect; `playFeedback`,
 * `showFeedbackBubble` and `t` back the <img> error handler.
 */
function useGeoBattleSatelliteImage({
  room,
  feedbackRef,
  playFeedback,
  showFeedbackBubble,
  t,
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imageObjectUrl, setImageObjectUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [displayedImageVersion, setDisplayedImageVersion] = useState("");
  const [zoomTransition, setZoomTransition] = useState(null);

  const imageObjectUrlRef = useRef(null);
  const displayedImageVersionRef = useRef("");
  const zoomTransitionRequestRef = useRef(0);
  const zoomTransitionTimerRef = useRef(null);

  const roomId = room?.room_id;
  const roomPhase = room?.phase;
  const imageVersion = getBattleImageVersion(room);
  const imageAvailable = isBattleImageAvailable(room);
  const imageForCurrentState =
    imageAvailable && displayedImageVersion === imageVersion;
  const imageInteractionPending =
    imageAvailable && !imageForCurrentState && !imgError;
  const showImageLoading =
    imageAvailable && imageLoading && !imageObjectUrl && !imgError;

  useEffect(() => {
    if (!imageAvailable || !roomId) {
      setImageObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        imageObjectUrlRef.current = null;
        return null;
      });
      displayedImageVersionRef.current = "";
      setDisplayedImageVersion("");
      setImageLoading(false);
      setImgLoaded(false);
      setImgError(false);
      setZoomTransition(null);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    const hadVisibleImage = Boolean(imageObjectUrlRef.current);
    const previousImageVersion = displayedImageVersionRef.current;
    const transitionRequestId = zoomTransitionRequestRef.current + 1;
    zoomTransitionRequestRef.current = transitionRequestId;
    setImageLoading(true);
    if (!hadVisibleImage) {
      setImgLoaded(false);
    }
    setImgError(false);

    let retryCount = 0;
    let retryTimerId = null;

    const loadImage = () =>
      fetchGeoBattleImage(roomId, imageVersion, controller.signal)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          const shouldAnimateZoom =
            hadVisibleImage &&
            previousImageVersion &&
            previousImageVersion !== imageVersion &&
            roomPhase === "playing" &&
            !(
              typeof window !== "undefined" &&
              window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
            );
          setImageObjectUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            imageObjectUrlRef.current = url;
            return url;
          });
          displayedImageVersionRef.current = imageVersion;
          setDisplayedImageVersion(imageVersion);
          setImageLoading(false);
          setImgLoaded(true);
          setImgError(false);
          if (shouldAnimateZoom) {
            setZoomTransition({
              toUrl: url,
              requestId: transitionRequestId,
              animationDone: false,
            });
            if (zoomTransitionTimerRef.current) {
              window.clearTimeout(zoomTransitionTimerRef.current);
            }
            zoomTransitionTimerRef.current = window.setTimeout(() => {
              setZoomTransition((current) =>
                completeZoomTransition(current, transitionRequestId),
              );
              zoomTransitionTimerRef.current = null;
            }, SATELLITE_ZOOM_TRANSITION_MS);
          } else {
            setZoomTransition(null);
          }
        })
        .catch((err) => {
          if (cancelled || err.name === "AbortError") return;
          if (retryCount < IMAGE_RETRY_DELAYS_MS.length) {
            const delayMs = IMAGE_RETRY_DELAYS_MS[retryCount];
            retryCount += 1;
            retryTimerId = window.setTimeout(loadImage, delayMs);
            return;
          }
          setImageLoading(false);
          setImgError(true);
          setImgLoaded(true);
          feedbackRef.current.playFeedback("error");
          feedbackRef.current.showFeedbackBubble(
            feedbackRef.current.t("geo_online.feedback_image_error"),
            "danger",
          );
        });

    loadImage();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimerId);
      controller.abort();
    };
    // roomPhase is part of imageVersion, so listing it adds no extra fetches.
  }, [feedbackRef, imageAvailable, imageVersion, roomId, roomPhase]);

  useEffect(() => {
    if (!zoomTransition?.animationDone || !imgLoaded) return;
    setZoomTransition(null);
  }, [zoomTransition, imgLoaded]);

  useEffect(() => {
    return () => {
      zoomTransitionRequestRef.current += 1;
      if (zoomTransitionTimerRef.current) {
        window.clearTimeout(zoomTransitionTimerRef.current);
      }
      if (imageObjectUrlRef.current) {
        URL.revokeObjectURL(imageObjectUrlRef.current);
        imageObjectUrlRef.current = null;
      }
    };
  }, []);

  const handleImageLoad = () => setImgLoaded(true);

  const handleImageError = () => {
    setImgLoaded(true);
    setImgError(true);
    playFeedback("error");
    showFeedbackBubble(t("geo_online.feedback_image_error"), "danger");
  };

  const handleTransitionEnd = (requestId) =>
    setZoomTransition((current) => completeZoomTransition(current, requestId));

  return {
    imageAvailable,
    imageObjectUrl,
    imgLoaded,
    imgError,
    showImageLoading,
    imageInteractionPending,
    zoomTransition,
    handleImageLoad,
    handleImageError,
    handleTransitionEnd,
  };
}

export {
  useGeoBattleSatelliteImage,
  SATELLITE_ZOOM_TRANSITION_MS,
  IMAGE_RETRY_DELAYS_MS,
};
