// @ts-check
/** @typedef {{server_time?: string, updated_at?: string}} RoomTimestamp */
/** @typedef {{serverTimeMs: number | null, updatedAtMs: number | null}} SnapshotClock */
/** @param {string | null | undefined} deadlineAt */
function getRemainingSeconds(deadlineAt, clockOffset = 0, now = Date.now()) {
  if (!deadlineAt) return null;
  const deadline = Date.parse(deadlineAt);
  if (Number.isNaN(deadline)) return null;
  const serverNow = now + clockOffset;
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}

/** @param {string | null | undefined} value */
function parseSnapshotTime(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** @param {RoomTimestamp | null} room @param {SnapshotClock} latest */
function isOlderRoomSnapshot(room, latest) {
  const serverTimeMs = parseSnapshotTime(room?.server_time);
  const updatedAtMs = parseSnapshotTime(room?.updated_at);

  if (
    serverTimeMs != null &&
    latest.serverTimeMs != null &&
    serverTimeMs < latest.serverTimeMs
  ) {
    return true;
  }

  if (
    (serverTimeMs == null || serverTimeMs === latest.serverTimeMs) &&
    updatedAtMs != null &&
    latest.updatedAtMs != null &&
    updatedAtMs < latest.updatedAtMs
  ) {
    return true;
  }

  return false;
}

/** @param {RoomTimestamp | null} room @param {SnapshotClock} latest */
function rememberRoomSnapshot(room, latest) {
  const serverTimeMs = parseSnapshotTime(room?.server_time);
  const updatedAtMs = parseSnapshotTime(room?.updated_at);

  if (serverTimeMs != null) {
    latest.serverTimeMs =
      latest.serverTimeMs == null
        ? serverTimeMs
        : Math.max(latest.serverTimeMs, serverTimeMs);
  }

  if (updatedAtMs != null) {
    latest.updatedAtMs =
      latest.updatedAtMs == null
        ? updatedAtMs
        : Math.max(latest.updatedAtMs, updatedAtMs);
  }
}

export {
  getRemainingSeconds,
  parseSnapshotTime,
  isOlderRoomSnapshot,
  rememberRoomSnapshot,
};
