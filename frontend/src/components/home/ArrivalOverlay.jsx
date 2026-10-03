import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { CompassGlyph } from "./HomeGlyphs";

function pickDepartureLine(t) {
  const messages = t("globalLoadingMessages", { returnObjects: true });
  if (!Array.isArray(messages) || messages.length === 0) {
    return t("home.departing");
  }
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Covers the gap between pressing "next stop" and the panorama painting with
 * a departure line; the place name lives in the letter on the right. A
 * failed departure stays on the same card with a way forward, so the nav and
 * dock remain usable instead of the whole page turning into an error screen.
 */
export default function ArrivalOverlay({
  visible,
  error = null,
  onRetry,
  onGoRandom = null,
  busy = false,
}) {
  const { t, i18n } = useTranslation();

  const language = i18n.resolvedLanguage;
  // 每次出发换一句，切换语言时跟着换；淡出过程中保持原句，不在消失前一瞬间跳字
  const [departure, setDeparture] = useState(() => ({
    visible,
    language,
    line: pickDepartureLine(t),
  }));
  if (departure.visible !== visible || departure.language !== language) {
    const startsOver =
      (visible && !departure.visible) || departure.language !== language;
    setDeparture({
      visible,
      language,
      line: startsOver ? pickDepartureLine(t) : departure.line,
    });
  }
  const departureLine = departure.line;

  if (error) {
    return (
      <div className="home-arrival is-visible">
        <div
          className="home-arrival__card home-arrival__card--error home-panel"
          role="alert"
        >
          <span className="home-arrival__place">
            {t("home.arrival.failed")}
          </span>
          <p className="home-arrival__error">{error}</p>
          <div className="home-arrival__actions">
            {onGoRandom && (
              <button
                type="button"
                className="home-arrival__secondary"
                onClick={onGoRandom}
                disabled={busy}
              >
                {t("home.arrival.goRandom")}
              </button>
            )}
            <button
              type="button"
              className="home-button-primary home-arrival__retry"
              onClick={onRetry}
              // 正在切换随机模式时不能同时重试，否则会按旧的兴趣再找一次
              disabled={busy}
            >
              {t("home.arrival.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 地名在右侧来信里常驻，这里只给一句出发提示，不闪地址
  return (
    <div
      className={`home-arrival${visible ? " is-visible" : ""}`}
      aria-hidden={!visible}
    >
      <div className="home-arrival__card home-bare" role="status">
        <span className="home-arrival__compass" aria-hidden="true">
          <CompassGlyph size={22} strokeWidth={1.6} />
        </span>
        <span className="home-arrival__place">{departureLine}</span>
      </div>
    </div>
  );
}
