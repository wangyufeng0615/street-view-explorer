import { describe, expect, it } from "vitest";
import {
  headingFromDirection,
  nearbyBearing,
  destinationPoint,
  clampNumber,
} from "./atlasVoiceNavigation";

describe("voice navigation", () => {
  it("distinguishes absolute bearings from relative turns and wraps headings", () => {
    expect(headingFromDirection("north-east", 300)).toBe(45);
    expect(headingFromDirection("right", 350)).toBe(80);
    expect(headingFromDirection("left", 10)).toBe(280);
    expect(headingFromDirection("unknown", 90)).toBeNull();
    expect(nearbyBearing("back", 270)).toBe(90);
  });
  it("walks across the date line with valid wrapped longitude", () => {
    const next = destinationPoint(0, 179.999, 90, 500);
    expect(next.lat).toBeCloseTo(0);
    expect(next.lng).toBeGreaterThan(-180);
    expect(next.lng).toBeLessThan(-179.99);
    expect(destinationPoint(10, 20, 90, 0)).toEqual({ lat: 10, lng: 20 });
  });
  it("bounds tool inputs and uses a fallback for invalid numbers", () => {
    expect(clampNumber("5000", 120, 450, 200)).toBe(450);
    expect(clampNumber("bad", 120, 450, 200)).toBe(200);
  });
});
