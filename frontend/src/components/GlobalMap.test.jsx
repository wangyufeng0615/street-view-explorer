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
});
