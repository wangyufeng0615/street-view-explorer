import React from "react";
import { RoundResult } from "./GeoGameResults";

/**
 * Single-player guess panel: Google Maps container (`mapElRef`), lock-in /
 * give-up controls while playing, and the round result after lock-in.
 */
export default function GeoGameGuessPanel({
  t,
  state,
  mapElRef,
  mapsReady,
  mapsError,
  onLockIn,
  onGiveUp,
  onNextRound,
}) {
  return (
    <div className="geo-guess-panel">
      <div className="geo-guess-map-area">
        {mapsError ? (
          <div className="geo-map-error">{t("geo.map_error")}</div>
        ) : (
          <>
            <div ref={mapElRef} className="geo-map-container" />
            {!mapsReady && (
              <div className="geo-map-loading">
                <div className="geo-loading-spinner" />
                <span>{t("geo.map_loading")}</span>
              </div>
            )}
          </>
        )}
      </div>
      {state.phase === "PLAYING" && (
        <div className="geo-guess-controls">
          {!state.guessPin && (
            <span className="geo-click-hint">{t("geo.click_map")}</span>
          )}
          <button
            className="geo-lock-in"
            disabled={!state.guessPin}
            onClick={onLockIn}
          >
            {t("geo.lock_in")}
          </button>
          <button className="geo-give-up" onClick={onGiveUp}>
            {t("geo.give_up")}
          </button>
        </div>
      )}
      {state.phase === "ROUND_RESULT" && (
        <RoundResult state={state} t={t} onNext={onNextRound} />
      )}
    </div>
  );
}
