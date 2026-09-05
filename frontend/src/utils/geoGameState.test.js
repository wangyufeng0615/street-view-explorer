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
});
