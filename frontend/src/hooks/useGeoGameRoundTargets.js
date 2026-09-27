import { useCallback, useEffect, useRef } from "react";
import {
  START_ZOOM,
  TOTAL_ROUNDS,
  isRoundTargetDuplicate,
} from "../utils/geoGameUtils";
import { getSatelliteUrl } from "../utils/geoGameSatellite";
import { resolveRoundTarget } from "../utils/geoGameTargets";

/**
 * Resolve each round's target from the round plan and preload the next
 * round's target (plus its first satellite image) during the round result.
 *
 * The active language is read through a ref so a language switch never
 * re-triggers round selection.
 */
export function useGeoGameRoundTargets({
  state,
  dispatch,
  language,
  satelliteImageSize,
}) {
  const preloadedTargetsRef = useRef({});
  const langRef = useRef(language);
  langRef.current = language;

  // ─── Fetch location: preloaded target, database entry or random API ───
  useEffect(() => {
    if (state.phase !== "LOADING" || !state.roundPlan) return;
    const plan = state.roundPlan[state.round - 1];
    const preloadedTarget = preloadedTargetsRef.current[state.round];
    if (preloadedTarget) {
      delete preloadedTargetsRef.current[state.round];
      if (!isRoundTargetDuplicate(preloadedTarget, state.usedTargets)) {
        dispatch({ type: "SET_TARGET", payload: preloadedTarget });
        return;
      }
    }

    let cancelled = false;
    (async () => {
      const target = await resolveRoundTarget(
        plan,
        langRef.current,
        state.countryCode,
        state.usedTargets,
      );
      if (cancelled) return;
      dispatch(
        target ? { type: "SET_TARGET", payload: target } : { type: "RESTART" },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    dispatch,
    state.phase,
    state.round,
    state.roundPlan,
    state.countryCode,
    state.usedTargets,
  ]);

  // ─── Preload next round after lock-in ───
  useEffect(() => {
    if (
      state.phase !== "ROUND_RESULT" ||
      !state.roundPlan ||
      state.round >= TOTAL_ROUNDS
    ) {
      return;
    }
    const nextRound = state.round + 1;
    if (preloadedTargetsRef.current[nextRound]) return;

    let cancelled = false;
    const plan = state.roundPlan[nextRound - 1];
    (async () => {
      const target = await resolveRoundTarget(
        plan,
        langRef.current,
        state.countryCode,
        state.usedTargets,
      );
      if (cancelled || !target) return;
      preloadedTargetsRef.current[nextRound] = target;
      const img = new Image();
      img.src = getSatelliteUrl(target, START_ZOOM, satelliteImageSize);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    state.phase,
    state.round,
    state.roundPlan,
    state.countryCode,
    state.usedTargets,
    satelliteImageSize,
  ]);

  const clearPreloadedTargets = useCallback(() => {
    preloadedTargetsRef.current = {};
  }, []);

  return { clearPreloadedTargets };
}
