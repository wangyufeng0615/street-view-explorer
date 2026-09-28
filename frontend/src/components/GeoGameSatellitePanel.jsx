import React from "react";

/**
 * Single-player satellite panel: current static image, zoom-out handoff
 * overlay, loading/error overlays, the always-visible center pin and the
 * zoom-out control. `panelRef` is used to measure the panel size. When the
 * round target could not be found (`targetError`) the loading overlay turns
 * into an error with a retry button; the game and its scores are kept.
 */
export default function GeoGameSatellitePanel({
  t,
  panelRef,
  phase,
  hasTarget,
  targetError,
  onRetryTarget,
  zoomSteps,
  satelliteUrl,
  imgLoaded,
  imgError,
  zoomTransition,
  zoomTransitionLoading,
  canZoomOut,
  onZoomOut,
  onImageLoad,
  onImageError,
  onTransitionAnimationEnd,
}) {
  return (
    <div ref={panelRef} className="geo-satellite">
      {satelliteUrl && (
        <img
          key={satelliteUrl}
          src={satelliteUrl}
          className={`geo-satellite-img ${
            imgLoaded ? "loaded" : ""
          } ${zoomTransition ? "geo-satellite-img--handoff" : ""}`}
          alt=""
          draggable={false}
          onLoad={() => onImageLoad()}
          onError={() => onImageError()}
        />
      )}
      {zoomTransition && (
        <div className="geo-satellite-transition" aria-hidden="true">
          <img
            src={zoomTransition.toUrl}
            className="geo-satellite-transition-img"
            alt=""
            draggable={false}
            onAnimationEnd={() =>
              onTransitionAnimationEnd(zoomTransition.requestId)
            }
          />
        </div>
      )}
      {phase === "LOADING" && targetError && (
        <div
          className="geo-loading-overlay geo-loading-overlay--error"
          role="alert"
        >
          <span>{t("geo.target_error")}</span>
          <button
            type="button"
            className="geo-zoom-out-btn geo-target-retry-btn"
            onClick={onRetryTarget}
          >
            {t("geo.target_retry")}
          </button>
        </div>
      )}
      {((phase === "LOADING" && !targetError) ||
        ((phase === "PLAYING" || phase === "ROUND_RESULT") &&
          !imgLoaded &&
          !zoomTransition)) && (
        <div className="geo-loading-overlay">
          <div className="geo-loading-spinner" />
          {phase === "LOADING" ? t("geo.loading") : ""}
        </div>
      )}
      {imgError && phase === "PLAYING" && (
        <div className="geo-loading-overlay">
          <span>{t("geo.image_error")}</span>
        </div>
      )}
      {hasTarget && (phase === "PLAYING" || phase === "ROUND_RESULT") && (
        <div
          className={`geo-satellite-center-pin ${
            phase === "ROUND_RESULT"
              ? "geo-satellite-center-pin--answer"
              : "geo-satellite-center-pin--neutral"
          }`}
          aria-label={t("geo.image_center")}
        />
      )}
      {phase === "PLAYING" && (
        <div className="geo-satellite-controls">
          <button
            className="geo-zoom-out-btn geo-zoom-out-btn--satellite"
            disabled={!canZoomOut}
            onClick={onZoomOut}
            aria-busy={zoomTransitionLoading}
          >
            {t("geo.zoom_out")}
          </button>
          <span>
            {t("geo.zoom_out_count")}:{" "}
            {t("geo.zoom_out_count_value", { count: zoomSteps })}
          </span>
        </div>
      )}
    </div>
  );
}
