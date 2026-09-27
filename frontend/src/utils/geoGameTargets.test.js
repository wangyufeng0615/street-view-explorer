import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../services/api", () => ({
  getRandomLocation: vi.fn(),
}));

import { getRandomLocation } from "../services/api";
import {
  RANDOM_TARGET_MAX_ATTEMPTS,
  getCountryCodeFromSearch,
  getDatabaseRoundTarget,
  getGeoLanguage,
  getRandomRoundTarget,
  resolveRoundTarget,
} from "./geoGameTargets";

const ENTRY = {
  name: "Venice",
  nameZh: "威尼斯",
  country: "Italy",
  countryZh: "意大利",
  lat: 45.4375,
  lng: 12.3358,
};

function location(latitude, longitude, extra = {}) {
  return {
    success: true,
    data: {
      latitude,
      longitude,
      formatted_address: `Place ${latitude}`,
      country: "Somewhere",
      ...extra,
    },
  };
}

describe("getCountryCodeFromSearch", () => {
  it("reads the country parameter and normalizes it", () => {
    expect(getCountryCodeFromSearch("?country=jp")).toBe("JP");
    expect(getCountryCodeFromSearch("?country= us ")).toBe("US");
  });

  it("accepts the country_code and countryCode aliases in priority order", () => {
    expect(getCountryCodeFromSearch("?country_code=fr")).toBe("FR");
    expect(getCountryCodeFromSearch("?countryCode=de")).toBe("DE");
    expect(getCountryCodeFromSearch("?countryCode=de&country=it")).toBe("IT");
    expect(getCountryCodeFromSearch("?country_code=fr&countryCode=de")).toBe(
      "FR",
    );
  });

  it("returns an empty code for missing or invalid values", () => {
    expect(getCountryCodeFromSearch("")).toBe("");
    expect(getCountryCodeFromSearch(undefined)).toBe("");
    expect(getCountryCodeFromSearch("?country=usa")).toBe("");
    expect(getCountryCodeFromSearch("?country=1a")).toBe("");
  });
});

describe("getGeoLanguage", () => {
  it("maps any Chinese locale to zh and everything else to en", () => {
    expect(getGeoLanguage({ resolvedLanguage: "zh-CN" })).toBe("zh");
    expect(getGeoLanguage({ language: "zh-TW" })).toBe("zh");
    expect(getGeoLanguage({ resolvedLanguage: "ja", language: "zh" })).toBe(
      "en",
    );
    expect(getGeoLanguage({})).toBe("en");
  });
});

describe("getDatabaseRoundTarget", () => {
  it("jitters coordinates slightly and localizes the label", () => {
    const en = getDatabaseRoundTarget(ENTRY, "en");
    expect(en.address).toBe("Venice, Italy");
    expect(en.country).toBe("Italy");
    expect(Math.abs(en.lat - ENTRY.lat)).toBeLessThanOrEqual(0.002);
    expect(Math.abs(en.lng - ENTRY.lng)).toBeLessThanOrEqual(0.002);

    const zh = getDatabaseRoundTarget(ENTRY, "zh");
    expect(zh.address).toBe("威尼斯, 意大利");
    expect(zh.country).toBe("意大利");
  });
});

describe("getRandomRoundTarget", () => {
  beforeEach(() => {
    getRandomLocation.mockReset();
  });

  it("returns the first non-duplicate location with its pano id", async () => {
    getRandomLocation.mockResolvedValueOnce(
      location(10, 20, { pano_id: "pano-a" }),
    );
    await expect(getRandomRoundTarget("en", "JP", [])).resolves.toEqual({
      lat: 10,
      lng: 20,
      address: "Place 10",
      country: "Somewhere",
      panoId: "pano-a",
    });
    expect(getRandomLocation).toHaveBeenCalledWith("en", "geo_game", "JP");
  });

  it("skips same-pano and too-close locations", async () => {
    const used = [{ lat: 10, lng: 20, panoId: "pano-a" }];
    getRandomLocation
      .mockResolvedValueOnce(location(40, 50, { pano_id: "pano-a" }))
      .mockResolvedValueOnce(location(10.01, 20.01, { pano_id: "pano-b" }))
      .mockResolvedValueOnce(location(30, 40, { panoId: "pano-c" }));

    const target = await getRandomRoundTarget("en", "", used);
    expect(target).toMatchObject({ lat: 30, lng: 40, panoId: "pano-c" });
    expect(getRandomLocation).toHaveBeenCalledTimes(3);
  });

  it("falls back to the first nearby different-pano location after all attempts", async () => {
    const used = [{ lat: 10, lng: 20, panoId: "pano-a" }];
    getRandomLocation
      .mockResolvedValueOnce(location(10, 20, { pano_id: "pano-a" }))
      .mockResolvedValueOnce(location(10.01, 20.01, { pano_id: "near-1" }))
      .mockResolvedValue(location(10.02, 20.02, { pano_id: "near-2" }));

    const target = await getRandomRoundTarget("en", "", used);
    expect(target).toMatchObject({ lat: 10.01, panoId: "near-1" });
    expect(getRandomLocation).toHaveBeenCalledTimes(RANDOM_TARGET_MAX_ATTEMPTS);
  });

  it("never falls back to a location that repeats a used pano", async () => {
    const used = [{ lat: 10, lng: 20, panoId: "pano-a" }];
    getRandomLocation.mockResolvedValue(
      location(10, 20, { pano_id: "pano-a" }),
    );

    await expect(getRandomRoundTarget("en", "", used)).resolves.toBeNull();
    expect(getRandomLocation).toHaveBeenCalledTimes(RANDOM_TARGET_MAX_ATTEMPTS);
  });

  it("gives up after two failed requests", async () => {
    getRandomLocation
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, data: null })
      .mockResolvedValue(location(30, 40));

    await expect(getRandomRoundTarget("en", "", [])).resolves.toBeNull();
    expect(getRandomLocation).toHaveBeenCalledTimes(2);
  });

  it("tolerates one failed request before a good location", async () => {
    getRandomLocation
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce(location(30, 40));

    await expect(getRandomRoundTarget("en", "", [])).resolves.toMatchObject({
      lat: 30,
      lng: 40,
      panoId: "",
    });
  });
});

describe("resolveRoundTarget", () => {
  beforeEach(() => {
    getRandomLocation.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the database entry without calling the API", async () => {
    const target = await resolveRoundTarget(
      { source: "database", entry: ENTRY },
      "en",
      "",
      [],
    );
    expect(target.address).toBe("Venice, Italy");
    expect(getRandomLocation).not.toHaveBeenCalled();
  });

  it("replaces a database entry that is too close to a used target", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter
    getRandomLocation.mockResolvedValueOnce(location(30, 40));

    const target = await resolveRoundTarget(
      { source: "database", entry: ENTRY },
      "zh",
      "IT",
      [{ lat: ENTRY.lat, lng: ENTRY.lng }],
    );
    expect(target).toMatchObject({ lat: 30, lng: 40 });
    expect(getRandomLocation).toHaveBeenCalledWith("zh", "geo_game", "IT");
  });

  it("uses the random API for random and missing plans", async () => {
    getRandomLocation
      .mockResolvedValueOnce(location(1, 2))
      .mockResolvedValueOnce(location(3, 4));

    await expect(
      resolveRoundTarget({ source: "random" }, "en", "", []),
    ).resolves.toMatchObject({ lat: 1, lng: 2 });
    await expect(
      resolveRoundTarget(undefined, "en", "", []),
    ).resolves.toMatchObject({ lat: 3, lng: 4 });
  });
});
