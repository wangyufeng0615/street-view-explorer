import { useEffect, useRef } from "react";
import { initialState } from "../utils/geoGameState";

/**
 * Sound + bubble feedback for phase transitions: round ready, Atlas guess
 * arrived, and game finished.
 */
export function useGeoGamePhaseFeedback({
  state,
  playFeedback,
  showFeedbackBubble,
  t,
}) {
  const phaseFeedbackRef = useRef({
    phase: initialState.phase,
    round: initialState.round,
    aiGuessReady: false,
  });

  useEffect(() => {
    const previous = phaseFeedbackRef.current;
    const aiGuessReady =
      state.phase === "ROUND_RESULT" && Boolean(state.aiGuess);

    if (previous.phase === "LOADING" && state.phase === "PLAYING") {
      playFeedback("ready");
      showFeedbackBubble(t("geo.feedback_round_ready"), "success");
    }

    if (!previous.aiGuessReady && aiGuessReady) {
      playFeedback("place");
      showFeedbackBubble(t("geo.feedback_ai_done"), "atlas");
    }

    if (previous.phase !== "GAME_OVER" && state.phase === "GAME_OVER") {
      playFeedback("finish");
      showFeedbackBubble(t("geo.feedback_game_finished"), "success");
    }

    phaseFeedbackRef.current = {
      phase: state.phase,
      round: state.round,
      aiGuessReady,
    };
  }, [
    state.phase,
    state.round,
    state.aiGuess,
    playFeedback,
    showFeedbackBubble,
    t,
  ]);
}
