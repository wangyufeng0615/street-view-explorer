import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../services/api", () => ({
  getGeoBattleRoom: vi.fn(),
}));

import { getGeoBattleRoom } from "../services/api";
import {
  SYNC_INTERVAL_HIDDEN,
  SYNC_INTERVAL_IDLE,
  SYNC_INTERVAL_PLAYING,
  getGeoBattleErrorMessage,
  useGeoBattleRoomSync,
} from "./useGeoBattleRoomSync";

const t = (key) => key;
const noop = () => {};

function roomAt(seconds, overrides = {}) {
  const stamp = `2026-09-05T00:00:${String(seconds).padStart(2, "0")}Z`;
  return {
    room_id: "room-1",
    phase: "lobby",
    server_time: stamp,
    updated_at: stamp,
    ...overrides,
  };
}

function ok(room) {
  return { success: true, data: { room } };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function flush() {
  await advance(0);
}

describe("useGeoBattleRoomSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getGeoBattleRoom).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete document.visibilityState;
  });

  it("reports a fatal error only after three failed loads without a room", async () => {
    vi.mocked(getGeoBattleRoom).mockResolvedValue({
      success: false,
      error: "gone",
    });
    const { result } = renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );

    await flush();
    expect(result.current.syncFailures).toBe(1);
    expect(result.current.fatalError).toBe("");

    await advance(SYNC_INTERVAL_IDLE);
    expect(result.current.syncFailures).toBe(2);
    expect(result.current.fatalError).toBe("");

    await advance(SYNC_INTERVAL_IDLE);
    expect(result.current.syncFailures).toBe(3);
    // 后端原文不展示给用户
    expect(result.current.fatalError).toBe("geo_online.generic_error");
  });

  it("polls faster while playing", async () => {
    vi.mocked(getGeoBattleRoom).mockResolvedValue(
      ok(roomAt(1, { phase: "playing" })),
    );
    renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );
    await flush();
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(1);

    await advance(SYNC_INTERVAL_PLAYING);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(2);
    expect(SYNC_INTERVAL_PLAYING).toBeLessThan(SYNC_INTERVAL_IDLE);
  });

  it("ignores polled snapshots older than a room applied from an action", async () => {
    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(ok(roomAt(1)));
    const { result } = renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );
    await flush();

    act(() => {
      expect(
        result.current.applyRoomResponse(ok(roomAt(3, { phase: "preparing" }))),
      ).toBe(true);
    });
    expect(result.current.room.phase).toBe("preparing");

    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(ok(roomAt(2)));
    await advance(SYNC_INTERVAL_IDLE);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(2);
    expect(result.current.room.phase).toBe("preparing");

    act(() => {
      expect(
        result.current.applyRoomResponse({ success: false, error: "nope" }),
      ).toBe(false);
    });
    expect(result.current.actionError).toBe("geo_online.generic_error");
  });

  it("refreshes right after the phase deadline using the server clock offset", async () => {
    vi.setSystemTime(Date.parse("2026-09-05T00:00:00Z"));
    // Server clock runs 10s ahead of the local clock; deadline is 2s away
    // in server time.
    vi.mocked(getGeoBattleRoom).mockResolvedValue(
      ok(
        roomAt(10, {
          phase: "countdown",
          phase_deadline_at: "2026-09-05T00:00:12Z",
        }),
      ),
    );
    const { result } = renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );
    await flush();
    // The offset is applied by an effect, so the countdown picks it up on the
    // next 500ms tick.
    await advance(500);
    expect(result.current.remainingSeconds).toBe(2);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(1);

    await advance(1500);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(1);
    await advance(100);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(2);
  });

  it("resets room state and calls onRoomReset when the room id changes", async () => {
    vi.mocked(getGeoBattleRoom).mockResolvedValue(ok(roomAt(1)));
    const onRoomReset = vi.fn();
    const { result, rerender } = renderHook(
      ({ roomId }) => useGeoBattleRoomSync({ roomId, t, onRoomReset }),
      { initialProps: { roomId: "room-1" } },
    );
    await flush();
    expect(onRoomReset).toHaveBeenCalledTimes(1);
    expect(result.current.room).not.toBeNull();

    vi.mocked(getGeoBattleRoom).mockReturnValue(new Promise(() => {}));
    rerender({ roomId: "room-2" });
    await flush();
    expect(onRoomReset).toHaveBeenCalledTimes(2);
    expect(result.current.room).toBeNull();
    expect(getGeoBattleRoom).toHaveBeenLastCalledWith("room-2");
  });

  it("does not reset the room when only the onRoomReset identity changes", async () => {
    vi.mocked(getGeoBattleRoom).mockResolvedValue(ok(roomAt(1)));
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onRoomReset }) =>
        useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset }),
      { initialProps: { onRoomReset: first } },
    );
    await flush();
    rerender({ onRoomReset: second });
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(result.current.room).not.toBeNull();
  });

  it("never overlaps polls while a request is still in flight", async () => {
    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(
      ok(roomAt(1, { phase: "playing" })),
    );
    const { result } = renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );
    await flush();
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(1);

    const slow = deferred();
    vi.mocked(getGeoBattleRoom).mockReturnValueOnce(slow.promise);
    await advance(SYNC_INTERVAL_PLAYING);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(2);

    await advance(SYNC_INTERVAL_PLAYING * 3);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(2);

    vi.mocked(getGeoBattleRoom).mockResolvedValue(
      ok(roomAt(9, { phase: "playing" })),
    );
    await act(async () => {
      slow.resolve(ok(roomAt(8, { phase: "playing" })));
    });
    expect(result.current.room.server_time).toBe(roomAt(8).server_time);
    await advance(SYNC_INTERVAL_PLAYING);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(3);
  });

  it("queues one refresh when the phase deadline passes during a slow poll", async () => {
    vi.setSystemTime(Date.parse("2026-09-05T00:00:00Z"));
    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(
      ok(
        roomAt(0, {
          phase: "countdown",
          phase_deadline_at: "2026-09-05T00:00:03Z",
        }),
      ),
    );
    const { result } = renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );
    await flush();

    const slow = deferred();
    vi.mocked(getGeoBattleRoom).mockReturnValueOnce(slow.promise);
    await advance(SYNC_INTERVAL_IDLE);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(2);

    // Deadline refresh fires while the poll is still pending.
    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(
      ok(roomAt(4, { phase: "playing" })),
    );
    await advance(700);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(2);

    await act(async () => {
      slow.resolve(ok(roomAt(2, { phase: "countdown" })));
    });
    await flush();
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(3);
    expect(result.current.room.phase).toBe("playing");
  });

  it("drops a late response that belongs to the previous room", async () => {
    const late = deferred();
    vi.mocked(getGeoBattleRoom).mockReturnValueOnce(late.promise);
    const { result, rerender } = renderHook(
      ({ roomId }) => useGeoBattleRoomSync({ roomId, t, onRoomReset: noop }),
      { initialProps: { roomId: "room-1" } },
    );
    await flush();

    vi.mocked(getGeoBattleRoom).mockReturnValue(new Promise(() => {}));
    rerender({ roomId: "room-2" });
    await flush();
    await act(async () => {
      late.resolve(ok(roomAt(5, { phase: "playing" })));
    });
    expect(result.current.room).toBeNull();
    expect(getGeoBattleRoom).toHaveBeenLastCalledWith("room-2");
  });

  it("stops polling and reports a fatal error once a loaded room is gone", async () => {
    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(ok(roomAt(1)));
    const { result } = renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );
    await flush();
    expect(result.current.room).not.toBeNull();

    vi.mocked(getGeoBattleRoom).mockResolvedValue({
      success: false,
      status: 404,
      error: "room not found",
    });
    await advance(SYNC_INTERVAL_IDLE);
    expect(result.current.room).toBeNull();
    expect(result.current.fatalError).toBe("geo_online.room_gone_detail");

    await advance(SYNC_INTERVAL_IDLE * 3);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(2);
  });

  it("clears an action error once polling shows the room moved on", async () => {
    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(
      ok(roomAt(1, { phase: "playing", round: { index: 1 } })),
    );
    const { result } = renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );
    await flush();

    act(() => {
      result.current.applyRoomResponse({
        success: false,
        status: 409,
        error: "geo battle invalid phase",
      });
    });
    expect(result.current.actionError).toBe("geo_online.error_conflict");

    // Same phase and round: the error still applies.
    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(
      ok(roomAt(2, { phase: "playing", round: { index: 1 } })),
    );
    await advance(SYNC_INTERVAL_PLAYING);
    expect(result.current.actionError).toBe("geo_online.error_conflict");

    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(
      ok(roomAt(3, { phase: "reveal", round: { index: 1 } })),
    );
    await advance(SYNC_INTERVAL_PLAYING);
    expect(result.current.actionError).toBe("");
  });

  it("polls slower while hidden and refreshes as soon as the page is visible", async () => {
    vi.mocked(getGeoBattleRoom).mockResolvedValue(
      ok(roomAt(1, { phase: "playing" })),
    );
    renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );
    await flush();
    expect(SYNC_INTERVAL_HIDDEN).toBeLessThan(25000);

    act(() => setVisibility("hidden"));
    await advance(SYNC_INTERVAL_HIDDEN - 1);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(2);

    act(() => setVisibility("visible"));
    await flush();
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(3);
    await advance(SYNC_INTERVAL_PLAYING);
    expect(getGeoBattleRoom).toHaveBeenCalledTimes(4);
  });

  it("corrects the clock by half the round trip and never counts back up", async () => {
    vi.setSystemTime(Date.parse("2026-09-05T00:00:00Z"));
    const deadline = "2026-09-05T00:00:20Z";
    // First response takes 2s; the server stamped it halfway (local 00:01).
    vi.mocked(getGeoBattleRoom).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                ok(
                  roomAt(1, {
                    phase: "playing",
                    phase_deadline_at: deadline,
                  }),
                ),
              ),
            2000,
          );
        }),
    );
    const { result } = renderHook(() =>
      useGeoBattleRoomSync({ roomId: "room-1", t, onRoomReset: noop }),
    );
    await advance(2000);
    await advance(500);
    // Offset 0: 20s - 2.5s local.
    expect(result.current.remainingSeconds).toBe(18);

    // A fast response whose server time reads 3s behind the local clock would
    // move the countdown up; it must hold instead.
    vi.mocked(getGeoBattleRoom).mockResolvedValueOnce(
      ok(roomAt(1, { phase: "playing", phase_deadline_at: deadline })),
    );
    vi.mocked(getGeoBattleRoom).mockResolvedValue(
      ok(roomAt(2, { phase: "playing", phase_deadline_at: deadline })),
    );
    let previous = result.current.remainingSeconds;
    for (let i = 0; i < 8; i += 1) {
      await advance(500);
      expect(result.current.remainingSeconds).toBeLessThanOrEqual(previous);
      previous = result.current.remainingSeconds;
    }
  });
});

