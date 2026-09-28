import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../services/api", () => ({
  getRandomLocation: vi.fn(),
}));

import { getRandomLocation } from "../services/api";
import { useGeoGameRoundTargets } from "./useGeoGameRoundTargets";
import { TOTAL_ROUNDS } from "../utils/geoGameUtils";

const PLAN = Array.from({ length: TOTAL_ROUNDS }, () => ({ source: "random" }));
const SIZE = { width: 640, height: 360 };

function location(latitude, longitude, panoId) {
  return {
    success: true,
    data: {
      latitude,
      longitude,
      formatted_address: `Place ${latitude}`,
      country: "Somewhere",
      pano_id: panoId,
    },
  };
}

function gameState(overrides = {}) {
  return {
    phase: "LOADING",
    round: 1,
    roundPlan: PLAN,
    countryCode: "",
    usedTargets: [],
    ...overrides,
  };
}

function renderTargets(initialProps) {
  return renderHook((props) => useGeoGameRoundTargets(props), {
    initialProps: {
      dispatch: vi.fn(),
      language: "en",
      satelliteImageSize: SIZE,
      ...initialProps,
    },
  });
}

describe("useGeoGameRoundTargets", () => {
  let imageUrls;
  let OriginalImage;

  beforeEach(() => {
    getRandomLocation.mockReset();
    imageUrls = [];
    OriginalImage = global.Image;
    global.Image = class {
      set src(value) {
        imageUrls.push(value);
      }
    };
  });

  afterEach(() => {
    global.Image = OriginalImage;
  });

  it("resolves the current round target while loading", async () => {
    getRandomLocation.mockResolvedValueOnce(location(10, 20, "pano-1"));
    const dispatch = vi.fn();
    renderTargets({ state: gameState({ countryCode: "JP" }), dispatch });

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_TARGET",
        payload: expect.objectContaining({
          lat: 10,
          lng: 20,
          panoId: "pano-1",
        }),
      }),
    );
    expect(getRandomLocation).toHaveBeenCalledWith("en", "geo_game", "JP");
  });

  it("reports a retryable error instead of restarting when no target is found", async () => {
    getRandomLocation.mockResolvedValue({ success: false });
    const dispatch = vi.fn();
    const { rerender } = renderTargets({
      state: gameState({ round: 3 }),
      dispatch,
    });

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: "TARGET_FAILED" }),
    );
    expect(dispatch).not.toHaveBeenCalledWith({ type: "RESTART" });
    const failedCalls = getRandomLocation.mock.calls.length;

    // While the error is shown nothing is fetched.
    rerender({
      state: gameState({ round: 3, targetError: true }),
      dispatch,
      language: "en",
      satelliteImageSize: SIZE,
    });
    expect(getRandomLocation).toHaveBeenCalledTimes(failedCalls);

    // Retrying clears the error and resolves the same round again.
    getRandomLocation.mockResolvedValue(location(30, 40, "pano-3"));
    rerender({
      state: gameState({ round: 3, targetError: false }),
      dispatch,
      language: "en",
      satelliteImageSize: SIZE,
    });
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_TARGET",
        payload: expect.objectContaining({ lat: 30, lng: 40 }),
      }),
    );
  });

  it("does not refetch the preload when the satellite panel resizes", async () => {
    getRandomLocation.mockImplementation(() => new Promise(() => {}));
    const state = gameState({ phase: "ROUND_RESULT" });
    const dispatch = vi.fn();
    const { rerender } = renderTargets({ state, dispatch });
    expect(getRandomLocation).toHaveBeenCalledTimes(1);

    rerender({
      state,
      dispatch,
      language: "en",
      satelliteImageSize: { width: 640, height: 480 },
    });
    expect(getRandomLocation).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a stale target after the round changes", async () => {
    let resolveFirst;
    getRandomLocation.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = resolve)),
    );
    const dispatch = vi.fn();
    const { rerender } = renderTargets({ state: gameState(), dispatch });

    rerender({
      state: gameState({ phase: "PLAYING" }),
      dispatch,
      language: "en",
      satelliteImageSize: SIZE,
    });
    await act(async () => {
      resolveFirst(location(10, 20, "pano-1"));
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("preloads the next round during the result and consumes it on load", async () => {
    getRandomLocation.mockResolvedValueOnce(location(30, 40, "pano-2"));
    const dispatch = vi.fn();
    const used = [{ lat: 10, lng: 20, panoId: "pano-1" }];
    const { rerender } = renderTargets({
      state: gameState({ phase: "ROUND_RESULT", usedTargets: used }),
      dispatch,
    });

    await waitFor(() =>
      expect(imageUrls).toEqual([
        "/api/v1/geo/satellite?lat=30&lng=40&zoom=14&width=640&height=360",
      ]),
    );
    expect(dispatch).not.toHaveBeenCalled();

    rerender({
      state: gameState({ round: 2, usedTargets: used }),
      dispatch,
      language: "en",
      satelliteImageSize: SIZE,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_TARGET",
      payload: expect.objectContaining({ lat: 30, lng: 40 }),
    });
    expect(getRandomLocation).toHaveBeenCalledTimes(1);
  });

  it("discards a preloaded target that now duplicates a used target", async () => {
    getRandomLocation
      .mockResolvedValueOnce(location(30, 40, "pano-2"))
      .mockResolvedValueOnce(location(50, 60, "pano-3"));
    const dispatch = vi.fn();
    const { rerender } = renderTargets({
      state: gameState({ phase: "ROUND_RESULT" }),
      dispatch,
    });
    await waitFor(() => expect(imageUrls).toHaveLength(1));

    rerender({
      state: gameState({
        round: 2,
        usedTargets: [{ lat: 30.001, lng: 40.001, panoId: "other" }],
      }),
      dispatch,
      language: "en",
      satelliteImageSize: SIZE,
    });

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_TARGET",
        payload: expect.objectContaining({ lat: 50, lng: 60 }),
      }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not preload past the final round", async () => {
    renderTargets({
      state: gameState({ phase: "ROUND_RESULT", round: TOTAL_ROUNDS }),
    });
    await act(async () => {});
    expect(getRandomLocation).not.toHaveBeenCalled();
    expect(imageUrls).toEqual([]);
  });

  it("drops preloaded targets when cleared", async () => {
    getRandomLocation
      .mockResolvedValueOnce(location(30, 40, "pano-2"))
      .mockResolvedValueOnce(location(50, 60, "pano-3"));
    const dispatch = vi.fn();
    const { result, rerender } = renderTargets({
      state: gameState({ phase: "ROUND_RESULT" }),
      dispatch,
    });
    await waitFor(() => expect(imageUrls).toHaveLength(1));

    act(() => result.current.clearPreloadedTargets());
    rerender({
      state: gameState({ round: 2 }),
      dispatch,
      language: "en",
      satelliteImageSize: SIZE,
    });

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_TARGET",
        payload: expect.objectContaining({ lat: 50, lng: 60 }),
      }),
    );
  });

  it("does not redraw the round when the language changes", async () => {
    getRandomLocation.mockImplementation(() => new Promise(() => {}));
    const dispatch = vi.fn();
    const state = gameState();
    const { rerender } = renderTargets({ state, dispatch });

    rerender({
      state,
      dispatch,
      language: "zh",
      satelliteImageSize: SIZE,
    });
    expect(getRandomLocation).toHaveBeenCalledTimes(1);
    expect(getRandomLocation).toHaveBeenCalledWith("en", "geo_game", "");

    // The next fetch picks up the latest language.
    rerender({
      state: gameState({ round: 2 }),
      dispatch,
      language: "zh",
      satelliteImageSize: SIZE,
    });
    expect(getRandomLocation).toHaveBeenLastCalledWith("zh", "geo_game", "");
  });
});
