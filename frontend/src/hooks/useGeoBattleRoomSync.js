import { useCallback, useEffect, useRef, useState } from "react";

import { getGeoBattleRoom } from "../services/api";
import {
  getRemainingSeconds,
  isOlderRoomSnapshot,
  rememberRoomSnapshot,
} from "../utils/geoBattleSnapshot";

const SYNC_INTERVAL_PLAYING = 1500;
const SYNC_INTERVAL_IDLE = 2500;
const FATAL_SYNC_FAILURES = 3;

/**
 * Keeps the server-authoritative room snapshot in sync: initial load, polling
 * (faster while playing), a refresh right after each phase deadline, server
 * clock offset for countdowns, and out-of-order snapshot rejection.
 *
 * Also owns the room-level banner state (fatal/action error, action notice)
 * because it is reset together with the room when `roomId` changes.
 * `onRoomReset` runs at the end of that reset; it is read through a ref so an
 * unstable callback never triggers an extra reset.
 */
function useGeoBattleRoomSync({ roomId, t, onRoomReset }) {
  const [room, setRoom] = useState(null);
  const [fatalError, setFatalError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [syncFailures, setSyncFailures] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const roomRef = useRef(room);
  roomRef.current = room;
  const latestRoomSnapshotRef = useRef({
    serverTimeMs: null,
    updatedAtMs: null,
  });
  const clockOffsetRef = useRef(0);
  const onRoomResetRef = useRef(onRoomReset);
  onRoomResetRef.current = onRoomReset;

  useEffect(() => {
    if (!room?.server_time) return;
    const serverMs = Date.parse(room.server_time);
    if (!Number.isNaN(serverMs)) {
      clockOffsetRef.current = serverMs - Date.now();
    }
  }, [room?.server_time]);

  useEffect(() => {
    if (!room?.phase_deadline_at) return undefined;
    const id = window.setInterval(() => setNowTick(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [room?.phase_deadline_at]);

  const applyRoomSnapshot = useCallback((nextRoom) => {
    if (isOlderRoomSnapshot(nextRoom, latestRoomSnapshotRef.current)) {
      return false;
    }
    rememberRoomSnapshot(nextRoom, latestRoomSnapshotRef.current);
    setRoom(nextRoom);
    return true;
  }, []);

  const applyRoomResponse = useCallback(
    (response) => {
      if (!response.success || !response.data?.room) {
        setActionError(response.error || t("geo_online.generic_error"));
        return false;
      }
      applyRoomSnapshot(response.data.room);
      setActionError("");
      return true;
    },
    [applyRoomSnapshot, t],
  );

  useEffect(() => {
    latestRoomSnapshotRef.current = {
      serverTimeMs: null,
      updatedAtMs: null,
    };
    setRoom(null);
    setFatalError("");
    setActionError("");
    setActionNotice("");
    setSyncFailures(0);
    onRoomResetRef.current();
  }, [roomId]);

  const loadRoomSnapshot = useCallback(async () => {
    let res;
    try {
      res = await getGeoBattleRoom(roomId);
    } catch (error) {
      res = { success: false, error: error.message };
    }
    if (res.success && res.data?.room) {
      const accepted = applyRoomSnapshot(res.data.room);
      if (accepted) {
        setFatalError("");
      }
      setSyncFailures(0);
      return true;
    }

    setSyncFailures((prev) => {
      const next = prev + 1;
      if (next >= FATAL_SYNC_FAILURES && !roomRef.current) {
        setFatalError(res.error || t("geo_online.room_missing"));
      }
      return next;
    });
    return false;
  }, [applyRoomSnapshot, roomId, t]);

  useEffect(() => {
    loadRoomSnapshot();
  }, [loadRoomSnapshot]);

  useEffect(() => {
    if (!room?.phase_deadline_at) return undefined;
    const deadlineMs = Date.parse(room.phase_deadline_at);
    if (Number.isNaN(deadlineMs)) return undefined;

    const delayMs = Math.max(
      0,
      deadlineMs - (Date.now() + clockOffsetRef.current) + 80,
    );
    const timeoutId = window.setTimeout(() => {
      loadRoomSnapshot();
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadRoomSnapshot, room?.phase, room?.phase_deadline_at]);

  useEffect(() => {
    const interval = window.setInterval(
      () => {
        loadRoomSnapshot();
      },
      room?.phase === "playing" ? SYNC_INTERVAL_PLAYING : SYNC_INTERVAL_IDLE,
    );

    return () => {
      window.clearInterval(interval);
    };
  }, [loadRoomSnapshot, room?.phase]);

  const remainingSeconds = getRemainingSeconds(
    room?.phase_deadline_at,
    clockOffsetRef.current,
    nowTick,
  );

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
  SYNC_INTERVAL_PLAYING,
  SYNC_INTERVAL_IDLE,
  FATAL_SYNC_FAILURES,
};