describe("getGeoBattleErrorMessage", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [{ status: 0, error: "Failed to fetch" }, "geo_online.error_network"],
    [
      { status: 400, error: "geo battle invalid nickname" },
      "geo_online.error_invalid_input",
    ],
    [
      { status: 403, error: "geo battle player not in room" },
      "geo_online.room_missing",
    ],
    [
      { status: 404, error: "geo battle room not found" },
      "geo_online.room_missing",
    ],
    [
      { status: 409, error: "geo battle room full" },
      "geo_online.error_room_full",
    ],
    [
      { status: 409, error: "geo battle room closed" },
      "geo_online.error_room_closed",
    ],
    [
      { status: 409, error: "geo battle already in another room" },
      "geo_online.already_in_room",
    ],
    [
      { status: 409, error: "geo battle invalid phase" },
      "geo_online.error_conflict",
    ],
    [{ status: 429, error: "rate limited" }, "geo_online.error_rate_limited"],
    [{ status: 500, error: "boom" }, "geo_online.generic_error"],
    [{ error: "thrown" }, "geo_online.generic_error"],
  ])("maps %o to a translated message", (res, key) => {
    expect(getGeoBattleErrorMessage({ success: false, ...res }, t)).toBe(key);
  });

  it("lets the caller choose the not-found message", () => {
    expect(
      getGeoBattleErrorMessage({ success: false, status: 404 }, t, {
        notFoundKey: "geo_online.error_room_not_found",
      }),
    ).toBe("geo_online.error_room_not_found");
  });

  it("keeps the raw backend error in the console only", () => {
    getGeoBattleErrorMessage({ success: false, status: 500, error: "boom" }, t);
    expect(console.warn).toHaveBeenCalledWith("[geo-battle]", 500, "boom");
  });
});
