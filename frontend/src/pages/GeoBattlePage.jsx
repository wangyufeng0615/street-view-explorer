import {
  getOutcomeLabel,
  BattleScoreBreakdown,
  RoundResultOverlay,
  FinalResultOverlay,
  PlayerStatusCard,
} from "../components/GeoBattleResults";
import {
  getRemainingSeconds,
  isOlderRoomSnapshot,
  rememberRoomSnapshot,
} from "../utils/geoBattleSnapshot";
import { GeoBattleHubPage } from "./GeoBattleHubPage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  fetchGeoBattleImage,
  getGeoBattleRoom,
  leaveGeoBattleRoom,
  setGeoBattleReady,
  submitGeoBattleGuess,
  zoomOutGeoBattle,
} from "../services/api";
import { loadGoogleMapsScript } from "../utils/googleMaps";

import LanguageSwitch from "../components/LanguageSwitch";
import {
  GameFeedbackBubbles,
  GameSoundToggle,
} from "../components/GameFeedback";
import { useGameFeedback } from "../hooks/useGameFeedback";
import "../styles/GeoBattle.css";

const WORLD_CENTER = { lat: 20, lng: 0 };
const SYNC_INTERVAL_PLAYING = 1500;
const SYNC_INTERVAL_IDLE = 2500;
const SATELLITE_ZOOM_TRANSITION_MS = 760;

const BATTLE_MARKERS = {
  target: { color: "#10b981", zIndex: 30, scale: 17 },
  player: { color: "#ef4444", zIndex: 50, scale: 16 },
  opponent: { color: "#2563eb", zIndex: 40, scale: 16 },
};

function getBattleMarkerLabel(type, t) {
  if (type === "target") return t("geo_online.pin_target_short");
  if (type === "opponent") return t("geo_online.pin_opponent_short");
  return t("geo_online.pin_you_short");
}

