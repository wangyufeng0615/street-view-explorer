import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../utils/googleMaps", () => ({
  loadGoogleMapsScript: vi.fn(),
}));

import { loadGoogleMapsScript } from "../utils/googleMaps";
import { useGeoGameGuessMap } from "./useGeoGameGuessMap";

const GREEN = "#10b981";
const RED = "#ef4444";
const PURPLE = "#8b5cf6";
const TARGET = { lat: 35.68, lng: 139.69 };

function createFakeMaps() {
  const maps = { maps: [], markers: [], polylines: [] };

  class FakeMap {
    constructor(el, options) {
      this.el = el;
      this.options = options;
      this.listeners = {};
      this.setCenter = vi.fn();
      this.setZoom = vi.fn();
      this.fitBounds = vi.fn();
      maps.maps.push(this);
    }
    addListener(name, handler) {
      this.listeners[name] = handler;
    }
    click(lat, lng) {
      this.listeners.click({ latLng: { lat: () => lat, lng: () => lng } });
    }
  }

  class FakeOverlay {
    constructor(options) {
      this.options = options;
      this.map = options.map;
      this.position = options.position;
    }
    setMap(map) {
      this.map = map;
    }
    setPosition(position) {
      this.position = position;
    }
  }

  class FakeMarker extends FakeOverlay {
    constructor(options) {
      super(options);
      maps.markers.push(this);
    }
  }

  class FakePolyline extends FakeOverlay {
    constructor(options) {
      super(options);
      maps.polylines.push(this);
    }
  }

  maps.api = {
    Map: FakeMap,
    Marker: FakeMarker,
    Polyline: FakePolyline,
    LatLngBounds: class {
      constructor() {
        this.points = [];
      }
      extend(point) {
        this.points.push(point);
      }
    },
    Size: class {},
    Point: class {},
    event: { trigger: vi.fn() },
  };
  return maps;
}

/** Fill color baked into a guess pin's SVG data URL. */
function pinColor(marker) {
  const match = decodeURIComponent(marker.options.icon.url).match(
    /fill="(#[0-9a-f]{6})" stroke/,
  );
  return match?.[1];
}

const onMap = (overlays) => overlays.filter((overlay) => overlay.map);

