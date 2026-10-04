import { describe, expect, it } from "vitest";
import COVER_PLACES from "../data/coverPlaces";
import {
  coverImageUrl,
  coverPlaceForThisVisit,
  formatCoverCoord,
  markCoverSeen,
  pickCoverPlace,
  shouldShowCover,
} from "./coverGate";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe("shouldShowCover", () => {
  it("shows the cover on a plain first visit", () => {
    expect(shouldShowCover({ search: "", storage: memoryStorage() })).toBe(
      true,
    );
  });

  it("skips the cover for shared coordinate links", () => {
    expect(
      shouldShowCover({
        search: "?lat=14.6&lng=-89.3",
        storage: memoryStorage(),
      }),
    ).toBe(false);
  });

  it("shows the cover only once per tab session", () => {
    const storage = memoryStorage();
    markCoverSeen(storage);
    expect(shouldShowCover({ search: "", storage })).toBe(false);
  });

  it("still shows the cover when session storage throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => markCoverSeen(storage)).not.toThrow();
    expect(shouldShowCover({ search: "", storage })).toBe(true);
  });
});

describe("pickCoverPlace", () => {
  it("covers the whole list, including the last entry", () => {
    expect(pickCoverPlace(() => 0)).toBe(COVER_PLACES[0]);
    expect(pickCoverPlace(() => 0.9999)).toBe(COVER_PLACES.at(-1));
  });

  it("only lists places with names in both languages and valid coordinates", () => {
    expect(COVER_PLACES).toHaveLength(30);
    const ids = new Set();
    COVER_PLACES.forEach((place) => {
      expect(place.zh && place.en).toBeTruthy();
      expect(Math.abs(place.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(place.lng)).toBeLessThanOrEqual(180);
      ids.add(place.id);
    });
    expect(ids.size).toBe(COVER_PLACES.length);
  });
});

describe("coverPlaceForThisVisit", () => {
  it("keeps the same place for the whole page load", () => {
    const first = coverPlaceForThisVisit(() => 0);
    expect(coverPlaceForThisVisit(() => 0.9999)).toBe(first);
  });
});

describe("cover image helpers", () => {
  it("versions image URLs so the year-long cache still picks up new images", () => {
    expect(coverImageUrl("namib")).toMatch(/^\/cover\/namib\.webp\?v=\d+$/);
  });

  it("formats coordinates with hemispheres", () => {
    expect(formatCoverCoord(-24.08, 15.55)).toBe("24.08°S 15.55°E");
    expect(formatCoverCoord(41.15, -112.55)).toBe("41.15°N 112.55°W");
  });
});
