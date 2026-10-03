import { useCallback, useEffect, useRef, useState } from "react";

import { getGeoBattleRoom } from "../services/api";
import { getRoomProgressKey } from "../utils/geoBattleRoomState";
import {
  clampRemainingSeconds,
  estimateClockOffset,
  getRemainingSeconds,
  isOlderRoomSnapshot,
  rememberRoomSnapshot,
  smoothClockOffset,
} from "../utils/geoBattleSnapshot";

const SYNC_INTERVAL_PLAYING = 1500;
const SYNC_INTERVAL_IDLE = 2500;
// Hidden tabs poll slower, but well inside the server's 25s online threshold
// so the opponent does not see this player drop offline.
const SYNC_INTERVAL_HIDDEN = 10000;
const FATAL_SYNC_FAILURES = 3;
// The room no longer exists (404) or this session is no longer in it (403).
const ROOM_GONE_STATUSES = new Set([403, 404]);

// 后端 409 的错误原文是固定的服务层错误串，按它细分提示
const CONFLICT_ERROR_KEYS = {
  "geo battle room full": "geo_online.error_room_full",
  "geo battle room closed": "geo_online.error_room_closed",
  "geo battle already in another room": "geo_online.already_in_room",
};

/**
 * 把联机接口的失败结果换成给用户看的翻译文案；后端原文只留在控制台。
 * `notFoundKey` 让调用方区分"房间码不存在"和"已经不在房间里"。
 */
function getGeoBattleErrorMessage(
  res,
  t,
  { notFoundKey = "geo_online.room_missing" } = {},
) {
  if (res?.error) console.warn("[geo-battle]", res.status ?? "", res.error);
  switch (res?.status) {
    case 0:
      return t("geo_online.error_network");
    case 400:
      return t("geo_online.error_invalid_input");
    case 403:
      return t("geo_online.room_missing");
    case 404:
      return t(notFoundKey);
    case 409:
      return t(CONFLICT_ERROR_KEYS[res.error] || "geo_online.error_conflict");
    case 429:
      return t("geo_online.error_rate_limited");
    default:
      return t("geo_online.generic_error");
  }
}

