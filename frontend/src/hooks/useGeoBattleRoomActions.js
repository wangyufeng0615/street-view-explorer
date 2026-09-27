import { useCallback, useEffect, useRef, useState } from "react";

import {
  leaveGeoBattleRoom,
  setGeoBattleReady,
  submitGeoBattleGuess,
  zoomOutGeoBattle,
} from "../services/api";

const LOBBY_PATH = "/guess/online";
const COPY_NOTICE_MS = 1500;

/**
 * Player actions in a duel room (ready, zoom out, lock guess, give up, leave,
 * copy room code). `actionBusy` names the in-flight action ("" when idle) so
 * the UI can disable every action button while one is running.
 */
function useGeoBattleRoomActions({
  room,
  guessPin,
  setGuessPin,
  applyRoomResponse,
  setActionError,
  setActionNotice,
  playFeedback,
  showFeedbackBubble,
  navigate,
  t,
}) {
  const [actionBusy, setActionBusy] = useState("");
  const copyNoticeTimerRef = useRef(null);

  useEffect(
    () => () => {
      window.clearTimeout(copyNoticeTimerRef.current);
    },
    [],
  );

  const runAction = useCallback(
    async (actionName, runner) => {
      setActionBusy(actionName);
      setActionError("");
      try {
        return await runner();
      } catch (error) {
        return { success: false, error: error.message };
      } finally {
        setActionBusy("");
      }
    },
    [setActionError],
  );

  const showActionFailed = () => {
    playFeedback("error");
    showFeedbackBubble(t("geo_online.feedback_error"), "danger");
  };

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
      showActionFailed();
    }
  };

  const handleZoomOut = async () => {
    if (!room) return;
    const res = await runAction("zoom", () => zoomOutGeoBattle(room.room_id));
    if (applyRoomResponse(res)) {
      playFeedback("zoom");
      showFeedbackBubble(t("geo_online.feedback_zoom_out"), "zoom");
    } else {
      showActionFailed();
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
      showActionFailed();
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
      showActionFailed();
    }
  };

  const handleLeaveRoom = async () => {
    if (!room) {
      navigate(LOBBY_PATH);
      return;
    }

    await runAction("leave", () => leaveGeoBattleRoom(room.room_id));
    navigate(LOBBY_PATH);
  };

  const handleCopyCode = async () => {
    if (!room?.room_code) return;
    try {
      await navigator.clipboard.writeText(room.room_code);
      setActionNotice(t("geo_online.code_copied"));
      playFeedback("place");
      showFeedbackBubble(t("geo_online.code_copied"), "success");
      // Restart the timer so a second copy keeps its notice for the full time.
      window.clearTimeout(copyNoticeTimerRef.current);
      copyNoticeTimerRef.current = window.setTimeout(() => {
        copyNoticeTimerRef.current = null;
        setActionNotice("");
      }, COPY_NOTICE_MS);
    } catch {
      setActionError(t("geo_online.copy_failed"));
      playFeedback("error");
      showFeedbackBubble(t("geo_online.copy_failed"), "danger");
    }
  };

  return {
    actionBusy,
    handleReadyToggle,
    handleZoomOut,
    handleSubmitGuess,
    handleGiveUp,
    handleLeaveRoom,
    handleCopyCode,
  };
}

export { useGeoBattleRoomActions, LOBBY_PATH };
