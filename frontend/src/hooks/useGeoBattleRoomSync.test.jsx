import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../services/api", () => ({
  getGeoBattleRoom: vi.fn(),
}));

import { getGeoBattleRoom } from "../services/api";
import {
  SYNC_INTERVAL_IDLE,
  SYNC_INTERVAL_PLAYING,
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
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(result.current.fatalError).toBe("gone");
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
    expect(result.current.actionError).toBe("nope");
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
});
