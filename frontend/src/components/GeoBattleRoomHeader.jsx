import React from "react";

import { PlayerStatusCard } from "./GeoBattleResults";
import { GameSoundToggle } from "./GameFeedback";
import LanguageSwitch from "./LanguageSwitch";
import { getRoomMessage } from "../utils/geoBattleRoomState";

function GeoBattleRoomTopBar({
  room,
  syncFailures,
  soundEnabled,
  onToggleSound,
  onLeave,
  onCopyCode,
  t,
}) {
  return (
    <div className="geo-battle-topbar">
      <button className="geo-battle-back" type="button" onClick={onLeave}>
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
            onClick={onCopyCode}
          >
            {t("geo_online.room_code_short")}: {room.room_code}
          </button>
        )}
        <GameSoundToggle
          enabled={soundEnabled}
          onToggle={onToggleSound}
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
  );
}

/** Red "you" card, phase/round/timer card, blue opponent card. */
function GeoBattleStatusBar({ room, remainingSeconds, t }) {
  return (
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
        <div className="geo-battle-phase-main">{getRoomMessage(room, t)}</div>
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
  );
}

export { GeoBattleRoomTopBar, GeoBattleStatusBar };
