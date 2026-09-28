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

// Offsets further than this from the current estimate are adopted directly
// (server clock jump, first sample after a stall) instead of being smoothed.
const CLOCK_OFFSET_RESET_MS = 5000;
const CLOCK_OFFSET_SMOOTHING = 0.25;

/**
 * Server-minus-local clock offset from one request, assuming the server
 * stamped `server_time` halfway through the round trip.
 * @param {string | null | undefined} serverTime
 * @param {number} requestStartedAt
 * @param {number} responseReceivedAt
 */
function estimateClockOffset(serverTime, requestStartedAt, responseReceivedAt) {
  const serverMs = parseSnapshotTime(serverTime);
  if (serverMs == null) return null;
  const midpoint =
    requestStartedAt + Math.max(0, responseReceivedAt - requestStartedAt) / 2;
  return serverMs - midpoint;
}

/**
 * Blend a new offset sample into the current estimate so latency jitter does
 * not make the countdown jump around.
 * @param {number | null} current @param {number | null} sample
 */
function smoothClockOffset(current, sample) {
  if (sample == null) return current;
  if (current == null || Math.abs(sample - current) > CLOCK_OFFSET_RESET_MS) {
    return sample;
  }
  return current + (sample - current) * CLOCK_OFFSET_SMOOTHING;
}

/**
 * Keeps a countdown for the same deadline from ticking back up after an
 * offset correction.
 * @param {{deadlineAt: string | null, seconds: number | null}} previous
 * @param {string | null | undefined} deadlineAt
 * @param {number | null} seconds
 */
function clampRemainingSeconds(previous, deadlineAt, seconds) {
  if (
    seconds != null &&
    previous.seconds != null &&
    previous.deadlineAt === deadlineAt &&
    seconds > previous.seconds
  ) {
    return previous.seconds;
  }
  return seconds;
}

export {
  getRemainingSeconds,
  estimateClockOffset,
  smoothClockOffset,
  clampRemainingSeconds,
  parseSnapshotTime,
  isOlderRoomSnapshot,
  rememberRoomSnapshot,
};
