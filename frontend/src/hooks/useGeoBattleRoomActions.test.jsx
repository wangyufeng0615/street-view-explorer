import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../services/api", () => ({
  leaveGeoBattleRoom: vi.fn(),
  setGeoBattleReady: vi.fn(),
  submitGeoBattleGuess: vi.fn(),
  zoomOutGeoBattle: vi.fn(),
}));

import {
  leaveGeoBattleRoom,
  setGeoBattleReady,
  submitGeoBattleGuess,
  zoomOutGeoBattle,
} from "../services/api";
import {
  LOBBY_PATH,
  getLeaveConfirmKey,
  useGeoBattleRoomActions,
} from "./useGeoBattleRoomActions";

const t = (key) => key;
const ROOM = {
  room_id: "room-1",
  room_code: "ABC234",
  phase: "playing",
  me: { is_ready: false },
};
const OK = { success: true, data: { room: ROOM } };
const FAILED = { success: false, error: "nope" };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup({ room = ROOM, guessPin = null, applyResult = true } = {}) {
  const deps = {
    setGuessPin: vi.fn(),
    applyRoomResponse: vi.fn(() => applyResult),
    setActionError: vi.fn(),
    setActionNotice: vi.fn(),
    playFeedback: vi.fn(),
    showFeedbackBubble: vi.fn(),
    navigate: vi.fn(),
  };
  const hook = renderHook(
    (props) => useGeoBattleRoomActions({ ...deps, t, ...props }),
    { initialProps: { room, guessPin } },
  );
  return { ...hook, ...deps };
}

function expectFailureFeedback(deps) {
  expect(deps.playFeedback).toHaveBeenCalledWith("error");
  expect(deps.showFeedbackBubble).toHaveBeenCalledWith(
    "geo_online.feedback_error",
    "danger",
  );
}

