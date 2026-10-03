import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomeDock from "./HomeDock";

vi.mock("../AtlasVoicePanel", () => ({ default: () => null }));
vi.mock("../../hooks/useExplorationMode", () => ({
  EXPLORATION_MODES: { RANDOM: "random", CUSTOM: "custom" },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

function renderDock(props = {}) {
  const handlers = {
    onNext: vi.fn(),
    onPickRandom: vi.fn(),
    onPickInterest: vi.fn(),
    onRevisit: vi.fn(),
  };
  render(
    <HomeDock
      isBusy={false}
      explorationMode="random"
      explorationInterest=""
      isSavingPreference={false}
      preferenceError={null}
      stops={[]}
      currentPanoId={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("HomeDock", () => {
  it("submits a trimmed interest and closes on Escape", () => {
    const { onPickInterest } = renderDock();
    fireEvent.click(screen.getByRole("button", { name: /home\.where\.title/ }));

    const input = screen.getByRole("textbox");
    const go = screen.getByRole("button", { name: "home.where.go" });
    fireEvent.change(input, { target: { value: "   " } });
    expect(go).toBeDisabled();

    fireEvent.change(input, { target: { value: "  volcanoes " } });
    fireEvent.submit(input.closest("form"));
    expect(onPickInterest).toHaveBeenCalledWith("volcanoes");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("revisits an earlier stop but not the current one", () => {
    const stops = [
      { panoId: "a", lat: 1, lng: 2, label: "First" },
      { panoId: "b", lat: 3, lng: 4, label: "Second" },
    ];
    const { onRevisit } = renderDock({ stops, currentPanoId: "b" });
    fireEvent.click(
      screen.getByRole("button", { name: /home\.journey\.title/ }),
    );

    expect(screen.getByRole("button", { name: /Second/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /First/ }));
    expect(onRevisit).toHaveBeenCalledWith(stops[0]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables the next stop button while busy", () => {
    const { onNext } = renderDock({ isBusy: true });
    const next = screen.getByRole("button", { name: /home\.departing/ });
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(onNext).not.toHaveBeenCalled();
  });
});
