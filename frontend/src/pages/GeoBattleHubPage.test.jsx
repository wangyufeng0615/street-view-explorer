import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
  joinGeoBattleRoom,
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

describe("GeoBattleHubPage errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getGeoBattleMatchmakingStatus).mockResolvedValue({
      success: true,
      data: { status: "idle" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a translated alert instead of the raw backend error", async () => {
    vi.mocked(joinGeoBattleRoom).mockResolvedValue({
      success: false,
      status: 404,
      error: "geo battle room not found",
    });
    render(<GeoBattleHubPage />);
    await act(async () => {});

    fireEvent.change(
      screen.getByPlaceholderText("geo_online.room_code_placeholder"),
      { target: { value: "abc234" } },
    );
    await act(async () => {
      fireEvent.click(screen.getByText("geo_online.join_room"));
    });

    expect(joinGeoBattleRoom).toHaveBeenCalledWith(
      "ABC234",
      expect.any(String),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "geo_online.error_room_not_found",
    );
    expect(
      screen.queryByText("geo battle room not found"),
    ).not.toBeInTheDocument();
  });
});
