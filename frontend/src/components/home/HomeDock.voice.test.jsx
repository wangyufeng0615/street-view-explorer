import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/useExplorationMode", () => ({
  EXPLORATION_MODES: { RANDOM: "random", CUSTOM: "custom" },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

async function renderDock() {
  const { default: HomeDock } = await import("./HomeDock");
  render(
    <HomeDock
      isBusy={false}
      explorationMode="random"
      explorationInterest=""
      isSavingPreference={false}
      preferenceError={null}
      stops={[]}
      currentPanoId={null}
      onNext={vi.fn()}
      onPickRandom={vi.fn()}
      onPickInterest={vi.fn()}
      onRevisit={vi.fn()}
    />,
  );
}

function expectDockStillUsable() {
  expect(
    screen.getByRole("button", { name: "home.voice.start" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "home.next" })).toBeEnabled();
}

describe("HomeDock voice loading", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.doUnmock("../AtlasVoicePanel");
    vi.restoreAllMocks();
  });

  it("keeps the placeholder when the voice chunk fails to load", async () => {
    vi.doMock("../AtlasVoicePanel", () => {
      throw new Error("chunk failed");
    });
    await renderDock();

    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        "Atlas Voice chunk failed to load:",
        expect.anything(),
      ),
    );
    expectDockStillUsable();
  });

  it("falls back to the placeholder when the voice panel crashes", async () => {
    vi.doMock("../AtlasVoicePanel", () => ({
      default: () => {
        throw new Error("voice panel crashed");
      },
    }));
    await renderDock();

    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        "Atlas Voice failed to load:",
        expect.any(Error),
      ),
    );
    expectDockStillUsable();
  });
});
