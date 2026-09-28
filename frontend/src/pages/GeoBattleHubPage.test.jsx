import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import React from "react";

const navigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("../services/api", () => ({
  cancelGeoBattleMatchmaking: vi.fn(() => Promise.resolve({ success: true })),
  createGeoBattleRoom: vi.fn(),
  getGeoBattleMatchmakingStatus: vi.fn(),
  joinGeoBattleMatchmaking: vi.fn(),
  joinGeoBattleRoom: vi.fn(),
}));

import {
  cancelGeoBattleMatchmaking,
  getGeoBattleMatchmakingStatus,
} from "../services/api";
import { GeoBattleHubPage } from "./GeoBattleHubPage";

async function renderQueuedHub() {
  vi.mocked(getGeoBattleMatchmakingStatus).mockResolvedValue({
    success: true,
    data: { status: "queued" },
  });
  const view = render(<GeoBattleHubPage />);
  await act(async () => {});
  expect(screen.getByText("geo_online.matchmaking_wait")).toBeTruthy();
  return view;
}

describe("GeoBattleHubPage matchmaking cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves the queue when the hub unmounts while queued", async () => {
    const { unmount } = await renderQueuedHub();
    unmount();
    expect(cancelGeoBattleMatchmaking).toHaveBeenCalledTimes(1);
  });

  it("does not cancel when leaving the hub for a matched room", async () => {
    const { unmount } = await renderQueuedHub();
    vi.mocked(getGeoBattleMatchmakingStatus).mockResolvedValue({
      success: true,
      data: { status: "matched", room: { room_id: "room-9" } },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });
    expect(navigate).toHaveBeenCalledWith("/guess/online/room-9", {
      replace: true,
    });
    unmount();
    expect(cancelGeoBattleMatchmaking).not.toHaveBeenCalled();
  });

  it("sends a keepalive cancel when the page is hidden for unload", async () => {
    const { unmount } = await renderQueuedHub();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(cancelGeoBattleMatchmaking).toHaveBeenCalledWith({
      keepalive: true,
    });
    unmount();
  });

  it("does not cancel anything when the player never queued", async () => {
    vi.mocked(getGeoBattleMatchmakingStatus).mockResolvedValue({
      success: true,
      data: { status: "idle" },
    });
    const { unmount } = render(<GeoBattleHubPage />);
    await act(async () => {});
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    unmount();
    expect(cancelGeoBattleMatchmaking).not.toHaveBeenCalled();
  });
});
