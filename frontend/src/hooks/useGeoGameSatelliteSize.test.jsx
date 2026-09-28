import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import {
  SATELLITE_RESIZE_DEBOUNCE_MS,
  useGeoGameSatelliteSize,
} from "./useGeoGameSatelliteSize";
import { getInitialSatelliteRequestSize } from "../utils/geoGameSatellite";

let panelRect = { width: 0, height: 0 };
let latest;

function SatellitePanel({ phase }) {
  const { satelliteElRef, satelliteImageSize } = useGeoGameSatelliteSize(phase);
  latest = satelliteImageSize;
  return (
    <div
      ref={(el) => {
        satelliteElRef.current = el;
        if (el) el.getBoundingClientRect = () => panelRect;
      }}
    />
  );
}

describe("useGeoGameSatelliteSize", () => {
  const originalResizeObserver = global.ResizeObserver;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    vi.useRealTimers();
  });

  function settle() {
    act(() => {
      vi.advanceTimersByTime(SATELLITE_RESIZE_DEBOUNCE_MS);
    });
  }

  it("starts from the window estimate and measures once the game starts", () => {
    delete global.ResizeObserver;
    panelRect = { width: 1000, height: 500 };
    const { rerender } = render(<SatellitePanel phase="WELCOME" />);
    // WELCOME has no satellite panel yet: keep the window-based estimate.
    expect(latest).toEqual(getInitialSatelliteRequestSize());
    expect(latest).not.toEqual({ width: 640, height: 320 });

    rerender(<SatellitePanel phase="LOADING" />);
    expect(latest).toEqual({ width: 640, height: 320 });
  });

  it("follows window resizes without ResizeObserver and keeps equal sizes stable", () => {
    delete global.ResizeObserver;
    panelRect = { width: 1000, height: 500 };
    render(<SatellitePanel phase="PLAYING" />);
    const measured = latest;
    expect(measured).toEqual({ width: 640, height: 320 });

    panelRect = { width: 2000, height: 1000 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    settle();
    expect(latest).toBe(measured);

    panelRect = { width: 500, height: 1000 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    settle();
    expect(latest).toEqual({ width: 320, height: 640 });

    panelRect = { width: 0, height: 0 };
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    settle();
    expect(latest).toEqual({ width: 320, height: 640 });
  });

  it("observes the panel with ResizeObserver when available", () => {
    const observers = [];
    global.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }
      observe(el) {
        this.el = el;
      }
      disconnect() {
        this.disconnected = true;
      }
    };
    panelRect = { width: 1000, height: 500 };
    const { unmount } = render(<SatellitePanel phase="PLAYING" />);
    expect(observers).toHaveLength(1);

    panelRect = { width: 900, height: 900 };
    act(() => observers[0].callback());
    settle();
    expect(latest).toEqual({ width: 640, height: 640 });

    unmount();
    expect(observers[0].disconnected).toBe(true);
  });

  it("debounces a burst of resizes into one size change", () => {
    const observers = [];
    global.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
    };
    panelRect = { width: 1000, height: 500 };
    render(<SatellitePanel phase="PLAYING" />);
    const measured = latest;

    for (let width = 1000; width > 700; width -= 30) {
      panelRect = { width, height: 700 };
      act(() => observers[0].callback());
      act(() => {
        vi.advanceTimersByTime(SATELLITE_RESIZE_DEBOUNCE_MS - 50);
      });
      expect(latest).toBe(measured);
    }

    panelRect = { width: 700, height: 700 };
    act(() => observers[0].callback());
    settle();
    expect(latest).toEqual({ width: 640, height: 640 });
  });
});
