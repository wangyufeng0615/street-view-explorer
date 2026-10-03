import { describe, expect, it, vi } from "vitest";
import {
  OFFICIAL_PANO_SEARCH_RADIUS_M,
  isOfficialPanoId,
  resolveOfficialPanoId,
} from "./officialStreetView";

function mapsWith(getPanorama) {
  return {
    StreetViewService: class {
      getPanorama = getPanorama;
    },
    StreetViewSource: { GOOGLE: "google" },
    StreetViewPreference: { NEAREST: "nearest" },
  };
}

describe("official Street View", () => {
  it("tells official panorama IDs from user photospheres", () => {
    expect(isOfficialPanoId("RVHISCP2VhnDsPJUbAybGQ")).toBe(true);
    expect(isOfficialPanoId("CAoSF0NJSE0wb2dLRUlDQWdNQ2d0Zl9GNVFF")).toBe(
      false,
    );
    expect(isOfficialPanoId("CIHM0ogKEICAgICE7NGm_QE")).toBe(false);
    expect(isOfficialPanoId(undefined)).toBe(false);
  });

  it("uses an official ID as is, without a search", async () => {
    const getPanorama = vi.fn();
    const pano = await resolveOfficialPanoId(mapsWith(getPanorama), {
      lat: 1,
      lng: 2,
      panoId: "RVHISCP2VhnDsPJUbAybGQ",
    });
    expect(pano).toBe("RVHISCP2VhnDsPJUbAybGQ");
    expect(getPanorama).not.toHaveBeenCalled();
  });

  it("finds the nearest official panorama for a photosphere", async () => {
    const getPanorama = vi
      .fn()
      .mockResolvedValue({ data: { location: { pano: "official-near" } } });
    const pano = await resolveOfficialPanoId(mapsWith(getPanorama), {
      lat: 1,
      lng: 2,
      panoId: "CAoSF0NJSE0wb2dLRUlDQWdNQ2d0Zl9GNVFF",
    });
    expect(pano).toBe("official-near");
    expect(getPanorama).toHaveBeenCalledWith({
      location: { lat: 1, lng: 2 },
      radius: OFFICIAL_PANO_SEARCH_RADIUS_M,
      sources: ["google"],
      preference: "nearest",
    });
  });

  it("returns null when no official imagery is nearby and rethrows network errors", async () => {
    const zero = Object.assign(new Error("none"), { code: "ZERO_RESULTS" });
    await expect(
      resolveOfficialPanoId(mapsWith(vi.fn().mockRejectedValue(zero)), {
        lat: 1,
        lng: 2,
      }),
    ).resolves.toBeNull();

    const offline = Object.assign(new Error("offline"), {
      code: "UNKNOWN_ERROR",
    });
    await expect(
      resolveOfficialPanoId(mapsWith(vi.fn().mockRejectedValue(offline)), {
        lat: 1,
        lng: 2,
      }),
    ).rejects.toBe(offline);
  });
});
