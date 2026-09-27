// Pure helpers that derive UI state from an online duel room snapshot.

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

/** Cache key for the satellite image the current room state should show. */
function getBattleImageVersion(room) {
  return room
    ? `${room.phase}-${room.round?.index || 0}-${room.round?.current_zoom || 0}-${room.round?.zoom_steps || 0}`
    : "0";
}

/**
 * Everything the guess map's phase/result overlays depend on. Polling returns
 * a new room object every few seconds (server_time changes), so the overlay
 * effect keys on this instead of the room identity to avoid redrawing and
 * refitting the result map while the player is looking at it.
 */
function getBattleResultOverlayKey(room) {
  if (!room) return "";
  const round = room.round;
  const point = (value) =>
    value?.lat != null && value?.lng != null
      ? `${value.lat},${value.lng}`
      : "-";
  return [
    room.phase,
    round?.index ?? "-",
    point(round?.target),
    point(round?.my_guess),
    point(round?.opponent_guess),
  ].join("|");
}

/** The server only serves the round image in playing/reveal/finished. */
function isBattleImageAvailable(room) {
  return Boolean(
    room?.round &&
      (room.phase === "playing" ||
        room.phase === "reveal" ||
        room.phase === "finished"),
  );
}

/** Marks a zoom handoff as finished, ignoring stale request ids. */
function completeZoomTransition(current, requestId) {
  return current?.requestId === requestId
    ? { ...current, animationDone: true }
    : current;
}

/** The subset of a room snapshot that drives transition feedback. */
function getRoomFeedbackSnapshot(room) {
  return {
    phase: room.phase,
    roundIndex: room.round?.index || 0,
    opponentLocked: Boolean(room.round?.opponent_locked),
    meSubmitted: Boolean(room.me?.has_submitted_this_round),
  };
}

const PHASE_FEEDBACK = {
  countdown: {
    sound: "ready",
    messageKey: "geo_online.feedback_countdown",
    tone: "success",
  },
  playing: {
    sound: "ready",
    messageKey: "geo_online.feedback_round_start",
    tone: "target",
  },
  reveal: {
    sound: "reveal",
    messageKey: "geo_online.feedback_reveal",
    tone: "target",
  },
  finished: {
    sound: "finish",
    messageKey: "geo_online.feedback_finished",
    tone: "success",
  },
};

/**
 * Returns the sound + bubble events to emit when the room moves from the
 * previous feedback snapshot to the next one, in emission order.
 */
function getRoomTransitionFeedback(previous, next) {
  const events = [];
  const phaseChanged =
    previous.phase !== next.phase || previous.roundIndex !== next.roundIndex;
  if (phaseChanged && PHASE_FEEDBACK[next.phase]) {
    events.push(PHASE_FEEDBACK[next.phase]);
  }

  if (
    next.phase === "playing" &&
    !next.meSubmitted &&
    !previous.opponentLocked &&
    next.opponentLocked
  ) {
    events.push({
      sound: "place",
      messageKey: "geo_online.feedback_opponent_locked",
      tone: "opponent",
    });
  }

  return events;
}

export {
  getRoomMessage,
  getBattleImageVersion,
  getBattleResultOverlayKey,
  isBattleImageAvailable,
  completeZoomTransition,
  getRoomFeedbackSnapshot,
  getRoomTransitionFeedback,
};
