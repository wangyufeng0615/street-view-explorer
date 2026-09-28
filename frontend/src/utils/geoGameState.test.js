import { describe, expect, it } from "vitest";
import { initialState, reducer } from "./geoGameState";
import { TOTAL_ROUNDS, MIN_ZOOM } from "./geoGameUtils";

describe("single-player round state", () => {
  it("finishes exactly once per round and preserves the plan and used targets", () => {
    let state = reducer(initialState, {
      type: "START_GAME",
      countryCode: "us",
      aiEnabled: true,
    });
    const plan = state.roundPlan;
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      const target = {
        lat: round,
        lng: 10,
        panoId: `pano-${round}`,
        country: "USA",
      };
      state = reducer(state, { type: "SET_TARGET", payload: target });
      state = reducer(state, { type: "PLACE_PIN", payload: target });
      state = reducer(state, { type: "LOCK_IN" });
      expect(state.guessResult.score).toBe(5000);
      state = reducer(state, { type: "NEXT_ROUND" });
      expect(state.scores).toHaveLength(round);
      expect(state.usedTargets).toHaveLength(round);
      expect(state.roundPlan).toBe(plan);
      expect(reducer(state, { type: "NEXT_ROUND" })).toBe(state);
      expect(
        reducer(state, { type: "SET_AI_GUESS", payload: { score: 5000 } }),
      ).toBe(state);
    }
    expect(state.phase).toBe("GAME_OVER");
    expect(state.countryCode).toBe("US");
    expect(reducer(state, { type: "RESTART" })).toEqual(initialState);
  });
  it("guards invalid actions, zoom floor and give-up scoring", () => {
    expect(reducer(initialState, { type: "LOCK_IN" })).toBe(initialState);
    let state = {
      ...initialState,
      phase: "PLAYING",
      currentZoom: MIN_ZOOM,
      target: { lat: 1, lng: 2 },
    };
    expect(reducer(state, { type: "ZOOM_OUT" })).toBe(state);
    state = reducer(state, { type: "GIVE_UP" });
    expect(state.guessResult).toEqual({
      lat: null,
      lng: null,
      distance: null,
      score: 0,
    });
    expect(reducer(state, { type: "LOCK_IN" })).toBe(state);
  });
  it("keeps the game and scores when a round target fails, until retried", () => {
    const scores = [{ playerScore: 4200 }, { playerScore: 3100 }];
    let state = {
      ...initialState,
      phase: "LOADING",
      round: 3,
      scores,
      roundPlan: [],
    };
    state = reducer(state, { type: "TARGET_FAILED" });
    expect(state.phase).toBe("LOADING");
    expect(state.targetError).toBe(true);
    expect(state.scores).toBe(scores);
    expect(state.round).toBe(3);

    state = reducer(state, { type: "RETRY_TARGET" });
    expect(state.targetError).toBe(false);
    expect(reducer(state, { type: "RETRY_TARGET" })).toBe(state);

    state = reducer(state, { type: "TARGET_FAILED" });
    state = reducer(state, {
      type: "SET_TARGET",
      payload: { lat: 1, lng: 2 },
    });
    expect(state.phase).toBe("PLAYING");
    expect(state.targetError).toBe(false);

    expect(reducer(state, { type: "TARGET_FAILED" })).toBe(state);
  });
});
