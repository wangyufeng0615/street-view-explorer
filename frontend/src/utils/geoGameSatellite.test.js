import { describe, it, expect, afterEach } from "vitest";
import {
  STATIC_MAP_MAX_SIDE,
  STATIC_MAP_MIN_SIDE,
  getInitialSatelliteRequestSize,
  getSatelliteRequestSize,
  getSatelliteUrl,
  isSameSatelliteRequestSize,
} from "./geoGameSatellite";

describe("getSatelliteRequestSize", () => {
  it("keeps the long side at the maximum for portrait panels", () => {
    expect(getSatelliteRequestSize(300, 600)).toEqual({
      width: 320,
      height: 640,
    });
  });

  it("requests a square image for square panels", () => {
    expect(getSatelliteRequestSize(500, 500)).toEqual({
      width: 640,
      height: 640,
    });
  });

  it("rounds the short side to whole pixels", () => {
    // 640 / (1000 / 700) = 448; 640 / (1000 / 333) = 213.12
    expect(getSatelliteRequestSize(1000, 700)).toEqual({
      width: 640,
      height: 448,
    });
    expect(getSatelliteRequestSize(1000, 333).height).toBe(213);
  });

  it("clamps very thin panels to the backend minimum side", () => {
    expect(getSatelliteRequestSize(6400, 100)).toEqual({
      width: STATIC_MAP_MAX_SIDE,
      height: STATIC_MAP_MIN_SIDE,
    });
    expect(getSatelliteRequestSize(100, 6400)).toEqual({
      width: STATIC_MAP_MIN_SIDE,
      height: STATIC_MAP_MAX_SIDE,
    });
  });

  it("returns null for unmeasurable panels", () => {
    expect(getSatelliteRequestSize(0, 400)).toBeNull();
    expect(getSatelliteRequestSize(400, 0)).toBeNull();
    expect(getSatelliteRequestSize(-10, 400)).toBeNull();
    expect(getSatelliteRequestSize(Number.NaN, 400)).toBeNull();
    expect(getSatelliteRequestSize(400, Infinity)).toBeNull();
    expect(getSatelliteRequestSize(undefined, undefined)).toBeNull();
  });
});

describe("getInitialSatelliteRequestSize", () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;

  afterEach(() => {
    window.innerWidth = originalWidth;
    window.innerHeight = originalHeight;
  });

  it("estimates the panel from the window minus the guess panel and top bar", () => {
    window.innerWidth = 1380; // 1380 - 380 = 1000
    window.innerHeight = 950; // 950 - 50 = 900
    expect(getInitialSatelliteRequestSize()).toEqual({
      width: 640,
      height: 576,
    });
  });

  it("returns null when the window is narrower than the guess panel", () => {
    window.innerWidth = 300;
    window.innerHeight = 800;
    expect(getInitialSatelliteRequestSize()).toBeNull();
  });
});

describe("isSameSatelliteRequestSize", () => {
  it("treats a missing size as different from a real one", () => {
    expect(isSameSatelliteRequestSize(null, { width: 640, height: 360 })).toBe(
      false,
    );
    expect(isSameSatelliteRequestSize(null, null)).toBe(true);
  });
});

describe("getSatelliteUrl", () => {
  it("builds the same-origin satellite proxy URL with the request size", () => {
    const url = getSatelliteUrl({ lat: 48.8584, lng: 2.2945 }, 14, {
      width: 640,
      height: 360,
    });
    const [path, query] = url.split("?");
    expect(path).toBe("/api/v1/geo/satellite");
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      lat: "48.8584",
      lng: "2.2945",
      zoom: "14",
      width: "640",
      height: "360",
    });
  });

  it("omits width and height when the size is unknown", () => {
    expect(getSatelliteUrl({ lat: -33.9, lng: 151.2 }, 2, null)).toBe(
      "/api/v1/geo/satellite?lat=-33.9&lng=151.2&zoom=2",
    );
  });
});