function createBattleMarker(maps, map, position, type, t) {
  const marker = BATTLE_MARKERS[type] || BATTLE_MARKERS.player;
  return new maps.Marker({
    position,
    map,
    clickable: false,
    zIndex: marker.zIndex,
    icon: {
      path: maps.SymbolPath.CIRCLE,
      scale: marker.scale,
      fillColor: marker.color,
      fillOpacity: 1,
      strokeColor: "#fff",
      strokeWeight: 2.5,
    },
    label: {
      text: getBattleMarkerLabel(type, t),
      color: "#fff",
      fontSize: "11px",
      fontWeight: "800",
    },
  });
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
  const [mapReady, setMapReady] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [guessPin, setGuessPin] = useState(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imageObjectUrl, setImageObjectUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [displayedImageVersion, setDisplayedImageVersion] = useState("");
  const [zoomTransition, setZoomTransition] = useState(null);
  const {
    bubbles: feedbackBubbles,
    showFeedbackBubble,
    playFeedback,
    soundEnabled,
    toggleSound,
  } = useGameFeedback({ storageKey: "geoBattleSound" });

  const guessMapElRef = useRef(null);
  const guessMapRef = useRef(null);
  const mapsAPIRef = useRef(null);
  const pendingMarkerRef = useRef(null);
  const resultMarkersRef = useRef([]);
  const resultLinesRef = useRef([]);
  const roomRef = useRef(room);
  const imageObjectUrlRef = useRef(null);
  const displayedImageVersionRef = useRef("");
  const zoomTransitionRequestRef = useRef(0);
  const zoomTransitionTimerRef = useRef(null);
  const latestRoomSnapshotRef = useRef({
    serverTimeMs: null,
    updatedAtMs: null,
  });
  const feedbackRef = useRef({ showFeedbackBubble, playFeedback, t });
  feedbackRef.current = { showFeedbackBubble, playFeedback, t };
  const roomFeedbackRef = useRef(null);
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

  const refreshMapViewport = useCallback(() => {
    const maps = mapsAPIRef.current;
    if (maps?.event && guessMapRef.current) {
      maps.event.trigger(guessMapRef.current, "resize");
    }
  }, []);

  const resetMapViewport = useCallback(() => {
    if (guessMapRef.current) {
      refreshMapViewport();
      guessMapRef.current.setCenter(WORLD_CENTER);
      guessMapRef.current.setZoom(2);
    }
  }, [refreshMapViewport]);

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
    setGuessPin(null);
    clearPendingMarker();
    clearResultOverlays();
    resetMapViewport();
  }, [clearPendingMarker, clearResultOverlays, resetMapViewport, roomId]);

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
      if (next >= 3 && !roomRef.current) {
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
    if (!room || !mapsReady || !guessMapElRef.current || guessMapRef.current) {
      return;
    }

    let cancelled = false;
    const maps = mapsAPIRef.current;
    if (!maps) return;
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
      const hadPin = Boolean(pendingMarkerRef.current);
      setGuessPin(pos);
      feedbackRef.current.playFeedback("place");
      feedbackRef.current.showFeedbackBubble(
        feedbackRef.current.t(
          hadPin
            ? "geo_online.feedback_pin_moved"
            : "geo_online.feedback_pin_placed",
        ),
        "player",
      );
    });

    guessMapRef.current = map;
    setMapReady(false);

    const fallbackId = window.setTimeout(() => {
      if (!cancelled) setMapReady(true);
    }, 1800);

    if (maps.event?.addListenerOnce) {
      maps.event.addListenerOnce(map, "idle", () => {
        if (!cancelled) {
          window.clearTimeout(fallbackId);
          setMapReady(true);
        }
      });
    } else {
      window.setTimeout(() => {
        if (!cancelled) setMapReady(true);
      }, 0);
    }

    window.requestAnimationFrame(() => {
      if (cancelled) return;
      refreshMapViewport();
      map.setCenter(WORLD_CENTER);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackId);
      if (guessMapRef.current === map) {
        maps.event?.clearInstanceListeners?.(map);
        guessMapRef.current = null;
      }
    };
  }, [mapsReady, refreshMapViewport, room?.room_id]);

  useEffect(() => {
    if (!room || !guessMapRef.current) return undefined;

    const refresh = () => {
      refreshMapViewport();
    };

    refresh();

    if (typeof ResizeObserver === "undefined" || !guessMapElRef.current) {
      window.addEventListener("resize", refresh);
      return () => window.removeEventListener("resize", refresh);
    }

    const observer = new ResizeObserver(refresh);
    observer.observe(guessMapElRef.current);
    return () => observer.disconnect();
  }, [refreshMapViewport, room?.room_id]);

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

    pendingMarkerRef.current = createBattleMarker(
      maps,
      guessMapRef.current,
      guessPin,
      "player",
      t,
    );
  }, [clearPendingMarker, guessPin, mapsReady, room?.phase, t]);

  useEffect(() => {
    if (!room) return;

    clearResultOverlays();

    if (room.phase !== "reveal" && room.phase !== "finished") {
      if (room.phase !== "playing") {
        clearPendingMarker();
        resetMapViewport();
      }
      return;
    }

    clearPendingMarker();
    if (!mapsReady || !guessMapRef.current || !room.round?.target) return;

    const maps = mapsAPIRef.current;
    const bounds = new maps.LatLngBounds();
    const target = { lat: room.round.target.lat, lng: room.round.target.lng };
    bounds.extend(target);

    resultMarkersRef.current.push(
      createBattleMarker(maps, guessMapRef.current, target, "target", t),
    );

    if (room.round.my_guess?.lat != null && room.round.my_guess?.lng != null) {
      const myGuess = {
        lat: room.round.my_guess.lat,
        lng: room.round.my_guess.lng,
      };
      bounds.extend(myGuess);
      resultMarkersRef.current.push(
        createBattleMarker(maps, guessMapRef.current, myGuess, "player", t),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [myGuess, target],
          strokeColor: BATTLE_MARKERS.player.color,
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
        createBattleMarker(
          maps,
          guessMapRef.current,
          opponentGuess,
          "opponent",
          t,
        ),
      );
      resultLinesRef.current.push(
        new maps.Polyline({
          path: [opponentGuess, target],
          strokeColor: BATTLE_MARKERS.opponent.color,
          strokeWeight: 1.5,
          strokeOpacity: 0.6,
          geodesic: true,
          map: guessMapRef.current,
        }),
      );
    }

    const fitVisibleMap = () => {
      if (!guessMapRef.current) return;
      refreshMapViewport();
      guessMapRef.current.fitBounds(bounds, 40);
    };
    const frameId = window.requestAnimationFrame(fitVisibleMap);
    const timerId = window.setTimeout(fitVisibleMap, 280);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timerId);
    };
  }, [
    clearPendingMarker,
    clearResultOverlays,
    mapsReady,
    refreshMapViewport,
    resetMapViewport,
    room,
    t,
  ]);

  useEffect(() => {
    setGuessPin(null);
    clearPendingMarker();
    clearResultOverlays();
    if (room?.phase !== "playing") {
      resetMapViewport();
    }
  }, [
    clearPendingMarker,
    clearResultOverlays,
    resetMapViewport,
    room?.round?.index,
  ]);

  useEffect(() => {
    if (!room) {
      roomFeedbackRef.current = null;
      return;
    }

    const nextSnapshot = {
      phase: room.phase,
      roundIndex: room.round?.index || 0,
      opponentLocked: Boolean(room.round?.opponent_locked),
      meSubmitted: Boolean(room.me?.has_submitted_this_round),
    };
    const previous = roomFeedbackRef.current;
    if (!previous) {
      roomFeedbackRef.current = nextSnapshot;
      return;
    }

    const phaseChanged =
      previous.phase !== nextSnapshot.phase ||
      previous.roundIndex !== nextSnapshot.roundIndex;
    if (phaseChanged) {
      if (room.phase === "countdown") {
        playFeedback("ready");
        showFeedbackBubble(t("geo_online.feedback_countdown"), "success");
      } else if (room.phase === "playing") {
        playFeedback("ready");
        showFeedbackBubble(t("geo_online.feedback_round_start"), "target");
      } else if (room.phase === "reveal") {
        playFeedback("reveal");
        showFeedbackBubble(t("geo_online.feedback_reveal"), "target");
      } else if (room.phase === "finished") {
        playFeedback("finish");
        showFeedbackBubble(t("geo_online.feedback_finished"), "success");
      }
    }

    if (
      room.phase === "playing" &&
      !nextSnapshot.meSubmitted &&
      !previous.opponentLocked &&
      nextSnapshot.opponentLocked
    ) {
      playFeedback("place");
      showFeedbackBubble(t("geo_online.feedback_opponent_locked"), "opponent");
    }

    roomFeedbackRef.current = nextSnapshot;
  }, [room, playFeedback, showFeedbackBubble, t]);

  const runAction = useCallback(async (actionName, runner) => {
    setActionBusy(actionName);
    setActionError("");
    try {
      return await runner();
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      setActionBusy("");
    }
  }, []);

  const handleReadyToggle = async () => {
    if (!room) return;
    const readying = !room.me.is_ready;
    const res = await runAction("ready", () =>
      setGeoBattleReady(room.room_id, readying),
    );
    if (applyRoomResponse(res)) {
      playFeedback("ready");
      showFeedbackBubble(
        t(
          readying
            ? "geo_online.feedback_ready"
            : "geo_online.feedback_unready",
        ),
        "success",
      );
    } else {
      playFeedback("error");
      showFeedbackBubble(t("geo_online.feedback_error"), "danger");
    }
  };

  const handleZoomOut = async () => {
    if (!room) return;
    const res = await runAction("zoom", () => zoomOutGeoBattle(room.room_id));
    if (applyRoomResponse(res)) {
      playFeedback("zoom");
      showFeedbackBubble(t("geo_online.feedback_zoom_out"), "zoom");
    } else {
      playFeedback("error");
      showFeedbackBubble(t("geo_online.feedback_error"), "danger");
    }
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
      playFeedback("lock");
      showFeedbackBubble(t("geo_online.feedback_locked"), "target");
      setGuessPin(null);
    } else {
      playFeedback("error");
      showFeedbackBubble(t("geo_online.feedback_error"), "danger");
    }
  };

  const handleGiveUp = async () => {
    if (!room) return;
    const res = await runAction("give-up", () =>
      submitGeoBattleGuess(room.room_id, { give_up: true }),
    );
    if (applyRoomResponse(res)) {
      playFeedback("skip");
      showFeedbackBubble(t("geo_online.feedback_gave_up"), "warning");
      setGuessPin(null);
    } else {
      playFeedback("error");
      showFeedbackBubble(t("geo_online.feedback_error"), "danger");
    }
  };

  const handleLeaveRoom = async () => {
    if (!room) {
      navigate("/guess/online");
      return;
    }

    await runAction("leave", () => leaveGeoBattleRoom(room.room_id));
    navigate("/guess/online");
  };

  const handleCopyCode = async () => {
    if (!room?.room_code) return;
    try {
      await navigator.clipboard.writeText(room.room_code);
      setActionNotice(t("geo_online.code_copied"));
      playFeedback("place");
      showFeedbackBubble(t("geo_online.code_copied"), "success");
      window.setTimeout(() => setActionNotice(""), 1500);
    } catch {
      setActionError(t("geo_online.copy_failed"));
      playFeedback("error");
      showFeedbackBubble(t("geo_online.copy_failed"), "danger");
    }
  };

  const imageVersion = room
    ? `${room.phase}-${room.round?.index || 0}-${room.round?.current_zoom || 0}-${room.round?.zoom_steps || 0}`
    : "0";
  const imageAvailable = Boolean(
    room?.round &&
      (room.phase === "playing" ||
        room.phase === "reveal" ||
        room.phase === "finished"),
  );
  const imageForCurrentState =
    imageAvailable && displayedImageVersion === imageVersion;
  const imageInteractionPending =
    imageAvailable && !imageForCurrentState && !imgError;
  const showImageLoading =
    imageAvailable && imageLoading && !imageObjectUrl && !imgError;
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
        imageObjectUrlRef.current = null;
        return null;
      });
      displayedImageVersionRef.current = "";
      setDisplayedImageVersion("");
      setImageLoading(false);
      setImgLoaded(false);
      setImgError(false);
      setZoomTransition(null);
      return undefined;
    }

    let cancelled = false;
    let createdUrl = null;
    let activatedUrl = false;
    const controller = new AbortController();
    const hadVisibleImage = Boolean(imageObjectUrlRef.current);
    const previousImageVersion = displayedImageVersionRef.current;
    const transitionRequestId = zoomTransitionRequestRef.current + 1;
    zoomTransitionRequestRef.current = transitionRequestId;
    setImageLoading(true);
    if (!hadVisibleImage) {
      setImgLoaded(false);
    }
    setImgError(false);

    fetchGeoBattleImage(room.room_id, imageVersion, controller.signal)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        activatedUrl = true;
        const shouldAnimateZoom =
          hadVisibleImage &&
          previousImageVersion &&
          previousImageVersion !== imageVersion &&
          room?.phase === "playing" &&
          !(
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
          );
        setImageObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          imageObjectUrlRef.current = url;
          return url;
        });
        displayedImageVersionRef.current = imageVersion;
        setDisplayedImageVersion(imageVersion);
        setImageLoading(false);
        setImgLoaded(true);
        setImgError(false);
        if (shouldAnimateZoom) {
          setZoomTransition({
            toUrl: url,
            requestId: transitionRequestId,
            animationDone: false,
          });
          if (zoomTransitionTimerRef.current) {
            window.clearTimeout(zoomTransitionTimerRef.current);
          }
          zoomTransitionTimerRef.current = window.setTimeout(() => {
            setZoomTransition((current) =>
              current?.requestId === transitionRequestId
                ? { ...current, animationDone: true }
                : current,
            );
            zoomTransitionTimerRef.current = null;
          }, SATELLITE_ZOOM_TRANSITION_MS);
        } else {
          setZoomTransition(null);
        }
      })
      .catch((err) => {
        if (cancelled || err.name === "AbortError") return;
        setImageLoading(false);
        setImgError(true);
        setImgLoaded(true);
        feedbackRef.current.playFeedback("error");
        feedbackRef.current.showFeedbackBubble(
          feedbackRef.current.t("geo_online.feedback_image_error"),
          "danger",
        );
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (createdUrl && !activatedUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [imageAvailable, room?.room_id, imageVersion]);

  useEffect(() => {
    if (!zoomTransition?.animationDone || !imgLoaded) return;
    setZoomTransition(null);
  }, [zoomTransition, imgLoaded]);

  useEffect(() => {
    return () => {
      zoomTransitionRequestRef.current += 1;
      if (zoomTransitionTimerRef.current) {
        window.clearTimeout(zoomTransitionTimerRef.current);
      }
      if (imageObjectUrlRef.current) {
        URL.revokeObjectURL(imageObjectUrlRef.current);
        imageObjectUrlRef.current = null;
      }
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
            onClick={() => navigate("/guess/online")}
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
            <LanguageSwitch />
            {room.room_code && (
              <button
                type="button"
                className="geo-battle-room-code"
                onClick={handleCopyCode}
              >
                {t("geo_online.room_code_short")}: {room.room_code}
              </button>
            )}
            <GameSoundToggle
              enabled={soundEnabled}
              onToggle={toggleSound}
              enabledLabel={t("geo.feedback_sound_on")}
              disabledLabel={t("geo.feedback_sound_off")}
            />
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
            playerRole="player"
            currentPhase={room.phase}
            t={t}
          />
          <div
            className={`geo-battle-phase-card geo-battle-phase-card--${room.phase}`}
          >
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
            playerRole="opponent"
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
                    className={`geo-battle-satellite-img ${imgLoaded ? "loaded" : ""} ${
                      zoomTransition ? "geo-battle-satellite-img--handoff" : ""
                    }`}
                    onLoad={() => setImgLoaded(true)}
                    onError={() => {
                      setImgLoaded(true);
                      setImgError(true);
                      playFeedback("error");
                      showFeedbackBubble(
                        t("geo_online.feedback_image_error"),
                        "danger",
                      );
                    }}
                    draggable={false}
                  />
                )}
                {zoomTransition && (
                  <div
                    className="geo-battle-satellite-transition"
                    aria-hidden="true"
                  >
                    <img
                      src={zoomTransition.toUrl}
                      className="geo-battle-satellite-transition-img"
                      alt=""
                      draggable={false}
                      onAnimationEnd={() =>
                        setZoomTransition((current) =>
                          current?.requestId === zoomTransition.requestId
                            ? { ...current, animationDone: true }
                            : current,
                        )
                      }
                    />
                  </div>
                )}
                {showImageLoading && (
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
                {imageObjectUrl && !imgError && (
                  <div
                    className={`geo-battle-satellite-center-pin ${
                      room.phase === "playing"
                        ? "geo-battle-satellite-center-pin--neutral"
                        : "geo-battle-satellite-center-pin--answer"
                    }`}
                    aria-label={t("geo.image_center")}
                  />
                )}
                {room.phase === "playing" && (
                  <div className="geo-battle-satellite-controls">
                    <button
                      type="button"
                      className="geo-battle-zoom-btn"
                      disabled={
                        !room.can_zoom_out ||
                        actionBusy !== "" ||
                        imageInteractionPending
                      }
                      onClick={handleZoomOut}
                      aria-busy={actionBusy === "zoom"}
                    >
                      {actionBusy === "zoom"
                        ? t("geo_online.loading")
                        : t("geo_online.zoom_out")}
                    </button>
                    <span>
                      {t("geo.zoom_out_count")}:{" "}
                      {t("geo.zoom_out_count_value", {
                        count: room.round?.zoom_steps || 0,
                      })}
                    </span>
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
              <div className="geo-battle-map-stage">
                <div ref={guessMapElRef} className="geo-battle-map" />
                {(!mapsReady || !mapReady) && (
                  <div className="geo-battle-map-loading">
                    <div className="geo-battle-spinner" />
                    <span>{t("geo_online.map_loading")}</span>
                  </div>
                )}

                {room.phase === "lobby" && (
                  <div className="geo-battle-controls geo-battle-controls--lobby">
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
                          : t("geo_online.ready")}
                    </button>
                    <button
                      type="button"
                      className="geo-battle-secondary-btn"
                      onClick={handleLeaveRoom}
                    >
                      {t("geo_online.leave_room")}
                    </button>
                  </div>
                )}

                {room.phase === "playing" && (
                  <div className="geo-battle-controls geo-battle-controls--playing">
                    {!guessPin && !room.me.has_submitted_this_round && (
                      <div className="geo-battle-click-hint">
                        {t("geo_online.place_guess")}
                      </div>
                    )}
                    <button
                      type="button"
                      className="geo-battle-primary-btn"
                      disabled={
                        !guessPin ||
                        !room.can_submit_guess ||
                        actionBusy !== "" ||
                        imageInteractionPending
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
                    <BattleScoreBreakdown
                      round={room.round}
                      remainingSeconds={remainingSeconds}
                      t={t}
                    />
                  </div>
                )}

                {(room.phase === "preparing" || room.phase === "countdown") && (
                  <div className="geo-battle-controls geo-battle-controls--status">
                    <div className="geo-battle-side-copy">
                      {room.phase === "preparing"
                        ? t("geo_online.preparing")
                        : t("geo_online.round_starts_soon")}
                    </div>
                  </div>
                )}

                {room.phase === "reveal" && (
                  <RoundResultOverlay room={room} t={t} />
                )}

                {room.phase === "finished" && (
                  <FinalResultOverlay
                    room={room}
                    outcomeLabel={outcomeLabel}
                    actionBusy={actionBusy}
                    onReady={handleReadyToggle}
                    onLeave={handleLeaveRoom}
                    t={t}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <GameFeedbackBubbles bubbles={feedbackBubbles} />
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
