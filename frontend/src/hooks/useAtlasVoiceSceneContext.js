import { useCallback, useEffect, useMemo, useRef } from "react";
import { getStreetViewFrameDataURL } from "../services/api";
import useStore from "../store/useStore";
import {
  buildRealtimeSceneContextEvent,
  buildStreetViewSceneSignature,
  resolveStreetViewScene,
} from "../utils/atlasVoiceRuntime";

function sceneFromStoreState(state) {
  return resolveStreetViewScene({
    location: state.location || state.currentLocationRef,
    streetViewView: state.streetViewView,
    heading: state.heading,
  });
}

/**
 * Keeps exactly one silent Street View frame in the Realtime conversation.
 * New frames replace the previous item; a failed capture deletes the stale one.
 * Scene changes are debounced (850ms, immediate for the initial scene) while a
 * voice session is live.
 */
export default function useAtlasVoiceSceneContext({
  sendEvent,
  status,
  location,
  streetViewView,
  heading,
}) {
  const sceneItemIdRef = useRef("");
  const sceneItemCounterRef = useRef(0);
  const sentSceneSignatureRef = useRef("");
  const sceneAbortRef = useRef(null);
  const sceneInFlightRef = useRef(null);
  const sceneDebounceTimerRef = useRef(null);

  const sceneContext = useMemo(
    () => resolveStreetViewScene({ location, streetViewView, heading }),
    [heading, location, streetViewView],
  );
  const sceneSignature = useMemo(
    () => buildStreetViewSceneSignature(sceneContext),
    [sceneContext],
  );
  const sceneSource = sceneContext?.source || "initial";

  const sendLatestSceneContext = useCallback(
    async ({ allowAuto = false } = {}) => {
      const scene = sceneFromStoreState(useStore.getState());
      const signature = buildStreetViewSceneSignature(scene);
      if (!scene || !signature) return false;
      if (!allowAuto && scene.source === "auto" && sceneItemIdRef.current) {
        return sentSceneSignatureRef.current === signature;
      }
      if (
        sentSceneSignatureRef.current === signature &&
        sceneItemIdRef.current
      ) {
        return true;
      }

      if (sceneInFlightRef.current?.signature === signature) {
        return sceneInFlightRef.current.promise;
      }

      const promise = (async () => {
        sceneAbortRef.current?.abort();
        const controller = new AbortController();
        sceneAbortRef.current = controller;
        const frame = await getStreetViewFrameDataURL(
          scene.panoId,
          scene,
          controller.signal,
        );
        if (controller.signal.aborted || !frame.success || !frame.data) {
          if (
            !controller.signal.aborted &&
            sceneItemIdRef.current &&
            sentSceneSignatureRef.current !== signature
          ) {
            sendEvent({
              type: "conversation.item.delete",
              item_id: sceneItemIdRef.current,
            });
            sceneItemIdRef.current = "";
            sentSceneSignatureRef.current = "";
          }
          return false;
        }

        const latestScene = sceneFromStoreState(useStore.getState());
        if (buildStreetViewSceneSignature(latestScene) !== signature) {
          return false;
        }

        sceneItemCounterRef.current += 1;
        const nextItemId = `atlas_scene_${Date.now()}_${sceneItemCounterRef.current}`;
        const previousItemId = sceneItemIdRef.current;
        const didSend = sendEvent(
          buildRealtimeSceneContextEvent({
            itemId: nextItemId,
            imageDataUrl: frame.data,
            scene,
          }),
        );
        if (!didSend) return false;

        sceneItemIdRef.current = nextItemId;
        sentSceneSignatureRef.current = signature;
        if (previousItemId) {
          sendEvent({
            type: "conversation.item.delete",
            item_id: previousItemId,
          });
        }
        return true;
      })();

      sceneInFlightRef.current = { signature, promise };
      try {
        return await promise;
      } finally {
        if (sceneInFlightRef.current?.promise === promise) {
          sceneInFlightRef.current = null;
        }
      }
    },
    [sendEvent],
  );

  useEffect(() => {
    if (
      !sceneSignature ||
      status === "idle" ||
      status === "connecting" ||
      (sceneSource === "auto" && sceneItemIdRef.current)
    ) {
      return undefined;
    }

    if (sceneDebounceTimerRef.current) {
      window.clearTimeout(sceneDebounceTimerRef.current);
    }
    sceneDebounceTimerRef.current = window.setTimeout(
      () => {
        sceneDebounceTimerRef.current = null;
        void sendLatestSceneContext();
      },
      sceneSource === "initial" ? 0 : 850,
    );

    return () => {
      if (sceneDebounceTimerRef.current) {
        window.clearTimeout(sceneDebounceTimerRef.current);
        sceneDebounceTimerRef.current = null;
      }
    };
  }, [sceneSignature, sceneSource, sendLatestSceneContext, status]);

  /** Teardown: abort any capture and forget the frame item for the next session. */
  const resetSceneContext = useCallback(() => {
    sceneAbortRef.current?.abort();
    sceneAbortRef.current = null;
    sceneInFlightRef.current = null;
    if (sceneDebounceTimerRef.current) {
      window.clearTimeout(sceneDebounceTimerRef.current);
      sceneDebounceTimerRef.current = null;
    }
    sceneItemIdRef.current = "";
    sentSceneSignatureRef.current = "";
  }, []);

  return { sendLatestSceneContext, resetSceneContext };
}
