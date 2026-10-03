import React, { memo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import AiDescription from "../AiDescription";
import useStore from "../../store/useStore";
import { formatAddress } from "../../utils/addressUtils";

function formatCoordinates(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  const latText = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const lngText = `${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "E" : "W"}`;
  return `${latText}  ${lngText}`;
}

// "再多讲讲"要带上当前视角；只在点击时读取，拖动街景时来信不跟着重渲染
function readCurrentView() {
  const { streetViewView, heading } = useStore.getState();
  return streetViewView || { heading, pitch: 0, fov: 90 };
}

/**
 * Atlas's full narration as a letter in the right column: always open, with
 * sources and the "tell me more" follow-up, so reading never takes a click.
 */
const AtlasLetter = memo(function AtlasLetter({
  location,
  description,
  citations,
  researchStatus,
  isLoadingDesc,
  isLocationLoading,
  descError,
  descRetries,
  onRetry,
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || "en";
  const bodyRef = useRef(null);
  const placeName = location ? formatAddress(location, language) : "";
  const coords = formatCoordinates(location?.latitude, location?.longitude);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [location?.pano_id]);

  return (
    <section className="atlas-letter" aria-label={t("home.letter.label")}>
      <header className="atlas-letter__header">
        <span className="atlas-letter__place">
          {placeName ||
            (isLocationLoading
              ? t("home.departing")
              : t("home.arrival.failed"))}
        </span>
        {coords && <span className="atlas-letter__coords">{coords}</span>}
      </header>
      <div className="atlas-letter__body atlas-transcript" ref={bodyRef}>
        <AiDescription
          isLoading={isLoadingDesc || isLocationLoading}
          error={descError}
          description={description}
          citations={citations}
          researchStatus={researchStatus}
          retries={descRetries}
          panoId={location?.pano_id}
          getView={readCurrentView}
          onRetry={onRetry}
        />
      </div>
    </section>
  );
});

export default AtlasLetter;
