import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  SATELLITE_ZOOM_TRANSITION_MS,
  useGeoGameSatelliteZoom,
} from "./useGeoGameSatelliteZoom";
import { MIN_ZOOM, START_ZOOM } from "../utils/geoGameUtils";

const TARGET = { lat: 10, lng: 20 };
const SIZE = { width: 640, height: 360 };

function playingState(overrides = {}) {
  return {
    phase: "PLAYING",
    target: TARGET,
    currentZoom: START_ZOOM,
    zoomSteps: 0,
    ...overrides,
  };
}

describe("useGeoGameSatelliteZoom", () => {
  let images;
  let OriginalImage;
  let originalMatchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    images = [];
    OriginalImage = global.Image;
    originalMatchMedia = window.matchMedia;
    window.matchMedia = undefined;
    global.Image = class {
      constructor() {
        images.push(this);
      }
      set src(value) {
        this.srcValue = value;
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    global.Image = OriginalImage;
    window.matchMedia = originalMatchMedia;
  });

  function setup(initialState = playingState()) {
    const dispatch = vi.fn();
    const playFeedback = vi.fn();
    const showFeedbackBubble = vi.fn();
    const stateRef = { current: initialState };
    const hook = renderHook(
      ({ state }) => {
        stateRef.current = state;
        return useGeoGameSatelliteZoom({
          state,
          stateRef,
          dispatch,
          satelliteImageSize: SIZE,
          playFeedback,
          showFeedbackBubble,
          t: (key) => key,
        });
      },
      { initialProps: { state: initialState } },
    );
    return { ...hook, dispatch, playFeedback, showFeedbackBubble };
  }

  it("preloads the next zoom level while playing", () => {
    setup();
    expect(images.map((img) => img.srcValue)).toEqual([
      `/api/v1/geo/satellite?lat=10&lng=20&zoom=${START_ZOOM - 1}&width=640&height=360`,
    ]);
  });

  it("only allows zooming out after the current image has loaded", () => {
    const { result } = setup();
    expect(result.current.canZoomOut).toBe(false);
    act(() => result.current.handleSatelliteImageLoad());
    expect(result.current.imgLoaded).toBe(true);
    expect(result.current.canZoomOut).toBe(true);
  });

  it("waits for the new image again when the request size changes", () => {
    const state = playingState();
    const stateRef = { current: state };
    const { result, rerender } = renderHook(
      ({ size }) =>
        useGeoGameSatelliteZoom({
          state,
          stateRef,
          dispatch: vi.fn(),
          satelliteImageSize: size,
          playFeedback: vi.fn(),
          showFeedbackBubble: vi.fn(),
          t: (key) => key,
        }),
      { initialProps: { size: SIZE } },
    );
    act(() => result.current.handleSatelliteImageLoad());
    expect(result.current.canZoomOut).toBe(true);
    const firstUrl = result.current.satelliteUrl;

    rerender({ size: { width: 640, height: 480 } });
    expect(result.current.satelliteUrl).not.toBe(firstUrl);
    expect(result.current.imgLoaded).toBe(false);
    expect(result.current.canZoomOut).toBe(false);

    act(() => result.current.handleSatelliteImageLoad());
    expect(result.current.canZoomOut).toBe(true);
  });

  it("loads the next image before zooming out, then hands off", () => {
    const { result, rerender, dispatch, playFeedback } = setup();
    act(() => result.current.handleSatelliteImageLoad());
    images = [];

    act(() => result.current.handleZoomOut());
    expect(result.current.zoomTransitionLoading).toBe(true);
    expect(result.current.canZoomOut).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    const [pending] = images;
    expect(pending.srcValue).toContain(`zoom=${START_ZOOM - 1}`);

    act(() => pending.onload());
    expect(dispatch).toHaveBeenCalledWith({ type: "ZOOM_OUT" });
    expect(playFeedback).toHaveBeenCalledWith("zoom");
    expect(result.current.zoomTransition).toMatchObject({
      toUrl: pending.srcValue,
      animationDone: false,
    });

    // The reducer applies the zoom; the new main image starts loading.
    rerender({
      state: playingState({ currentZoom: START_ZOOM - 1, zoomSteps: 1 }),
    });
    expect(result.current.imgLoaded).toBe(false);
    expect(result.current.zoomTransition).not.toBeNull();

    act(() => vi.advanceTimersByTime(SATELLITE_ZOOM_TRANSITION_MS));
    expect(result.current.zoomTransition.animationDone).toBe(true);

    act(() => result.current.handleSatelliteImageLoad());
    expect(result.current.zoomTransition).toBeNull();
  });

  it("ignores a pending zoom image once the phase leaves PLAYING", () => {
    const { result, rerender, dispatch } = setup();
    act(() => result.current.handleSatelliteImageLoad());
    images = [];
    act(() => result.current.handleZoomOut());
    const [pending] = images;

    rerender({ state: playingState({ phase: "ROUND_RESULT" }) });
    expect(result.current.zoomTransitionLoading).toBe(false);
    act(() => pending.onload());
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.zoomTransition).toBeNull();
  });

  it("reports a failed zoom image without zooming out", () => {
    const { result, dispatch, showFeedbackBubble } = setup();
    act(() => result.current.handleSatelliteImageLoad());
    images = [];
    act(() => result.current.handleZoomOut());

    act(() => images[0].onerror());
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.imgError).toBe(true);
    expect(result.current.zoomTransitionLoading).toBe(false);
    expect(showFeedbackBubble).toHaveBeenCalledWith(
      "geo.feedback_image_error",
      "danger",
    );
  });

  it("does not zoom out past the minimum zoom", () => {
    const { result } = setup(playingState({ currentZoom: MIN_ZOOM }));
    act(() => result.current.handleSatelliteImageLoad());
    expect(result.current.canZoomOut).toBe(false);
    images = [];
    act(() => result.current.handleZoomOut());
    expect(images).toEqual([]);
  });

  it("skips the handoff animation for reduced motion", () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    const { result, dispatch } = setup();
    act(() => result.current.handleSatelliteImageLoad());
    images = [];
    act(() => result.current.handleZoomOut());
    act(() => images[0].onload());
    expect(dispatch).toHaveBeenCalledWith({ type: "ZOOM_OUT" });
    expect(result.current.zoomTransition).toBeNull();
  });
});