function isPageHidden() {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/**
 * Keeps the server-authoritative room snapshot in sync: initial load, polling
 * (faster while playing, slower while the page is hidden, never more than one
 * request in flight), a refresh right after each phase deadline, a smoothed
 * server clock offset for countdowns, and out-of-order snapshot rejection.
 *
 * Also owns the room-level banner state (fatal/action error, action notice)
 * because it is reset together with the room when `roomId` changes. An action
 * error is dropped once a later snapshot shows the room in another phase or
 * round. `onRoomReset` runs at the end of that reset; it is read through a ref
 * so an unstable callback never triggers an extra reset.
 */
function useGeoBattleRoomSync({ roomId, t, onRoomReset }) {
  const [room, setRoom] = useState(null);
  const [fatalError, setFatalError] = useState("");
  const [roomGone, setRoomGone] = useState(false);
  const [actionError, setActionErrorState] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [syncFailures, setSyncFailures] = useState(0);
  const [pageHidden, setPageHidden] = useState(isPageHidden);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const roomRef = useRef(room);
  roomRef.current = room;
  const latestRoomSnapshotRef = useRef({
    serverTimeMs: null,
    updatedAtMs: null,
  });
  const clockOffsetRef = useRef(null);
  const remainingRef = useRef({ deadlineAt: null, seconds: null });
  const actionErrorKeyRef = useRef(null);
  // Per-room request bookkeeping; replaced on every room change so responses
  // for a previous room are recognised and dropped.
  const syncRef = useRef(null);
  const onRoomResetRef = useRef(onRoomReset);
  onRoomResetRef.current = onRoomReset;

  useEffect(() => {
    if (!room?.phase_deadline_at) return undefined;
    const id = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [room?.phase_deadline_at]);

  const setActionError = useCallback((message) => {
    actionErrorKeyRef.current = message
      ? getRoomProgressKey(roomRef.current)
      : null;
    setActionErrorState(message);
  }, []);

  const applyRoomSnapshot = useCallback((nextRoom) => {
    if (isOlderRoomSnapshot(nextRoom, latestRoomSnapshotRef.current)) {
      return false;
    }
    rememberRoomSnapshot(nextRoom, latestRoomSnapshotRef.current);
    if (
      actionErrorKeyRef.current !== null &&
      getRoomProgressKey(nextRoom) !== actionErrorKeyRef.current
    ) {
      actionErrorKeyRef.current = null;
      setActionErrorState("");
    }
    setRoom(nextRoom);
    return true;
  }, []);

  const applyRoomResponse = useCallback(
    (response) => {
      if (!response.success || !response.data?.room) {
        setActionError(getGeoBattleErrorMessage(response, t));
        return false;
      }
      applyRoomSnapshot(response.data.room);
      setActionError("");
      return true;
    },
    [applyRoomSnapshot, setActionError, t],
  );

  useEffect(() => {
    const sync = { roomId, inFlight: false, rerun: false };
    syncRef.current = sync;
    latestRoomSnapshotRef.current = {
      serverTimeMs: null,
      updatedAtMs: null,
    };
    clockOffsetRef.current = null;
    remainingRef.current = { deadlineAt: null, seconds: null };
    actionErrorKeyRef.current = null;
    setRoom(null);
    setFatalError("");
    setRoomGone(false);
    setActionErrorState("");
    setActionNotice("");
    setSyncFailures(0);
    onRoomResetRef.current();
    return () => {
      if (syncRef.current === sync) syncRef.current = null;
    };
  }, [roomId]);

  const fetchRoomSnapshot = useCallback(
    async (sync) => {
      const requestStartedAt = Date.now();
      let res;
      try {
        res = await getGeoBattleRoom(roomId);
      } catch (error) {
        res = { success: false, error: error.message };
      }
      // The room changed (or the page unmounted) while this was in flight.
      if (syncRef.current !== sync) return false;

      if (res.success && res.data?.room) {
        const accepted = applyRoomSnapshot(res.data.room);
        if (accepted) {
          clockOffsetRef.current = smoothClockOffset(
            clockOffsetRef.current,
            estimateClockOffset(
              res.data.room.server_time,
              requestStartedAt,
              Date.now(),
            ),
          );
          setFatalError("");
        }
        setSyncFailures(0);
        return true;
      }

      if (ROOM_GONE_STATUSES.has(res.status)) {
        console.warn("[geo-battle]", res.status, res.error);
        sync.rerun = false;
        setRoomGone(true);
        setRoom(null);
        // 标题已经写了"房间不存在"，这里补充可能的原因
        setFatalError(t("geo_online.room_gone_detail"));
        return false;
      }

      // 轮询失败很常见，这里不打日志，只在连续失败后给出提示
      let failureKey = "geo_online.generic_error";
      if (res.status === 0) failureKey = "geo_online.error_network";
      else if (res.status === 429) failureKey = "geo_online.error_rate_limited";
      setSyncFailures((prev) => {
        const next = prev + 1;
        if (next >= FATAL_SYNC_FAILURES && !roomRef.current) {
          setFatalError(t(failureKey));
        }
        return next;
      });
      return false;
    },
    [applyRoomSnapshot, roomId, t],
  );

  /**
   * Loads the room unless a request for it is already in flight. With
   * `rerunIfBusy` (deadline refresh, tab becoming visible) a busy call queues
   * one more request right after the current one, since that response may
   * predate the moment the caller cares about.
   */
  const loadRoomSnapshot = useCallback(
    async ({ rerunIfBusy = false } = {}) => {
      const sync = syncRef.current;
      if (!sync || sync.roomId !== roomId) return false;
      if (sync.inFlight) {
        if (rerunIfBusy) sync.rerun = true;
        return false;
      }

      sync.inFlight = true;
      let loaded = false;
      try {
        do {
          sync.rerun = false;
          loaded = await fetchRoomSnapshot(sync);
        } while (sync.rerun && syncRef.current === sync);
      } finally {
        sync.inFlight = false;
      }
      return loaded;
    },
    [fetchRoomSnapshot, roomId],
  );

  useEffect(() => {
    loadRoomSnapshot();
  }, [loadRoomSnapshot]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handleVisibilityChange = () => {
      const hidden = isPageHidden();
      setPageHidden(hidden);
      if (!hidden) loadRoomSnapshot({ rerunIfBusy: true });
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadRoomSnapshot]);

  useEffect(() => {
    if (!room?.phase_deadline_at) return undefined;
    const deadlineMs = Date.parse(room.phase_deadline_at);
    if (Number.isNaN(deadlineMs)) return undefined;

    const delayMs = Math.max(
      0,
      deadlineMs - (Date.now() + (clockOffsetRef.current ?? 0)) + 80,
    );
    const timeoutId = window.setTimeout(() => {
      loadRoomSnapshot({ rerunIfBusy: true });
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadRoomSnapshot, room?.phase, room?.phase_deadline_at]);

  useEffect(() => {
    if (roomGone) return undefined;
    let intervalMs = SYNC_INTERVAL_IDLE;
    if (pageHidden) {
      intervalMs = SYNC_INTERVAL_HIDDEN;
    } else if (room?.phase === "playing") {
      intervalMs = SYNC_INTERVAL_PLAYING;
    }
    const interval = window.setInterval(() => {
      loadRoomSnapshot();
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadRoomSnapshot, pageHidden, room?.phase, roomGone]);

  const deadlineAt = room?.phase_deadline_at ?? null;
  const remainingSeconds = clampRemainingSeconds(
    remainingRef.current,
    deadlineAt,
    getRemainingSeconds(deadlineAt, clockOffsetRef.current ?? 0, nowTick),
  );
  remainingRef.current = { deadlineAt, seconds: remainingSeconds };

  return {
    room,
    roomRef,
    fatalError,
    actionError,
    setActionError,
    actionNotice,
    setActionNotice,
    syncFailures,
    remainingSeconds,
    applyRoomResponse,
  };
}

export {
  useGeoBattleRoomSync,
  getGeoBattleErrorMessage,
  SYNC_INTERVAL_PLAYING,
  SYNC_INTERVAL_IDLE,
  SYNC_INTERVAL_HIDDEN,
  FATAL_SYNC_FAILURES,
};
