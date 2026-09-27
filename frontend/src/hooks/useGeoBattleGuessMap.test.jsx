import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";

vi.mock("../utils/googleMaps", () => ({
  loadGoogleMapsScript: vi.fn(),
}));

import { loadGoogleMapsScript } from "../utils/googleMaps";
import {
  WORLD_CENTER,
  useGeoBattleGuessMap,
  useGeoBattleGuessMapHandles,
} from "./useGeoBattleGuessMap";

const RED = "#ef4444";
const BLUE = "#2563eb";
const GREEN = "#10b981";
const TARGET = { lat: -33.86, lng: 151.21 };

function createFakeMaps() {
  const fake = { maps: [], markers: [], polylines: [], idle: [] };

  class FakeMap {
    constructor(el, options) {
      this.options = options;
      this.listeners = {};
      this.setCenter = vi.fn();
      this.setZoom = vi.fn();
      this.fitBounds = vi.fn();
      fake.maps.push(this);
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

  fake.api = {
    Map: FakeMap,
    Marker: class extends FakeOverlay {
      constructor(options) {
        super(options);
        fake.markers.push(this);
      }
    },
    Polyline: class extends FakeOverlay {
      constructor(options) {
        super(options);
        fake.polylines.push(this);
      }
    },
    LatLngBounds: class {
      constructor() {
        this.points = [];
      }
      extend(point) {
        this.points.push(point);
      }
    },
    SymbolPath: { CIRCLE: "circle" },
    event: {
      trigger: vi.fn(),
      clearInstanceListeners: vi.fn(),
      addListenerOnce: (map, name, handler) => fake.idle.push(handler),
    },
  };
  return fake;
}

function roomAt(phase, round = {}, overrides = {}) {
  return {
    room_id: "room-1",
    phase,
    can_submit_guess: phase === "playing",
    round: { index: 1, ...round },
    ...overrides,
  };
}

const onMap = (overlays) => overlays.filter((overlay) => overlay.map);
const markerColors = (markers) =>
  onMap(markers).map((marker) => marker.options.icon.fillColor);

describe("useGeoBattleGuessMap", () => {
  let fake;

  beforeEach(() => {
    vi.useFakeTimers();
    fake = createFakeMaps();
    vi.mocked(loadGoogleMapsScript).mockReset().mockResolvedValue(fake.api);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(initialRoom = roomAt("playing")) {
    const feedback = {
      playFeedback: vi.fn(),
      showFeedbackBubble: vi.fn(),
      t: (key) => key,
    };
    const mapEl = document.createElement("div");
    const hook = renderHook(
      ({ room }) => {
        const handles = useGeoBattleGuessMapHandles();
        handles.guessMapElRef.current = mapEl;
        const roomRef = useRef(room);
        roomRef.current = room;
        const feedbackRef = useRef(feedback);
        const [guessPin, setGuessPin] = useState(null);
        const map = useGeoBattleGuessMap({
          handles,
          room,
          roomRef,
          guessPin,
          setGuessPin,
          feedbackRef,
          t: feedback.t,
        });
        return { ...map, handles, guessPin };
      },
      { initialProps: { room: initialRoom } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return { ...hook, feedback };
  }

  it("creates the map once per room and marks it ready on idle", async () => {
    const { result, rerender } = await setup();
    expect(result.current.mapsReady).toBe(true);
    expect(fake.maps).toHaveLength(1);
    expect(fake.maps[0].options).toMatchObject({
      center: WORLD_CENTER,
      zoom: 2,
    });
    expect(result.current.mapReady).toBe(false);

    act(() => fake.idle[0]());
    expect(result.current.mapReady).toBe(true);

    rerender({ room: { ...roomAt("playing"), server_time: "later" } });
    rerender({ room: roomAt("reveal", { target: TARGET }) });
    expect(fake.maps).toHaveLength(1);
  });

  it("falls back to ready after 1.8s without an idle event", async () => {
    const { result } = await setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1799);
    });
    expect(result.current.mapReady).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.mapReady).toBe(true);
  });

  it("reports a Maps load failure", async () => {
    vi.mocked(loadGoogleMapsScript).mockRejectedValueOnce(new Error("blocked"));
    const { result } = await setup();
    expect(result.current.mapsError).toBe(true);
    expect(fake.maps).toHaveLength(0);
  });

  it("places a red pending pin on click, then moves it", async () => {
    const { result, feedback } = await setup();
    const map = fake.maps[0];

    act(() => map.click(10, 20));
    expect(result.current.guessPin).toEqual({ lat: 10, lng: 20 });
    expect(feedback.playFeedback).toHaveBeenCalledWith("place");
    expect(feedback.showFeedbackBubble).toHaveBeenLastCalledWith(
      "geo_online.feedback_pin_placed",
      "player",
    );
    expect(markerColors(fake.markers)).toEqual([RED]);
    expect(fake.markers[0].options.label.text).toBe("geo_online.pin_you_short");

    act(() => map.click(-5, 7));
    expect(fake.markers).toHaveLength(1);
    expect(fake.markers[0].position).toEqual({ lat: -5, lng: 7 });
    expect(feedback.showFeedbackBubble).toHaveBeenLastCalledWith(
      "geo_online.feedback_pin_moved",
      "player",
    );
  });

  it.each([
    [
      "after locking a guess",
      roomAt("playing", {}, { can_submit_guess: false }),
    ],
    ["during countdown", roomAt("countdown")],
    ["during reveal", roomAt("reveal")],
  ])("ignores clicks %s", async (_label, room) => {
    const { result, rerender } = await setup();
    rerender({ room });
    act(() => fake.maps[0].click(10, 20));
    expect(result.current.guessPin).toBeNull();
    expect(fake.markers).toHaveLength(0);
  });

  it("draws the reveal: green target, red you, blue opponent", async () => {
    const { rerender } = await setup();
    const map = fake.maps[0];
    act(() => map.click(-30, 150));
    const pending = fake.markers[0];

    rerender({
      room: roomAt("reveal", {
        target: TARGET,
        my_guess: { lat: -30, lng: 150 },
        opponent_guess: { lat: -37.8, lng: 144.9 },
      }),
    });

    expect(pending.map).toBeNull();
    expect(markerColors(fake.markers)).toEqual([GREEN, RED, BLUE]);
    const lines = onMap(fake.polylines);
    expect(lines.map((line) => line.options.strokeColor)).toEqual([RED, BLUE]);
    expect(lines[1].options.path).toEqual([{ lat: -37.8, lng: 144.9 }, TARGET]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(280);
    });
    expect(map.fitBounds.mock.calls.at(-1)[0].points).toHaveLength(3);
  });

  it("keeps the reveal map untouched when polling returns the same result", async () => {
    const { rerender } = await setup();
    const map = fake.maps[0];
    const round = {
      target: TARGET,
      my_guess: { lat: -30, lng: 150 },
      opponent_guess: { lat: -37.8, lng: 144.9 },
    };
    rerender({
      room: roomAt("reveal", round, { server_time: "2026-09-27T00:00:01Z" }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const markersBefore = [...fake.markers];
    const fitsBefore = map.fitBounds.mock.calls.length;

    // A poll produces a new room object with the same reveal content.
    rerender({
      room: roomAt(
        "reveal",
        { ...round },
        { server_time: "2026-09-27T00:00:03Z" },
      ),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fake.markers).toEqual(markersBefore);
    expect(onMap(fake.markers)).toHaveLength(3);
    expect(map.fitBounds.mock.calls.length).toBe(fitsBefore);
  });

  it("skips pins for players who did not guess", async () => {
    const { rerender } = await setup();
    rerender({
      room: roomAt("finished", {
        target: TARGET,
        my_guess: null,
        opponent_guess: { lat: null, lng: null },
      }),
    });
    expect(markerColors(fake.markers)).toEqual([GREEN]);
    expect(onMap(fake.polylines)).toHaveLength(0);
  });

  it("clears the reveal and resets the viewport for the next round", async () => {
    const { result, rerender } = await setup();
    const map = fake.maps[0];
    rerender({
      room: roomAt("reveal", {
        target: TARGET,
        my_guess: { lat: -30, lng: 150 },
        opponent_guess: { lat: -37.8, lng: 144.9 },
      }),
    });
    map.setCenter.mockClear();
    map.setZoom.mockClear();

    rerender({ room: roomAt("countdown", { index: 2 }) });
    expect(onMap(fake.markers)).toHaveLength(0);
    expect(onMap(fake.polylines)).toHaveLength(0);
    expect(result.current.guessPin).toBeNull();
    expect(map.setCenter).toHaveBeenCalledWith(WORLD_CENTER);
    expect(map.setZoom).toHaveBeenCalledWith(2);
  });

  it("drops the pending pin when the round index changes mid-play", async () => {
    const { result, rerender } = await setup();
    act(() => fake.maps[0].click(10, 20));
    expect(onMap(fake.markers)).toHaveLength(1);

    rerender({ room: roomAt("playing", { index: 2 }) });
    expect(result.current.guessPin).toBeNull();
    expect(onMap(fake.markers)).toHaveLength(0);
  });

  it("clearResultOverlays / resetMapViewport handles work imperatively", async () => {
    const { result, rerender } = await setup();
    rerender({
      room: roomAt("reveal", {
        target: TARGET,
        my_guess: { lat: -30, lng: 150 },
      }),
    });
    expect(onMap(fake.markers)).toHaveLength(2);

    act(() => {
      result.current.handles.clearResultOverlays();
      result.current.handles.resetMapViewport();
    });
    expect(onMap(fake.markers)).toHaveLength(0);
    expect(onMap(fake.polylines)).toHaveLength(0);
    expect(fake.maps[0].setCenter).toHaveBeenLastCalledWith(WORLD_CENTER);
  });

  it("releases the map listeners on unmount", async () => {
    const { unmount } = await setup();
    const map = fake.maps[0];
    unmount();
    expect(fake.api.event.clearInstanceListeners).toHaveBeenCalledWith(map);
  });
});
