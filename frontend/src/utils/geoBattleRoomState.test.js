import { describe, expect, it } from "vitest";
import {
  getBattleResultOverlayKey,
  getRoomFeedbackSnapshot,
  getRoomMessage,
  getRoomTransitionFeedback,
} from "./geoBattleRoomState";

const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

describe("getRoomMessage", () => {
  it("maps server message codes and falls back to the phase label", () => {
    expect(getRoomMessage(null, t)).toBe("");
    expect(getRoomMessage({ message: "player_left:Bob:2" }, t)).toBe(
      'geo_online.left_notice:{"name":"Bob:2"}',
    );
    expect(getRoomMessage({ message: "prepare_failed" }, t)).toBe(
      "geo_online.prepare_failed",
    );
    expect(getRoomMessage({ message: "time_up" }, t)).toBe("geo.time_up");
    expect(getRoomMessage({ message: "custom text" }, t)).toBe("custom text");
    expect(getRoomMessage({ message: "", phase: "reveal" }, t)).toBe(
      "geo_online.phase_reveal",
    );
  });
});

describe("room transition feedback", () => {
  const playing = (overrides = {}) =>
    getRoomFeedbackSnapshot({
      phase: "playing",
      round: { index: 1, opponent_locked: false },
      me: { has_submitted_this_round: false },
      ...overrides,
    });

  it("emits one event per phase change and nothing for unchanged or silent phases", () => {
    const lobby = getRoomFeedbackSnapshot({ phase: "lobby" });
    const countdown = getRoomFeedbackSnapshot({ phase: "countdown" });
    expect(getRoomTransitionFeedback(lobby, countdown)).toEqual([
      {
        sound: "ready",
        messageKey: "geo_online.feedback_countdown",
        tone: "success",
      },
    ]);
    expect(getRoomTransitionFeedback(countdown, countdown)).toEqual([]);
    expect(
      getRoomTransitionFeedback(
        countdown,
        getRoomFeedbackSnapshot({ phase: "preparing" }),
      ),
    ).toEqual([]);

    const reveal = { ...playing(), phase: "reveal" };
    expect(getRoomTransitionFeedback(playing(), reveal)[0].sound).toBe(
      "reveal",
    );
    const nextRound = playing({ round: { index: 2 } });
    expect(getRoomTransitionFeedback(reveal, nextRound)).toEqual([
      {
        sound: "ready",
        messageKey: "geo_online.feedback_round_start",
        tone: "target",
      },
    ]);
  });

  it("announces the opponent locking only while I am still guessing", () => {
    const locked = playing({ round: { index: 1, opponent_locked: true } });
    expect(getRoomTransitionFeedback(playing(), locked)).toEqual([
      {
        sound: "place",
        messageKey: "geo_online.feedback_opponent_locked",
        tone: "opponent",
      },
    ]);
    expect(getRoomTransitionFeedback(locked, locked)).toEqual([]);

    const lockedAfterMe = playing({
      round: { index: 1, opponent_locked: true },
      me: { has_submitted_this_round: true },
    });
    expect(getRoomTransitionFeedback(playing(), lockedAfterMe)).toEqual([]);
  });

  it("orders the round start before an opponent lock seen in the same snapshot", () => {
    const reveal = { ...playing(), phase: "reveal" };
    const lockedNextRound = playing({
      round: { index: 2, opponent_locked: true },
    });
    expect(
      getRoomTransitionFeedback(reveal, lockedNextRound).map(
        (event) => event.messageKey,
      ),
    ).toEqual([
      "geo_online.feedback_round_start",
      "geo_online.feedback_opponent_locked",
    ]);
  });
});

describe("getBattleResultOverlayKey", () => {
  const reveal = {
    phase: "reveal",
    server_time: "2026-09-27T00:00:01Z",
    round: {
      index: 2,
      target: { lat: 1, lng: 2 },
      my_guess: { lat: 3, lng: 4, score: 100 },
      opponent_guess: { skipped: true },
    },
  };

  it("ignores polling-only fields such as server time and scores", () => {
    const polled = {
      ...reveal,
      server_time: "2026-09-27T00:00:03Z",
      round: { ...reveal.round, my_guess: { lat: 3, lng: 4, score: 999 } },
    };
    expect(getBattleResultOverlayKey(polled)).toBe(
      getBattleResultOverlayKey(reveal),
    );
  });

  it("changes with phase, round, target and guess positions", () => {
    const base = getBattleResultOverlayKey(reveal);
    expect(
      getBattleResultOverlayKey({ ...reveal, phase: "finished" }),
    ).not.toBe(base);
    expect(
      getBattleResultOverlayKey({
        ...reveal,
        round: { ...reveal.round, index: 3 },
      }),
    ).not.toBe(base);
    expect(
      getBattleResultOverlayKey({
        ...reveal,
        round: { ...reveal.round, opponent_guess: { lat: 5, lng: 6 } },
      }),
    ).not.toBe(base);
    expect(getBattleResultOverlayKey(null)).toBe("");
  });
});
