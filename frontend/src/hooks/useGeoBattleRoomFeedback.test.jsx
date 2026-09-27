import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGeoBattleRoomFeedback } from "./useGeoBattleRoomFeedback";

const t = (key) => key;

function room(phase, round = {}) {
  return {
    phase,
    round: { index: 1, opponent_locked: false, ...round },
    me: { has_submitted_this_round: false },
  };
}

function setup(initialRoom) {
  const playFeedback = vi.fn();
  const showFeedbackBubble = vi.fn();
  const hook = renderHook(
    ({ current }) =>
      useGeoBattleRoomFeedback({
        room: current,
        playFeedback,
        showFeedbackBubble,
        t,
      }),
    { initialProps: { current: initialRoom } },
  );
  return { ...hook, playFeedback, showFeedbackBubble };
}

describe("useGeoBattleRoomFeedback", () => {
  it("stays silent for the first snapshot, then announces transitions", () => {
    const { rerender, playFeedback, showFeedbackBubble } = setup(
      room("countdown"),
    );
    expect(playFeedback).not.toHaveBeenCalled();

    rerender({ current: room("playing") });
    expect(playFeedback).toHaveBeenCalledWith("ready");
    expect(showFeedbackBubble).toHaveBeenLastCalledWith(
      "geo_online.feedback_round_start",
      "target",
    );

    rerender({ current: room("playing", { opponent_locked: true }) });
    expect(playFeedback).toHaveBeenLastCalledWith("place");
    expect(showFeedbackBubble).toHaveBeenLastCalledWith(
      "geo_online.feedback_opponent_locked",
      "opponent",
    );
    expect(playFeedback).toHaveBeenCalledTimes(2);
  });

  it("re-primes after the room is cleared instead of replaying stale transitions", () => {
    const { rerender, playFeedback } = setup(room("lobby"));
    rerender({ current: null });
    rerender({ current: room("reveal") });
    expect(playFeedback).not.toHaveBeenCalled();

    rerender({ current: room("finished") });
    expect(playFeedback).toHaveBeenCalledWith("finish");
  });
});
