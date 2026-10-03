import React from "react";

import {
  getOutcomeLabel,
  BattleScoreBreakdown,
  RoundResultOverlay,
  FinalResultOverlay,
} from "./GeoBattleResults";

/**
 * Guess map container plus the phase-specific controls and result overlays
 * rendered on top of it. `guessMapElRef` must stay attached to the same
 * element for the lifetime of the room, since Google Maps mounts into it.
 */
function GeoBattleMapPanel({
  room,
  guessMapElRef,
  mapsReady,
  mapReady,
  mapsError,
  guessPin,
  actionBusy,
  imageInteractionPending,
  remainingSeconds,
  onReadyToggle,
  onLeave,
  onSubmitGuess,
  onGiveUp,
  t,
}) {
  return (
    <div className="geo-battle-map-panel">
      <div className="geo-battle-map-stage">
        {/* 地图加载失败只替换地图本身，准备、结算等操作层照常显示，房间仍能开局和看结果 */}
        {mapsError ? (
          <div className="geo-battle-map-error" role="alert">
            {t("geo_online.map_error")}
          </div>
        ) : (
          <div ref={guessMapElRef} className="geo-battle-map" />
        )}
        {!mapsError && (!mapsReady || !mapReady) && (
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
              onClick={onReadyToggle}
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
              onClick={onLeave}
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
              onClick={onSubmitGuess}
            >
              {actionBusy === "guess"
                ? t("geo_online.loading")
                : t("geo_online.submit_guess")}
            </button>
            <button
              type="button"
              className="geo-battle-secondary-btn"
              disabled={!room.can_submit_guess || actionBusy !== ""}
              onClick={onGiveUp}
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

        {room.phase === "reveal" && <RoundResultOverlay room={room} t={t} />}

        {room.phase === "finished" && (
          <FinalResultOverlay
            room={room}
            outcomeLabel={getOutcomeLabel(room, t)}
            actionBusy={actionBusy}
            onReady={onReadyToggle}
            onLeave={onLeave}
            t={t}
          />
        )}
      </div>
    </div>
  );
}

export { GeoBattleMapPanel };
