import { describe, expect, it } from "vitest";
import {
  getRemainingSeconds,
  isOlderRoomSnapshot,
  rememberRoomSnapshot,
} from "./geoBattleSnapshot";

describe("battle snapshot ordering", () => {
  it("rejects delayed server snapshots, breaking equal server times with update time", () => {
    const latest = { serverTimeMs: null, updatedAtMs: null };
    rememberRoomSnapshot(
      {
        server_time: "2026-09-05T00:00:03Z",
        updated_at: "2026-09-05T00:00:02Z",
      },
      latest,
    );
    expect(
      isOlderRoomSnapshot({ server_time: "2026-09-05T00:00:01Z" }, latest),
    ).toBe(true);
    expect(
      isOlderRoomSnapshot(
        {
          server_time: "2026-09-05T00:00:03Z",
          updated_at: "2026-09-05T00:00:01Z",
        },
        latest,
      ),
    ).toBe(true);
    expect(
      isOlderRoomSnapshot({ server_time: "2026-09-05T00:00:04Z" }, latest),
    ).toBe(false);
    const previous = { ...latest };
    rememberRoomSnapshot({ server_time: "invalid" }, latest);
    expect(latest).toEqual(previous);
  });
  it("uses server clock correction and never shows a negative countdown", () => {
    expect(getRemainingSeconds("1970-01-01T00:00:10Z", 1000, 7500)).toBe(2);
    expect(getRemainingSeconds("1970-01-01T00:00:10Z", 1000, 12000)).toBe(0);
    expect(getRemainingSeconds("invalid")).toBeNull();
  });
});