describe("useGeoGameGuessMap", () => {
  let fake;

  beforeEach(() => {
    vi.useFakeTimers();
    fake = createFakeMaps();
    vi.mocked(loadGoogleMapsScript).mockReset().mockResolvedValue(fake.api);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(initialState = { phase: "PLAYING", guessPin: null }) {
    const dispatch = vi.fn();
    const playFeedback = vi.fn();
    const showFeedbackBubble = vi.fn();
    const stateRef = { current: initialState };
    const hook = renderHook(
      ({ state }) => {
        stateRef.current = state;
        return useGeoGameGuessMap({
          state,
          stateRef,
          dispatch,
          playFeedback,
          showFeedbackBubble,
          t: (key) => key,
        });
      },
      { initialProps: { state: initialState } },
    );
    hook.result.current.guessMapElRef.current = document.createElement("div");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return { ...hook, stateRef, dispatch, playFeedback, showFeedbackBubble };
  }

  it("creates the map once after Maps loads", async () => {
    const { result, rerender } = await setup();
    expect(result.current.mapsReady).toBe(true);
    expect(fake.maps).toHaveLength(1);
    expect(fake.maps[0].options).toMatchObject({
      center: { lat: 20, lng: 0 },
      zoom: 2,
    });

    rerender({ state: { phase: "PLAYING", guessPin: { lat: 1, lng: 2 } } });
    rerender({ state: { phase: "ROUND_RESULT", target: TARGET } });
    expect(fake.maps).toHaveLength(1);
  });

  it("reports a Maps load failure", async () => {
    vi.mocked(loadGoogleMapsScript).mockRejectedValueOnce(new Error("blocked"));
    const { result } = await setup();
    expect(result.current.mapsError).toBe(true);
    expect(fake.maps).toHaveLength(0);
  });

  it("does not create the map on the welcome screen", async () => {
    await setup({ phase: "WELCOME" });
    expect(fake.maps).toHaveLength(0);
  });

  it("places a red pending pin on click, then moves it", async () => {
    const { dispatch, playFeedback, showFeedbackBubble, rerender } =
      await setup();
    const map = fake.maps[0];

    act(() => map.click(10, 20));
    expect(dispatch).toHaveBeenCalledWith({
      type: "PLACE_PIN",
      payload: { lat: 10, lng: 20 },
    });
    expect(playFeedback).toHaveBeenCalledWith("place");
    expect(showFeedbackBubble).toHaveBeenLastCalledWith(
      "geo.feedback_pin_placed",
      "player",
    );
    expect(fake.markers).toHaveLength(1);
    expect(pinColor(fake.markers[0])).toBe(RED);
    expect(fake.markers[0].map).toBe(map);

    rerender({ state: { phase: "PLAYING", guessPin: { lat: 10, lng: 20 } } });
    act(() => map.click(-5, 7));
    expect(fake.markers).toHaveLength(1);
    expect(fake.markers[0].position).toEqual({ lat: -5, lng: 7 });
    expect(showFeedbackBubble).toHaveBeenLastCalledWith(
      "geo.feedback_pin_moved",
      "player",
    );
  });

  it("ignores clicks outside of PLAYING", async () => {
    const { dispatch, rerender } = await setup();
    rerender({ state: { phase: "ROUND_RESULT", target: null } });
    act(() => fake.maps[0].click(10, 20));
    expect(dispatch).not.toHaveBeenCalled();
    expect(fake.markers).toHaveLength(0);
  });

  it("draws green target, red player and purple Atlas pins with lines", async () => {
    const { rerender } = await setup();
    const map = fake.maps[0];
    act(() => map.click(30, 130));
    const pending = fake.markers[0];

    rerender({
      state: {
        phase: "ROUND_RESULT",
        target: TARGET,
        guessResult: { lat: 30, lng: 130, distance: 1000 },
        aiGuess: { lat: 40, lng: 120 },
      },
    });

    expect(pending.map).toBeNull();
    const shown = onMap(fake.markers);
    expect(shown.map(pinColor)).toEqual([GREEN, RED, PURPLE]);
    expect(shown.map((marker) => marker.position)).toEqual([
      TARGET,
      { lat: 30, lng: 130 },
      { lat: 40, lng: 120 },
    ]);
    const lines = onMap(fake.polylines);
    expect(lines.map((line) => line.options.strokeColor)).toEqual([
      RED,
      PURPLE,
    ]);
    expect(lines[0].options.path).toEqual([{ lat: 30, lng: 130 }, TARGET]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    const bounds = map.fitBounds.mock.calls.at(-1)[0];
    expect(bounds.points).toHaveLength(3);
  });

  it("shows only the target when the player gave up and Atlas is pending", async () => {
    const { rerender } = await setup();
    rerender({
      state: {
        phase: "ROUND_RESULT",
        target: TARGET,
        guessResult: { lat: null, lng: null, distance: null },
        aiGuess: null,
      },
    });
    expect(onMap(fake.markers).map(pinColor)).toEqual([GREEN]);
    expect(onMap(fake.polylines)).toHaveLength(0);
  });

  it("redraws the result when the Atlas guess arrives late", async () => {
    const { rerender } = await setup();
    const base = {
      phase: "ROUND_RESULT",
      target: TARGET,
      guessResult: { lat: 30, lng: 130, distance: 1000 },
    };
    rerender({ state: { ...base, aiGuess: null } });
    const firstDraw = [...fake.markers];
    expect(onMap(fake.markers).map(pinColor)).toEqual([GREEN, RED]);

    rerender({ state: { ...base, aiGuess: { lat: 40, lng: 120 } } });
    expect(firstDraw.every((marker) => marker.map === null)).toBe(true);
    expect(onMap(fake.markers).map(pinColor)).toEqual([GREEN, RED, PURPLE]);
    expect(onMap(fake.polylines)).toHaveLength(2);
  });

  it("cleanupMarkers clears every overlay and recenters the map", async () => {
    const { result, rerender } = await setup();
    rerender({
      state: {
        phase: "ROUND_RESULT",
        target: TARGET,
        guessResult: { lat: 30, lng: 130, distance: 1000 },
        aiGuess: { lat: 40, lng: 120 },
      },
    });

    act(() => result.current.cleanupMarkers());
    expect(onMap(fake.markers)).toHaveLength(0);
    expect(onMap(fake.polylines)).toHaveLength(0);
    expect(fake.maps[0].setCenter).toHaveBeenLastCalledWith({
      lat: 20,
      lng: 0,
    });
    expect(fake.maps[0].setZoom).toHaveBeenLastCalledWith(2);

    // The next round starts with a fresh pending pin.
    rerender({ state: { phase: "PLAYING", guessPin: null } });
    act(() => fake.maps[0].click(1, 2));
    expect(onMap(fake.markers).map(pinColor)).toEqual([RED]);
  });

  it("drops the map on the welcome screen and recreates it for a new game", async () => {
    const { result, rerender } = await setup();
    act(() => fake.maps[0].click(1, 2));

    rerender({ state: { phase: "WELCOME" } });
    expect(onMap(fake.markers)).toHaveLength(0);

    result.current.guessMapElRef.current = document.createElement("div");
    rerender({ state: { phase: "PLAYING", guessPin: null } });
    expect(fake.maps).toHaveLength(2);
  });
});
