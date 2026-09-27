import { describe, expect, it, vi } from "vitest";
import {
  BATTLE_MARKERS,
  createBattleMarker,
  createBattleResultOverlays,
} from "./geoBattleMarkers";

const t = (key) => key;

function makeMaps() {
  const created = [];
  const maps = {
    SymbolPath: { CIRCLE: "circle" },
    Marker: vi.fn(function Marker(options) {
      this.options = options;
      created.push({ kind: "marker", type: options.label.text });
    }),
    Polyline: vi.fn(function Polyline(options) {
      this.options = options;
      created.push({ kind: "line", color: options.strokeColor });
    }),
    LatLngBounds: vi.fn(function LatLngBounds() {
      this.extend = vi.fn();
    }),
  };
  return { maps, created };
}

describe("battle markers", () => {
  it("keeps the red/blue/green identity colors and stacks you above the opponent", () => {
    expect(BATTLE_MARKERS.player.color).toBe("#ef4444");
    expect(BATTLE_MARKERS.opponent.color).toBe("#2563eb");
    expect(BATTLE_MARKERS.target.color).toBe("#10b981");
    expect(BATTLE_MARKERS.player.zIndex).toBeGreaterThan(
      BATTLE_MARKERS.opponent.zIndex,
    );
  });

  it("creates a non-clickable marker styled by type, defaulting to player", () => {
    const { maps } = makeMaps();
    const map = {};
    const marker = createBattleMarker(
      maps,
      map,
      { lat: 1, lng: 2 },
      "opponent",
      t,
    );
    expect(marker.options).toMatchObject({
      position: { lat: 1, lng: 2 },
      map,
      clickable: false,
      zIndex: BATTLE_MARKERS.opponent.zIndex,
      icon: { path: "circle", fillColor: BATTLE_MARKERS.opponent.color },
      label: { text: "geo_online.pin_opponent_short" },
    });

    const fallback = createBattleMarker(maps, map, { lat: 0, lng: 0 }, "?", t);
    expect(fallback.options.icon.fillColor).toBe(BATTLE_MARKERS.player.color);
  });
});

describe("battle result overlays", () => {
  it("only draws the target when nobody placed a guess, and accepts 0 coordinates", () => {
    const { maps } = makeMaps();
    const onlyTarget = createBattleResultOverlays(
      maps,
      {},
      {
        target: { lat: 0, lng: 0 },
        my_guess: { score: 0 },
        opponent_guess: null,
      },
      t,
    );
    expect(onlyTarget.markers).toHaveLength(1);
    expect(onlyTarget.lines).toHaveLength(0);

    const zeroGuess = createBattleResultOverlays(
      maps,
      {},
      { target: { lat: 5, lng: 5 }, my_guess: { lat: 0, lng: 0 } },
      t,
    );
    expect(zeroGuess.markers).toHaveLength(2);
    expect(zeroGuess.lines).toHaveLength(1);
  });
});
