import { describe, it, expect } from "vitest";
import {
  RESULT_PIN_OFFSET_PX,
  RESULT_PIN_SPREAD_DISTANCE_KM,
  createGuessPinIcon,
  getResultPinOffsets,
} from "./geoGameMapPins";

const TARGET = { lat: 35.6762, lng: 139.6503 };
// ~11 km north of the target.
const NEAR_POINT = { lat: 35.776, lng: 139.6503 };
// ~110 km north of the target.
const FAR_POINT = { lat: 36.676, lng: 139.6503 };

describe("getResultPinOffsets", () => {
  it("keeps pins centered when nothing lands near the target", () => {
    expect(
      getResultPinOffsets(TARGET, { ...FAR_POINT, distance: 110 }, FAR_POINT),
    ).toEqual({ target: 0, player: 0, atlas: 0 });
    expect(getResultPinOffsets(TARGET, null, null)).toEqual({
      target: 0,
      player: 0,
      atlas: 0,
    });
  });

  it("splits the target and player pins when only the player is close", () => {
    expect(
      getResultPinOffsets(TARGET, { ...NEAR_POINT, distance: 11 }, FAR_POINT),
    ).toEqual({
      target: RESULT_PIN_OFFSET_PX / 2,
      player: -RESULT_PIN_OFFSET_PX / 2,
      atlas: 0,
    });
  });

  it("splits the target and Atlas pins when only Atlas is close", () => {
    expect(
      getResultPinOffsets(TARGET, { ...FAR_POINT, distance: 110 }, NEAR_POINT),
    ).toEqual({
      target: RESULT_PIN_OFFSET_PX / 2,
      player: 0,
      atlas: -RESULT_PIN_OFFSET_PX / 2,
    });
  });

  it("fans player and Atlas to both sides when both are close", () => {
    expect(
      getResultPinOffsets(TARGET, { ...NEAR_POINT, distance: 11 }, NEAR_POINT),
    ).toEqual({
      target: 0,
      player: -RESULT_PIN_OFFSET_PX,
      atlas: RESULT_PIN_OFFSET_PX,
    });
  });

  it("uses the player's scored distance inclusively at the spread threshold", () => {
    const atThreshold = getResultPinOffsets(
      TARGET,
      { ...FAR_POINT, distance: RESULT_PIN_SPREAD_DISTANCE_KM },
      null,
    );
    expect(atThreshold.player).toBe(-RESULT_PIN_OFFSET_PX / 2);

    const justOutside = getResultPinOffsets(
      TARGET,
      { ...NEAR_POINT, distance: RESULT_PIN_SPREAD_DISTANCE_KM + 0.1 },
      null,
    );
    expect(justOutside.player).toBe(0);
  });

  it("ignores a give-up result without coordinates", () => {
    expect(
      getResultPinOffsets(
        TARGET,
        { lat: null, lng: null, distance: null, score: 0 },
        null,
      ),
    ).toEqual({ target: 0, player: 0, atlas: 0 });
  });
});

describe("createGuessPinIcon", () => {
  const maps = {
    Size: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
    },
    Point: class {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
    },
  };

  function decodeSvg(icon) {
    return decodeURIComponent(
      icon.url.replace("data:image/svg+xml;charset=UTF-8,", ""),
    );
  }

  it("anchors the pin tip at the bottom center of the icon", () => {
    const icon = createGuessPinIcon(maps, "#ef4444");
    expect(icon.url.startsWith("data:image/svg+xml;charset=UTF-8,")).toBe(true);
    expect(icon.scaledSize).toMatchObject({ width: 74, height: 44 });
    expect(icon.anchor).toMatchObject({ x: 37, y: 42 });
    const svg = decodeSvg(icon);
    expect(svg).toContain('fill="#ef4444"');
    expect(svg).toContain('cx="37"');
  });

  it("shifts only the pin head for spread offsets", () => {
    const icon = createGuessPinIcon(maps, "#8b5cf6", 16);
    expect(icon.anchor).toMatchObject({ x: 37, y: 42 });
    const svg = decodeSvg(icon);
    expect(svg).toContain('cx="53"');
    expect(svg).toMatch(/d="M37 42C/);
  });
});
