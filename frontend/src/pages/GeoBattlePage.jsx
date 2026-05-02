import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  cancelGeoBattleMatchmaking,
  createGeoBattleRoom,
  fetchGeoBattleImage,
  getGeoBattleMatchmakingStatus,
  getGeoBattleRoom,
  joinGeoBattleMatchmaking,
  joinGeoBattleRoom,
  leaveGeoBattleRoom,
  setGeoBattleReady,
  submitGeoBattleGuess,
  zoomOutGeoBattle,
} from "../services/api";
import { loadGoogleMapsScript } from "../utils/googleMaps";
import {
  PERFECT_GUESS_DISTANCE_KM,
  formatDistance,
  isPerfectGuess,
} from "../utils/geoGameUtils";
import "../styles/GeoBattle.css";

const NICKNAME_STORAGE_KEY = "geoBattleNickname";
const WORLD_CENTER = { lat: 20, lng: 0 };
const SYNC_INTERVAL_PLAYING = 1500;
const SYNC_INTERVAL_IDLE = 2500;

function readSavedNickname() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NICKNAME_STORAGE_KEY) || "";
}

function saveNickname(nickname) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
}

function normalizeRoomCode(code) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function getRemainingSeconds(deadlineAt, clockOffset = 0, now = Date.now()) {
  if (!deadlineAt) return null;
  const deadline = Date.parse(deadlineAt);
  if (Number.isNaN(deadline)) return null;
  const serverNow = now + clockOffset;
  return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
}

function getOutcomeLabel(room, t) {
  if (!room?.opponent) return null;
  if (room.me.total_score > room.opponent.total_score)
    return t("geo_online.win");
  if (room.me.total_score < room.opponent.total_score)
    return t("geo_online.lose");
  return t("geo_online.draw");
}

function formatBattleDistance(distanceKm, t) {
  if (isPerfectGuess(distanceKm)) {
    const distance =
      PERFECT_GUESS_DISTANCE_KM === 1
        ? t("geo.one_km")
        : formatDistance(PERFECT_GUESS_DISTANCE_KM);
    return t("geo.perfect_distance_short", { distance });
  }
  return formatDistance(distanceKm);
}

function getRoomMessage(room, t) {
  if (!room) return "";
  if (room.message?.startsWith("player_left:")) {
    return t("geo_online.left_notice", {
      name: room.message.slice("player_left:".length),
    });
  }
  if (room.message === "prepare_failed") {
    return t("geo_online.prepare_failed");
  }
  if (room.message === "time_up") {
    return t("geo.time_up");
  }
  return room.message || t(`geo_online.phase_${room.phase}`);
}

function PlayerStatusCard({ title, player, currentPhase, t }) {
  if (!player) {
    return null;
  }

  let status = player.is_online
    ? t("geo_online.status_online")
    : t("geo_online.status_offline");

  if (player.left) {
    status = t("geo_online.opponent_left");
  } else if (currentPhase === "lobby" || currentPhase === "finished") {
    status = player.is_ready
      ? t("geo_online.ready_state")
      : t("geo_online.not_ready");
  } else if (player.has_submitted_this_round) {
    status = t("geo_online.locked");
  }

  return (
    <div className="geo-battle-player-card">
      <div className="geo-battle-player-label">{title}</div>
      <div className="geo-battle-player-name">{player.nickname}</div>
      <div className="geo-battle-player-meta">
        <span>{status}</span>
        <span>{player.total_score.toLocaleString()}</span>
      </div>
    </div>
  );
}

function GeoBattleHubPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [nickname, setNickname] = useState(readSavedNickname());
  const [roomCode, setRoomCode] = useState("");
  const [matchmaking, setMatchmaking] = useState({ status: "idle" });
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");

  const syncMatchmaking = useCallback(async () => {
    const res = await getGeoBattleMatchmakingStatus();
    if (!res.success || !res.data) return;

    if (res.data.status === "matched" && res.data.room?.room_id) {
      navigate(`/geo/online/${res.data.room.room_id}`, { replace: true });
      return;
    }

    setMatchmaking(res.data);
  }, [navigate]);

  useEffect(() => {
    syncMatchmaking();
  }, [syncMatchmaking]);

  useEffect(() => {
    if (matchmaking.status !== "queued") return undefined;

    const timer = window.setInterval(syncMatchmaking, SYNC_INTERVAL_PLAYING);
    return () => {
      window.clearInterval(timer);
    };
  }, [matchmaking.status, syncMatchmaking]);

  const withNickname = useCallback(() => {
    const value = nickname.trim();
    if (!value) {
      setError(t("geo_online.need_nickname"));
      return null;
    }
    saveNickname(value);
    setError("");
    return value;
  }, [nickname, t]);

  const handleCreateRoom = async () => {
    const value = withNickname();
    if (!value) return;

    setBusyAction("create");
    const res = await createGeoBattleRoom(value);
    setBusyAction("");

    if (!res.success || !res.data?.room?.room_id) {
      setError(res.error || t("geo_online.generic_error"));
      return;
    }

    navigate(`/geo/online/${res.data.room.room_id}`);
  };

  const handleJoinRoom = async () => {
    const value = withNickname();
    if (!value) return;

    const code = normalizeRoomCode(roomCode);
    if (!code) {
      setError(t("geo_online.need_room_code"));
      return;
    }

    setBusyAction("join");
    const res = await joinGeoBattleRoom(code, value);
    setBusyAction("");

    if (!res.success || !res.data?.room?.room_id) {
      setError(res.error || t("geo_online.generic_error"));
      return;
    }

    navigate(`/geo/online/${res.data.room.room_id}`);
  };

  const handleMatchmaking = async () => {
    const value = withNickname();
    if (!value) return;

    setBusyAction("match");
    const res = await joinGeoBattleMatchmaking(value);
    setBusyAction("");

    if (!res.success || !res.data) {
      if (res.status === 409) {
        setError(t("geo_online.already_in_room"));
      } else {
        setError(res.error || t("geo_online.generic_error"));
      }
      return;
    }

    if (res.data.status === "matched" && res.data.room?.room_id) {
      navigate(`/geo/online/${res.data.room.room_id}`);
      return;
    }

    setMatchmaking(res.data);
  };

  const handleCancelMatchmaking = async () => {
    setBusyAction("cancel-match");
    await cancelGeoBattleMatchmaking();
    setBusyAction("");
    setMatchmaking({ status: "idle" });
  };

  return (
    <div className="geo-battle-page">
      <div className="geo-battle-shell geo-battle-shell--hub">
        <div className="geo-battle-topbar">
          <button
            className="geo-battle-back"
            onClick={() => navigate("/geo")}
            type="button"
          >
            ← {t("geo_online.back_single")}
          </button>
          <div className="geo-battle-title-block">
            <div className="geo-battle-title">{t("geo_online.title")}</div>
            <div className="geo-battle-subtitle">
              {t("geo_online.subtitle")}
            </div>
          </div>
        </div>

        <div className="geo-battle-hub-grid">
          <div className="geo-battle-panel">
            <label className="geo-battle-field">
              <span>{t("geo_online.nickname")}</span>
              <input
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder={t("geo_online.nickname_placeholder")}
                maxLength={20}
              />
            </label>

            <div className="geo-battle-action-grid">
              <button
                type="button"
                className="geo-battle-primary-btn"
                disabled={busyAction !== "" || matchmaking.status === "queued"}
                onClick={handleCreateRoom}
              >
                {busyAction === "create"
                  ? t("geo_online.loading")
                  : t("geo_online.create_room")}
              </button>
              <div className="geo-battle-action-hint">
                {t("geo_online.create_hint")}
              </div>

              <label className="geo-battle-field geo-battle-field--compact">
                <span>{t("geo_online.room_code")}</span>
                <input
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value)}
                  placeholder={t("geo_online.room_code_placeholder")}
                  maxLength={6}
                />
              </label>
              <button
                type="button"
                className="geo-battle-secondary-btn"
                disabled={busyAction !== "" || matchmaking.status === "queued"}
                onClick={handleJoinRoom}
              >
                {busyAction === "join"
                  ? t("geo_online.loading")
                  : t("geo_online.join_room")}
              </button>
              <div className="geo-battle-action-hint">
                {t("geo_online.join_hint")}
              </div>

              <button
                type="button"
                className="geo-battle-secondary-btn"
                disabled={busyAction !== "" || matchmaking.status === "queued"}
                onClick={handleMatchmaking}
              >
                {busyAction === "match"
                  ? t("geo_online.loading")
                  : t("geo_online.matchmaking")}
              </button>
              <div className="geo-battle-action-hint">
                {t("geo_online.matchmaking_hint")}
              </div>
            </div>

            {error && <div className="geo-battle-banner">{error}</div>}
          </div>

          <div className="geo-battle-panel geo-battle-panel--side">
            <div className="geo-battle-side-title">
              {t("geo_online.rules_title")}
            </div>
            <ul className="geo-battle-rule-list">
              <li>{t("geo_online.rule_1")}</li>
              <li>{t("geo_online.rule_2")}</li>
              <li>{t("geo_online.rule_3")}</li>
              <li>{t("geo_online.rule_4")}</li>
            </ul>

            {matchmaking.status === "queued" && (
              <div className="geo-battle-matchmaking-card">
                <div className="geo-battle-side-title">
                  {t("geo_online.matchmaking_wait")}
                </div>
                <div className="geo-battle-side-copy">
                  {t("geo_online.matchmaking_wait_hint")}
                </div>
                <button
                  type="button"
                  className="geo-battle-secondary-btn"
                  disabled={busyAction !== ""}
                  onClick={handleCancelMatchmaking}
                >
                  {busyAction === "cancel-match"
                    ? t("geo_online.loading")
                    : t("geo_online.cancel_matchmaking")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GeoBattleRoomPage({ roomId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [fatalError, setFatalError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [syncFailures, setSyncFailures] = useState(0);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [guessPin, setGuessPin] = useState(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imageObjectUrl, setImageObjectUrl] = useState(null);

  const guessMapElRef = useRef(null);
  const guessMapRef = useRef(null);
  const mapsAPIRef = useRef(null);
  const pendingMarkerRef = useRef(null);
  const resultMarkersRef = useRef([]);
  const resultLinesRef = useRef([]);
  const roomRef = useRef(room);
  roomRef.current = room;
  const clockOffsetRef = useRef(0);
  const [nowTick, setNowTick] = useState(() => Date.now());

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

  const clearPendingMarker = useCallback(() => {
    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setMap(null);
      pendingMarkerRef.current = null;
    }
  }, []);

  const clearResultOverlays = useCallback(() => {
    resultMarkersRef.current.forEach((marker) => marker.setMap(null));
    resultMarkersRef.current = [];
    resultLinesRef.current.forEach((line) => line.setMap(null));
    resultLinesRef.current = [];
  }, []);

  const resetMapViewport = useCallback(() => {
    if (guessMapRef.current) {
      guessMapRef.current.setCenter(WORLD_CENTER);
      guessMapRef.current.setZoom(2);
    }
  }, []);

  const applyRoomResponse = useCallback(
    (response) => {
      if (!response.success || !response.data?.room) {
        setActionError(response.error || t("geo_online.generic_error"));
        return false;
      }
      setRoom(response.data.room);
      setActionError("");
      return true;
    },
    [t],
  );

  const loadRoomSnapshot = useCallback(async () => {
    const res = await getGeoBattleRoom(roomId);
    if (res.success && res.data?.room) {
      setRoom(res.data.room);
      setFatalError("");
      setSyncFailures(0);
      return true;
    }

    setSyncFailures((prev) => {
      const next = prev + 1;
      if (next >= 3 && !roomRef.current) {
        setFatalError(res.error || t("geo_online.room_missing"));
      }
      return next;
    });
    return false;
  }, [roomId, t]);

  useEffect(() => {
    loadRoomSnapshot();
  }, [loadRoomSnapshot]);

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

  useEffect(() => {
    loadGoogleMapsScript()
      .then((maps) => {
        mapsAPIRef.current = maps;
        setMapsReady(true);
      })
      .catch(() => {
        setMapsError(true);
      });
  }, []);

  useEffect(() => {
    if (!mapsReady || !guessMapElRef.current || guessMapRef.current) {
      return;
    }

    const maps = mapsAPIRef.current;
    const map = new maps.Map(guessMapElRef.current, {
      center: WORLD_CENTER,
      zoom: 2,
      mapTypeId: "roadmap",
      disableDefaultUI: true,
      zoomControl: true,
    });

    map.addListener("click", (event) => {
      const currentRoom = roomRef.current;
      if (
        !currentRoom ||
        currentRoom.phase !== "playing" ||
        !currentRoom.can_submit_guess
      ) {
        return;
      }

      const pos = { lat: event.latLng.lat(), lng: event.latLng.lng() };
      setGuessPin(pos);
    });

    guessMapRef.current = map;
  }, [mapsReady]);

  useEffect(() => {
    if (!mapsReady || !guessMapRef.current) return;
    const maps = mapsAPIRef.current;

    if (!guessPin || room?.phase !== "playing") {
      clearPendingMarker();
      return;
    }

    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.setPosition(guessPin);
      return;
    }

    pendingMarkerRef.current = new maps.Marker({
      position: guessPin,
      map: guessMapRef.current,
      icon: {
        path: maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#ef4444",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 2,
      },
    });
  }, [clearPendingMarker, guessPin, mapsReady, room?.phase]);

  useEffect(() => {
    if (!room) return;

    clearPendingMarker();
    clearResultOverlays();

    if (room.phase !== "reveal" && room.phase !== "finished") {
      if (room.phase !== "playing" && room.phase !== "countdown") {
        resetMapViewport();
      }
      return;
    }

    if (!mapsReady || !guessMapRef.current || !room.round?.target) return;

    const maps = mapsAPIRef.current;
    const bounds = new maps.LatLngBounds();
    const target = { lat: room.round.target.lat, lng: room.round.target.lng };
    bounds.extend(target);

    resultMarkersRef.current.push(
      new maps.Marker({
        position: target,
        map: guessMapRef.current,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#10b981",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
      }),
    );

    if (room.round.my_guess?.lat != null && room.round.my_guess?.lng != null) {
      const myGuess = {
        lat: room.round.my_guess.lat,
        lng: room.round.my_guess.lng,
      };
      bounds.extend(myGuess);
      resultMarkersRef.current.push(
        new maps.Marker({
          position: myGuess,
          map: guessMapRef.current,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#ef4444",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
        }),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [myGuess, target],
          strokeColor: "#ef4444",
          strokeWeight: 2,
          strokeOpacity: 0.75,
          geodesic: true,
          map: guessMapRef.current,
        }),
      );
    }

    if (
      room.round.opponent_guess?.lat != null &&
      room.round.opponent_guess?.lng != null
    ) {
      const opponentGuess = {
        lat: room.round.opponent_guess.lat,
        lng: room.round.opponent_guess.lng,
      };
      bounds.extend(opponentGuess);
      resultMarkersRef.current.push(
        new maps.Marker({
          position: opponentGuess,
          map: guessMapRef.current,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#2563eb",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
        }),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [opponentGuess, target],
          strokeColor: "#2563eb",
          strokeWeight: 1.5,
          strokeOpacity: 0.6,
          geodesic: true,
          map: guessMapRef.current,
        }),
      );
    }

    guessMapRef.current.fitBounds(bounds, 40);
  }, [
    clearPendingMarker,
    clearResultOverlays,
    mapsReady,
    resetMapViewport,
    room,
  ]);

  useEffect(() => {
    setGuessPin(null);
    clearPendingMarker();
    clearResultOverlays();
    if (room?.phase !== "playing" && room?.phase !== "countdown") {
      resetMapViewport();
    }
  }, [
    clearPendingMarker,
    clearResultOverlays,
    resetMapViewport,
    room?.round?.index,
  ]);

  const runAction = useCallback(async (actionName, runner) => {
    setActionBusy(actionName);
    setActionError("");
    const res = await runner();
    setActionBusy("");
    return res;
  }, []);

  const handleReadyToggle = async () => {
    if (!room) return;
    const res = await runAction("ready", () =>
      setGeoBattleReady(room.room_id, !room.me.is_ready),
    );
    applyRoomResponse(res);
  };

  const handleZoomOut = async () => {
    if (!room) return;
    const res = await runAction("zoom", () => zoomOutGeoBattle(room.room_id));
    applyRoomResponse(res);
  };

  const handleSubmitGuess = async () => {
    if (!room || !guessPin) return;
    const res = await runAction("guess", () =>
      submitGeoBattleGuess(room.room_id, {
        lat: guessPin.lat,
        lng: guessPin.lng,
      }),
    );
    if (applyRoomResponse(res)) {
      setGuessPin(null);
    }
  };

  const handleGiveUp = async () => {
    if (!room) return;
    const res = await runAction("give-up", () =>
      submitGeoBattleGuess(room.room_id, { give_up: true }),
    );
    if (applyRoomResponse(res)) {
      setGuessPin(null);
    }
  };

  const handleLeaveRoom = async () => {
    if (!room) {
      navigate("/geo/online");
      return;
    }

    await runAction("leave", () => leaveGeoBattleRoom(room.room_id));
    navigate("/geo/online");
  };

  const handleCopyCode = async () => {
    if (!room?.room_code) return;
    try {
      await navigator.clipboard.writeText(room.room_code);
      setActionNotice(t("geo_online.code_copied"));
      window.setTimeout(() => setActionNotice(""), 1500);
    } catch {
      setActionError(t("geo_online.copy_failed"));
    }
  };

  const imageVersion = room
    ? `${room.phase}-${room.round?.index || 0}-${room.round?.current_zoom || 0}-${room.round?.zoom_steps || 0}`
    : "0";
  const imageAvailable = Boolean(
    room?.round && room.phase !== "lobby" && room.phase !== "preparing",
  );
  const remainingSeconds = getRemainingSeconds(
    room?.phase_deadline_at,
    clockOffsetRef.current,
    nowTick,
  );
  const outcomeLabel = getOutcomeLabel(room, t);

  useEffect(() => {
    if (!imageAvailable || !room?.room_id) {
      setImageObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setImgLoaded(false);
      setImgError(false);
      return undefined;
    }

    let cancelled = false;
    let createdUrl = null;
    const controller = new AbortController();
    setImgLoaded(false);
    setImgError(false);

    fetchGeoBattleImage(room.room_id, controller.signal)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setImageObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      })
      .catch((err) => {
        if (cancelled || err.name === "AbortError") return;
        setImgError(true);
        setImgLoaded(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [imageAvailable, room?.room_id, imageVersion]);

  useEffect(() => {
    return () => {
      setImageObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  if (fatalError && !room) {
    return (
      <div className="geo-battle-page">
        <div className="geo-battle-shell geo-battle-shell--error">
          <div className="geo-battle-title">{t("geo_online.room_missing")}</div>
          <div className="geo-battle-banner">{fatalError}</div>
          <button
            type="button"
            className="geo-battle-primary-btn"
            onClick={() => navigate("/geo/online")}
          >
            {t("geo_online.return_lobby")}
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="geo-battle-page">
        <div className="geo-battle-shell geo-battle-shell--loading">
          <div className="geo-battle-title">{t("geo_online.loading_room")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="geo-battle-page">
      <div className="geo-battle-shell">
        <div className="geo-battle-topbar">
          <button
            className="geo-battle-back"
            type="button"
            onClick={handleLeaveRoom}
          >
            ← {t("geo_online.leave_room")}
          </button>
          <div className="geo-battle-title-block">
            <div className="geo-battle-title">{t("geo_online.title")}</div>
            <div className="geo-battle-subtitle">
              {room.mode === "private"
                ? t("geo_online.private_room")
                : t("geo_online.match_room")}
            </div>
          </div>
          <div className="geo-battle-room-meta">
            {room.room_code && (
              <button
                type="button"
                className="geo-battle-room-code"
                onClick={handleCopyCode}
              >
                {t("geo_online.room_code_short")}: {room.room_code}
              </button>
            )}
            {syncFailures > 0 && (
              <span className="geo-battle-sync-warning">
                {t("geo_online.connection_unstable")}
              </span>
            )}
          </div>
        </div>

        <div className="geo-battle-status-bar">
          <PlayerStatusCard
            title={t("geo_online.you")}
            player={room.me}
            currentPhase={room.phase}
            t={t}
          />
          <div className="geo-battle-phase-card">
            <div className="geo-battle-phase-label">
              {t("geo.round", { n: room.round?.index || 1 })} /{" "}
              {room.round?.total || 5}
            </div>
            <div className="geo-battle-phase-main">
              {getRoomMessage(room, t)}
            </div>
            {remainingSeconds !== null && (
              <div className="geo-battle-phase-timer">{remainingSeconds}s</div>
            )}
          </div>
          <PlayerStatusCard
            title={t("geo_online.opponent")}
            player={room.opponent}
            currentPhase={room.phase}
            t={t}
          />
        </div>

        {(actionError || fatalError) && (
          <div className="geo-battle-banner">{actionError || fatalError}</div>
        )}
        {actionNotice && (
          <div className="geo-battle-notice">{actionNotice}</div>
        )}

        <div className="geo-battle-board">
          <div className="geo-battle-satellite">
            {imageAvailable ? (
              <>
                {imageObjectUrl && (
                  <img
                    key={imageObjectUrl}
                    src={imageObjectUrl}
                    alt=""
                    className={`geo-battle-satellite-img ${imgLoaded ? "loaded" : ""}`}
                    onLoad={() => setImgLoaded(true)}
                    onError={() => {
                      setImgLoaded(true);
                      setImgError(true);
                    }}
                    draggable={false}
                  />
                )}
                {(!imgLoaded || !imageObjectUrl) && !imgError && (
                  <div className="geo-battle-overlay">
                    <div className="geo-battle-spinner" />
                    <span>{t("geo_online.loading_image")}</span>
                  </div>
                )}
                {imgError && (
                  <div className="geo-battle-overlay">
                    <span>{t("geo_online.image_error")}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="geo-battle-overlay geo-battle-overlay--placeholder">
                <span>{t("geo_online.waiting_image")}</span>
              </div>
            )}
          </div>

          <div className="geo-battle-map-panel">
            {mapsError ? (
              <div className="geo-battle-map-error">
                {t("geo_online.map_error")}
              </div>
            ) : (
              <div ref={guessMapElRef} className="geo-battle-map" />
            )}

            <div className="geo-battle-controls">
              {(room.phase === "lobby" || room.phase === "finished") && (
                <>
                  <button
                    type="button"
                    className="geo-battle-primary-btn"
                    disabled={!room.can_ready || actionBusy !== ""}
                    onClick={handleReadyToggle}
                  >
                    {actionBusy === "ready"
                      ? t("geo_online.loading")
                      : room.me.is_ready
                        ? t("geo_online.unready")
                        : room.phase === "finished"
                          ? t("geo_online.play_again")
                          : t("geo_online.ready")}
                  </button>
                  <button
                    type="button"
                    className="geo-battle-secondary-btn"
                    onClick={handleLeaveRoom}
                  >
                    {t("geo_online.leave_room")}
                  </button>
                </>
              )}

              {room.phase === "playing" && (
                <>
                  <button
                    type="button"
                    className="geo-battle-secondary-btn"
                    disabled={!room.can_zoom_out || actionBusy !== ""}
                    onClick={handleZoomOut}
                  >
                    {actionBusy === "zoom"
                      ? t("geo_online.loading")
                      : `${t("geo_online.zoom_out")} (${room.round?.zoom_steps || 0})`}
                  </button>
                  <button
                    type="button"
                    className="geo-battle-primary-btn"
                    disabled={
                      !guessPin || !room.can_submit_guess || actionBusy !== ""
                    }
                    onClick={handleSubmitGuess}
                  >
                    {actionBusy === "guess"
                      ? t("geo_online.loading")
                      : t("geo_online.submit_guess")}
                  </button>
                  <button
                    type="button"
                    className="geo-battle-secondary-btn"
                    disabled={!room.can_submit_guess || actionBusy !== ""}
                    onClick={handleGiveUp}
                  >
                    {actionBusy === "give-up"
                      ? t("geo_online.loading")
                      : t("geo_online.skip_round")}
                  </button>
                  <div className="geo-battle-side-copy">
                    {room.me.has_submitted_this_round
                      ? t("geo_online.locked_waiting")
                      : room.round?.opponent_locked
                        ? t("geo_online.opponent_locked")
                        : t("geo_online.place_guess")}
                  </div>
                </>
              )}

              {(room.phase === "preparing" || room.phase === "countdown") && (
                <div className="geo-battle-side-copy">
                  {room.phase === "preparing"
                    ? t("geo_online.preparing")
                    : t("geo_online.round_starts_soon")}
                </div>
              )}

              {(room.phase === "reveal" || room.phase === "finished") && (
                <div className="geo-battle-result-card">
                  <div className="geo-battle-result-title">
                    {room.phase === "finished"
                      ? t("geo_online.finished")
                      : t("geo_online.round_result")}
                  </div>

                  {room.round?.target && (
                    <div className="geo-battle-result-location">
                      {room.round.target.formatted_address ||
                        room.round.target.country}
                    </div>
                  )}

                  <div className="geo-battle-result-grid">
                    <div>
                      <div className="geo-battle-result-label">
                        {t("geo_online.you")}
                      </div>
                      <div className="geo-battle-result-score">
                        +{room.round?.my_guess?.score?.toLocaleString() || 0}
                      </div>
                      <div className="geo-battle-result-distance">
                        {room.round?.my_guess?.distance_km != null
                          ? formatBattleDistance(
                              room.round.my_guess.distance_km,
                              t,
                            )
                          : t("geo.gave_up")}
                      </div>
                    </div>
                    <div>
                      <div className="geo-battle-result-label">
                        {t("geo_online.opponent")}
                      </div>
                      <div className="geo-battle-result-score">
                        +
                        {room.round?.opponent_guess?.score?.toLocaleString() ||
                          0}
                      </div>
                      <div className="geo-battle-result-distance">
                        {room.round?.opponent_guess?.distance_km != null
                          ? formatBattleDistance(
                              room.round.opponent_guess.distance_km,
                              t,
                            )
                          : t("geo.gave_up")}
                      </div>
                    </div>
                  </div>

                  <div className="geo-battle-result-total">
                    <span>{t("geo_online.total_score")}</span>
                    <span>
                      {room.me.total_score.toLocaleString()} :{" "}
                      {room.opponent?.total_score?.toLocaleString() || 0}
                    </span>
                  </div>

                  {room.phase === "finished" && outcomeLabel && (
                    <div className="geo-battle-outcome">{outcomeLabel}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GeoBattlePage() {
  const { roomId } = useParams();

  if (roomId) {
    return <GeoBattleRoomPage roomId={roomId} />;
  }

  return <GeoBattleHubPage />;
}
