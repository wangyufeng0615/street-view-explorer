import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGeoGamePhaseFeedback } from "./useGeoGamePhaseFeedback";

function setup() {
  const playFeedback = vi.fn();
  const showFeedbackBubble = vi.fn();
  const t = (key) => key;
  const hook = renderHook(
    ({ state }) =>
      useGeoGamePhaseFeedback({ state, playFeedback, showFeedbackBubble, t }),
    { initialProps: { state: { phase: "WELCOME", round: 0, aiGuess: null } } },
  );
  const go = (state) => hook.rerender({ state });
  return { playFeedback, showFeedbackBubble, go };
}

describe("useGeoGamePhaseFeedback", () => {
  it("announces round ready, Atlas guess and game over exactly once", () => {
    const { playFeedback, showFeedbackBubble, go } = setup();
    expect(playFeedback).not.toHaveBeenCalled();

    go({ phase: "LOADING", round: 1, aiGuess: null });
    expect(playFeedback).not.toHaveBeenCalled();

    go({ phase: "PLAYING", round: 1, aiGuess: null });
    expect(playFeedback).toHaveBeenLastCalledWith("ready");
    expect(showFeedbackBubble).toHaveBeenLastCalledWith(
      "geo.feedback_round_ready",
      "success",
    );

    go({ phase: "ROUND_RESULT", round: 1, aiGuess: null });
    expect(playFeedback).toHaveBeenCalledTimes(1);

    const aiGuess = { lat: 1, lng: 2 };
    go({ phase: "ROUND_RESULT", round: 1, aiGuess });
    expect(playFeedback).toHaveBeenLastCalledWith("place");
    expect(showFeedbackBubble).toHaveBeenLastCalledWith(
      "geo.feedback_ai_done",
      "atlas",
    );

    go({ phase: "GAME_OVER", round: 1, aiGuess });
    expect(playFeedback).toHaveBeenLastCalledWith("finish");
    expect(showFeedbackBubble).toHaveBeenLastCalledWith(
      "geo.feedback_game_finished",
      "success",
    );
    go({ phase: "GAME_OVER", round: 1, aiGuess: { ...aiGuess } });
    expect(playFeedback).toHaveBeenCalledTimes(3);
  });

  it("does not announce round ready when resuming play without loading", () => {
    const { playFeedback, go } = setup();
    go({ phase: "PLAYING", round: 1, aiGuess: null });
    expect(playFeedback).not.toHaveBeenCalled();
  });
});