describe("useGeoBattleRoomActions", () => {
  beforeEach(() => {
    vi.mocked(leaveGeoBattleRoom).mockReset().mockResolvedValue(OK);
    vi.mocked(setGeoBattleReady).mockReset().mockResolvedValue(OK);
    vi.mocked(submitGeoBattleGuess).mockReset().mockResolvedValue(OK);
    vi.mocked(zoomOutGeoBattle).mockReset().mockResolvedValue(OK);
  });

  it("marks the running action busy and clears it when done", async () => {
    const pending = deferred();
    vi.mocked(zoomOutGeoBattle).mockReturnValueOnce(pending.promise);
    const deps = setup();
    expect(deps.result.current.actionBusy).toBe("");

    let done;
    act(() => {
      done = deps.result.current.handleZoomOut();
    });
    expect(deps.result.current.actionBusy).toBe("zoom");
    expect(deps.setActionError).toHaveBeenCalledWith("");

    await act(async () => {
      pending.resolve(OK);
      await done;
    });
    expect(deps.result.current.actionBusy).toBe("");
  });

  it.each([
    [false, true, "geo_online.feedback_ready"],
    [true, false, "geo_online.feedback_unready"],
  ])(
    "toggles ready (is_ready=%s -> %s)",
    async (isReady, nextReady, message) => {
      const room = { ...ROOM, phase: "lobby", me: { is_ready: isReady } };
      const deps = setup({ room });
      await act(() => deps.result.current.handleReadyToggle());

      expect(setGeoBattleReady).toHaveBeenCalledWith("room-1", nextReady);
      expect(deps.applyRoomResponse).toHaveBeenCalledWith(OK);
      expect(deps.playFeedback).toHaveBeenCalledWith("ready");
      expect(deps.showFeedbackBubble).toHaveBeenCalledWith(message, "success");
    },
  );

  it("zooms out and plays zoom feedback", async () => {
    const deps = setup();
    await act(() => deps.result.current.handleZoomOut());
    expect(zoomOutGeoBattle).toHaveBeenCalledWith("room-1");
    expect(deps.playFeedback).toHaveBeenCalledWith("zoom");
    expect(deps.showFeedbackBubble).toHaveBeenCalledWith(
      "geo_online.feedback_zoom_out",
      "zoom",
    );
  });

  it("submits only the pin coordinates and clears the pin", async () => {
    const guessPin = { lat: 12.5, lng: -40.25, extra: "ignored" };
    const deps = setup({ guessPin });
    await act(() => deps.result.current.handleSubmitGuess());

    expect(submitGeoBattleGuess).toHaveBeenCalledWith("room-1", {
      lat: 12.5,
      lng: -40.25,
    });
    expect(deps.playFeedback).toHaveBeenCalledWith("lock");
    expect(deps.showFeedbackBubble).toHaveBeenCalledWith(
      "geo_online.feedback_locked",
      "target",
    );
    expect(deps.setGuessPin).toHaveBeenCalledWith(null);
  });

  it("does nothing when submitting without a pin", async () => {
    const deps = setup({ guessPin: null });
    await act(() => deps.result.current.handleSubmitGuess());
    expect(submitGeoBattleGuess).not.toHaveBeenCalled();
    expect(deps.result.current.actionBusy).toBe("");
  });

  it("gives up with give_up and clears the pin", async () => {
    const deps = setup({ guessPin: { lat: 1, lng: 2 } });
    await act(() => deps.result.current.handleGiveUp());
    expect(submitGeoBattleGuess).toHaveBeenCalledWith("room-1", {
      give_up: true,
    });
    expect(deps.playFeedback).toHaveBeenCalledWith("skip");
    expect(deps.showFeedbackBubble).toHaveBeenCalledWith(
      "geo_online.feedback_gave_up",
      "warning",
    );
    expect(deps.setGuessPin).toHaveBeenCalledWith(null);
  });

  it("keeps the pin and shows error feedback when a guess is rejected", async () => {
    vi.mocked(submitGeoBattleGuess).mockResolvedValueOnce(FAILED);
    const deps = setup({ guessPin: { lat: 1, lng: 2 }, applyResult: false });
    await act(() => deps.result.current.handleSubmitGuess());

    expect(deps.applyRoomResponse).toHaveBeenCalledWith(FAILED);
    expect(deps.setGuessPin).not.toHaveBeenCalled();
    expect(deps.playFeedback).not.toHaveBeenCalledWith("lock");
    expectFailureFeedback(deps);
    expect(deps.result.current.actionBusy).toBe("");
  });

  it("turns a thrown request into a failed response", async () => {
    vi.mocked(zoomOutGeoBattle).mockRejectedValueOnce(new Error("offline"));
    const deps = setup({ applyResult: false });
    await act(() => deps.result.current.handleZoomOut());

    expect(deps.applyRoomResponse).toHaveBeenCalledWith({
      success: false,
      error: "offline",
    });
    expectFailureFeedback(deps);
    expect(deps.result.current.actionBusy).toBe("");
  });

  it("ignores room actions before the room is loaded", async () => {
    const deps = setup({ room: null, guessPin: { lat: 1, lng: 2 } });
    await act(async () => {
      await deps.result.current.handleReadyToggle();
      await deps.result.current.handleZoomOut();
      await deps.result.current.handleSubmitGuess();
      await deps.result.current.handleGiveUp();
    });
    expect(setGeoBattleReady).not.toHaveBeenCalled();
    expect(zoomOutGeoBattle).not.toHaveBeenCalled();
    expect(submitGeoBattleGuess).not.toHaveBeenCalled();
    expect(deps.applyRoomResponse).not.toHaveBeenCalled();
  });

  it("leaves the room and returns to the lobby, even if leaving fails", async () => {
    vi.mocked(leaveGeoBattleRoom).mockRejectedValueOnce(new Error("gone"));
    const deps = setup();
    await act(() => deps.result.current.handleLeaveRoom());
    expect(leaveGeoBattleRoom).toHaveBeenCalledWith("room-1");
    expect(deps.navigate).toHaveBeenCalledWith(LOBBY_PATH);
    expect(LOBBY_PATH).toBe("/guess/online");
    expect(deps.result.current.actionBusy).toBe("");
  });

  it("navigates to the lobby without a request when there is no room", async () => {
    const deps = setup({ room: null });
    await act(() => deps.result.current.handleLeaveRoom());
    expect(leaveGeoBattleRoom).not.toHaveBeenCalled();
    expect(deps.navigate).toHaveBeenCalledWith(LOBBY_PATH);
  });

  describe("leave confirmation", () => {
    const OPPONENT = { nickname: "B", left: false };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("stays in a running match when the player cancels", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const deps = setup({
        room: { ...ROOM, mode: "private", opponent: OPPONENT },
      });
      await act(() => deps.result.current.handleLeaveRoom());
      expect(confirm).toHaveBeenCalledWith("geo_online.leave_confirm_playing");
      expect(leaveGeoBattleRoom).not.toHaveBeenCalled();
      expect(deps.navigate).not.toHaveBeenCalled();
    });

    it("leaves a running match once confirmed", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const deps = setup({
        room: { ...ROOM, mode: "private", opponent: OPPONENT },
      });
      await act(() => deps.result.current.handleLeaveRoom());
      expect(leaveGeoBattleRoom).toHaveBeenCalledWith("room-1");
      expect(deps.navigate).toHaveBeenCalledWith(LOBBY_PATH);
    });

    it("leaves an idle private room without asking", async () => {
      const confirm = vi.spyOn(window, "confirm");
      const deps = setup({
        room: { ...ROOM, phase: "lobby", mode: "private", opponent: OPPONENT },
      });
      await act(() => deps.result.current.handleLeaveRoom());
      expect(confirm).not.toHaveBeenCalled();
      expect(leaveGeoBattleRoom).toHaveBeenCalledWith("room-1");
    });
  });

  it.each([
    [{ phase: "playing", mode: "private" }, "geo_online.leave_confirm_playing"],
    [
      { phase: "countdown", mode: "matchmaking" },
      "geo_online.leave_confirm_playing",
    ],
    [
      { phase: "finished", mode: "matchmaking" },
      "geo_online.leave_confirm_matchmaking",
    ],
    [{ phase: "finished", mode: "private" }, null],
    [{ phase: "lobby", mode: "private" }, null],
  ])("picks the leave confirmation for %o", (overrides, key) => {
    expect(
      getLeaveConfirmKey({
        ...ROOM,
        opponent: { left: false },
        ...overrides,
      }),
    ).toBe(key);
  });

  it("does not ask when nobody else is affected", () => {
    expect(getLeaveConfirmKey({ ...ROOM, opponent: null })).toBeNull();
    expect(
      getLeaveConfirmKey({
        ...ROOM,
        mode: "matchmaking",
        opponent: { left: true },
      }),
    ).toBeNull();
  });

  describe("copy room code", () => {
    let writeText;
    let originalClipboard;

    beforeEach(() => {
      vi.useFakeTimers();
      writeText = vi.fn().mockResolvedValue(undefined);
      originalClipboard = Object.getOwnPropertyDescriptor(
        navigator,
        "clipboard",
      );
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        delete navigator.clipboard;
      }
    });

    it("copies the code and clears the notice after 1.5s", async () => {
      const deps = setup();
      await act(() => deps.result.current.handleCopyCode());

      expect(writeText).toHaveBeenCalledWith("ABC234");
      expect(deps.setActionNotice).toHaveBeenLastCalledWith(
        "geo_online.code_copied",
      );
      expect(deps.playFeedback).toHaveBeenCalledWith("place");
      expect(deps.showFeedbackBubble).toHaveBeenCalledWith(
        "geo_online.code_copied",
        "success",
      );

      act(() => vi.advanceTimersByTime(1499));
      expect(deps.setActionNotice).not.toHaveBeenCalledWith("");
      act(() => vi.advanceTimersByTime(1));
      expect(deps.setActionNotice).toHaveBeenLastCalledWith("");
    });

    it("keeps the notice for the full time after a second copy", async () => {
      const deps = setup();
      await act(() => deps.result.current.handleCopyCode());
      act(() => vi.advanceTimersByTime(1000));
      await act(() => deps.result.current.handleCopyCode());

      // The first copy's timer would have fired here.
      act(() => vi.advanceTimersByTime(1000));
      expect(deps.setActionNotice).not.toHaveBeenCalledWith("");
      act(() => vi.advanceTimersByTime(500));
      expect(deps.setActionNotice).toHaveBeenLastCalledWith("");
      expect(
        deps.setActionNotice.mock.calls.filter(([value]) => value === ""),
      ).toHaveLength(1);
    });

    it("does not clear the notice after unmount", async () => {
      const deps = setup();
      await act(() => deps.result.current.handleCopyCode());
      deps.unmount();
      act(() => vi.advanceTimersByTime(2000));
      expect(deps.setActionNotice).not.toHaveBeenCalledWith("");
    });

    it("reports a clipboard failure", async () => {
      writeText.mockRejectedValueOnce(new Error("denied"));
      const deps = setup();
      await act(() => deps.result.current.handleCopyCode());

      expect(deps.setActionError).toHaveBeenCalledWith(
        "geo_online.copy_failed",
      );
      expect(deps.setActionNotice).not.toHaveBeenCalled();
      expect(deps.playFeedback).toHaveBeenCalledWith("error");
      expect(deps.showFeedbackBubble).toHaveBeenCalledWith(
        "geo_online.copy_failed",
        "danger",
      );
    });

    it("does nothing without a room code", async () => {
      const deps = setup({ room: { ...ROOM, room_code: "" } });
      await act(() => deps.result.current.handleCopyCode());
      expect(writeText).not.toHaveBeenCalled();
    });
  });
});
