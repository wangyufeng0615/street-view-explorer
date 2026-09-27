import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useGeoGameAtlasGuess } from "./useGeoGameAtlasGuess";
import { calculateScore, haversineDistance } from "../utils/geoGameUtils";

const TARGET = { lat: 48.8566, lng: 2.3522 };
const SIZE = { width: 640, height: 360 };

function resultState(overrides = {}) {
  return {
    phase: "ROUND_RESULT",
    target: TARGET,
    aiEnabled: true,
    currentZoom: 12,
    zoomSteps: 2,
    ...overrides,
  };
}

describe("useGeoGameAtlasGuess", () => {
  let requests;

  beforeEach(() => {
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url, options) =>
          new Promise((resolve, reject) => {
            const request = { url, options, resolve, reject };
            options.signal.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
            requests.push(request);
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(initialState = resultState(), language = "zh") {
    const dispatch = vi.fn();
    const hook = renderHook(
      ({ state, lang, size }) =>
        useGeoGameAtlasGuess({
          state,
          dispatch,
          satelliteImageSize: size,
          language: lang,
        }),
      { initialProps: { state: initialState, lang: language, size: SIZE } },
    );
    return { ...hook, dispatch };
  }

  async function respond(index, body) {
    await act(async () => {
      requests[index].resolve({ json: () => Promise.resolve(body) });
    });
  }

  const aiGuessActions = (dispatch) =>
    dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === "SET_AI_GUESS");

  it("asks Atlas about the locked zoom, panel size and UI language", () => {
    const { dispatch } = setup();

    expect(dispatch).toHaveBeenCalledWith({ type: "SET_AI_LOADING" });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v1/geo/ai-guess");
    expect(requests[0].options.method).toBe("POST");
    expect(JSON.parse(requests[0].options.body)).toEqual({
      lat: TARGET.lat,
      lng: TARGET.lng,
      zoom: 12,
      width: 640,
      height: 360,
      lang: "zh",
    });
  });

  it.each([
    ["while playing", { phase: "PLAYING" }],
    ["when Atlas is disabled", { aiEnabled: false }],
    ["without a target", { target: null }],
  ])("does not ask Atlas %s", (_label, overrides) => {
    const { dispatch } = setup(resultState(overrides));
    expect(fetch).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("scores the guess with the player's zoom steps", async () => {
    const { dispatch } = setup();
    await respond(0, {
      success: true,
      data: { lat: 50, lng: 3, reasoning: "Haussmann facades" },
    });

    const distance = haversineDistance(50, 3, TARGET.lat, TARGET.lng);
    expect(aiGuessActions(dispatch)).toEqual([
      {
        type: "SET_AI_GUESS",
        payload: {
          lat: 50,
          lng: 3,
          distance,
          score: calculateScore(2, distance),
          reasoning: "Haussmann facades",
        },
      },
    ]);
  });

  it("dispatches an empty guess when the API reports failure", async () => {
    const { dispatch } = setup();
    await respond(0, { success: false, error: "rate limited" });
    expect(aiGuessActions(dispatch)).toEqual([
      { type: "SET_AI_GUESS", payload: null },
    ]);
  });

  it("dispatches an empty guess when the request fails", async () => {
    const { dispatch } = setup();
    await act(async () => {
      requests[0].reject(new TypeError("network"));
    });
    expect(aiGuessActions(dispatch)).toEqual([
      { type: "SET_AI_GUESS", payload: null },
    ]);
  });

  it("aborts the request when the phase changes", () => {
    const { rerender } = setup();
    rerender({
      state: resultState({ phase: "PLAYING" }),
      lang: "zh",
      size: SIZE,
    });
    expect(requests[0].options.signal.aborted).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("aborts the request on unmount", () => {
    const { unmount } = setup();
    unmount();
    expect(requests[0].options.signal.aborted).toBe(true);
  });

  it("never reports a successful guess from an aborted request", async () => {
    const { dispatch, unmount } = setup();
    unmount();
    // A late body cannot win over the abort rejection.
    await respond(0, { success: true, data: { lat: 1, lng: 1 } });
    expect(
      aiGuessActions(dispatch).filter((action) => action.payload !== null),
    ).toEqual([]);
  });

  it("keeps the single request when the language or panel size changes", async () => {
    const { dispatch, rerender } = setup();
    rerender({ state: resultState(), lang: "en", size: SIZE });
    rerender({
      state: resultState(),
      lang: "en",
      size: { width: 480, height: 480 },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].options.signal.aborted).toBe(false);
    expect(JSON.parse(requests[0].options.body).lang).toBe("zh");

    await respond(0, { success: true, data: { lat: 1, lng: 1 } });
    const guesses = aiGuessActions(dispatch);
    expect(guesses).toHaveLength(1);
    expect(guesses[0].payload).toMatchObject({ lat: 1, lng: 1 });
  });

  it("does not report a failure for a request it aborted itself", async () => {
    const { dispatch, rerender } = setup();
    rerender({
      state: resultState({ aiEnabled: false }),
      lang: "zh",
      size: SIZE,
    });
    await act(async () => {});

    expect(requests[0].options.signal.aborted).toBe(true);
    expect(aiGuessActions(dispatch)).toEqual([]);
  });

  it("asks again for the next round result", () => {
    const { rerender } = setup();
    rerender({
      state: resultState({ phase: "LOADING", target: null }),
      lang: "zh",
      size: SIZE,
    });
    rerender({
      state: resultState({ target: { lat: 35.68, lng: 139.69 } }),
      lang: "zh",
      size: SIZE,
    });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1].options.body)).toMatchObject({
      lat: 35.68,
      lng: 139.69,
    });
  });
});
