import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalMap from "./GlobalMap";
import { loadGoogleMapsScript } from "../utils/googleMaps";

const { stableTranslate } = vi.hoisted(() => ({
  stableTranslate: (key) => key,
}));

vi.mock("../utils/googleMaps", () => ({
  loadGoogleMapsScript: vi.fn(),
  loadMarkerLibrary: vi.fn(async (maps) => maps.marker),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableTranslate }),
}));

describe("GlobalMap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches between the missing-coordinates placeholder and the map without breaking hook order", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Keep the map loading so the test only exercises render/hook order.
    vi.mocked(loadGoogleMapsScript).mockReturnValue(new Promise(() => {}));

    const { container, rerender } = render(<GlobalMap />);
    expect(screen.getByText("loading_location")).toBeTruthy();

    rerender(<GlobalMap latitude={48.8566} longitude={2.3522} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("loading_location")).toBeNull();
    expect(container.firstChild).toBeTruthy();
    expect(loadGoogleMapsScript).toHaveBeenCalled();

    rerender(<GlobalMap />);
    expect(screen.getByText("loading_location")).toBeTruthy();
  });

  it("creates the map once and only recenters it when the location changes", async () => {
    const maps = {
      Map: vi.fn(function Map() {
        this.setCenter = vi.fn();
        this.addListener = vi.fn(() => ({ remove: vi.fn() }));
      }),
      marker: {
        AdvancedMarkerElement: vi.fn(function Marker(options) {
          this.position = options.position;
          this.map = options.map;
        }),
      },
      event: { trigger: vi.fn() },
      ControlPosition: { RIGHT_TOP: "right-top" },
    };
    vi.mocked(loadGoogleMapsScript).mockResolvedValue(maps);
    const flush = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

    const { rerender } = render(<GlobalMap latitude={10} longitude={20} />);
    await flush();
    expect(maps.Map).toHaveBeenCalledTimes(1);

    rerender(<GlobalMap latitude={30} longitude={40} />);
    await flush();

    expect(maps.Map).toHaveBeenCalledTimes(1);
    const map = maps.Map.mock.instances[0];
    expect(map.setCenter).toHaveBeenLastCalledWith({ lat: 30, lng: 40 });
    const marker = maps.marker.AdvancedMarkerElement.mock.instances[0];
    expect(marker.position).toEqual({ lat: 30, lng: 40 });
  });
});
