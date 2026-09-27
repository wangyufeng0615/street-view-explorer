import React from "react";
import LanguageSwitch from "./LanguageSwitch";
import { GameSoundToggle } from "./GameFeedback";
import { MarkerPin, formatScoreboardScore } from "./GeoGameResults";
import { TOTAL_ROUNDS } from "../utils/geoGameUtils";

/** Single-player top bar: back link, round progress, scores, sound, language. */
export default function GeoGameTopBar({
  t,
  navigate,
  round,
  playerScore,
  atlasScore,
  soundEnabled,
  onToggleSound,
}) {
  return (
    <div className="geo-topbar">
      <div className="geo-topbar-left">
        <button className="geo-topbar-back" onClick={() => navigate("/")}>
          ← {t("geo.back")}
        </button>
        <span className="geo-topbar-title">{t("geo.title")}</span>
      </div>
      <div className="geo-topbar-right">
        {round > 0 && (
          <>
            <span className="geo-score-badge geo-score-badge--round">
              {t("geo.round_progress", {
                current: round,
                total: TOTAL_ROUNDS,
              })}
            </span>
            <span className="geo-score-badge geo-score-badge--player">
              <MarkerPin type="player" />
              {t("geo.you")}: {formatScoreboardScore(t, playerScore)}
            </span>
            {atlasScore !== null && (
              <span className="geo-score-badge geo-score-badge--atlas">
                <MarkerPin type="atlas" />
                Atlas: {formatScoreboardScore(t, atlasScore)}
              </span>
            )}
          </>
        )}
        <GameSoundToggle
          enabled={soundEnabled}
          onToggle={onToggleSound}
          enabledLabel={t("geo.feedback_sound_on")}
          disabledLabel={t("geo.feedback_sound_off")}
        />
        <LanguageSwitch className="geo-topbar-language" />
      </div>
    </div>
  );
}
