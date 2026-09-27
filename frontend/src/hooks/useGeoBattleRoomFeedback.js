import { useEffect, useRef } from "react";

import {
  getRoomFeedbackSnapshot,
  getRoomTransitionFeedback,
} from "../utils/geoBattleRoomState";

/**
 * Plays a sound and shows a bubble when the room changes phase/round or the
 * opponent locks a guess. The first snapshot after (re)entering a room only
 * primes the comparison and emits nothing.
 */
function useGeoBattleRoomFeedback({
  room,
  playFeedback,
  showFeedbackBubble,
  t,
}) {
  const roomFeedbackRef = useRef(null);

  useEffect(() => {
    if (!room) {
      roomFeedbackRef.current = null;
      return;
    }

    const nextSnapshot = getRoomFeedbackSnapshot(room);
    const previous = roomFeedbackRef.current;
    if (!previous) {
      roomFeedbackRef.current = nextSnapshot;
      return;
    }

    getRoomTransitionFeedback(previous, nextSnapshot).forEach(
      ({ sound, messageKey, tone }) => {
        playFeedback(sound);
        showFeedbackBubble(t(messageKey), tone);
      },
    );

    roomFeedbackRef.current = nextSnapshot;
  }, [room, playFeedback, showFeedbackBubble, t]);
}

export { useGeoBattleRoomFeedback };
