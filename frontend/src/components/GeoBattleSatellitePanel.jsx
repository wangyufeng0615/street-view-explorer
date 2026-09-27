import React from "react";

/**
 * Satellite image of the current round with the zoom handoff layer, the
 * always-visible center pin and the zoom-out control while playing.
 */
function GeoBattleSatellitePanel({ room, image, actionBusy, onZoomOut, t }) {
  const {
    imageAvailable,
    imageObjectUrl,
    imgLoaded,
    imgError,
    showImageLoading,
    imageInteractionPending,
    zoomTransition,
    handleImageLoad,
    handleImageError,
    handleTransitionEnd,
  } = image;

  return (
    <div className="geo-battle-satellite">
      {imageAvailable ? (
        <>
          {imageObjectUrl && (
            <img
              key={imageObjectUrl}
              src={imageObjectUrl}
              alt=""
              className={`geo-battle-satellite-img ${imgLoaded ? "loaded" : ""} ${
                zoomTransition ? "geo-battle-satellite-img--handoff" : ""
              }`}
              onLoad={handleImageLoad}
              onError={handleImageError}
              draggable={false}
            />
          )}
          {zoomTransition && (
            <div className="geo-battle-satellite-transition" aria-hidden="true">
              <img
                src={zoomTransition.toUrl}
                className="geo-battle-satellite-transition-img"
                alt=""
                draggable={false}
                onAnimationEnd={() =>
                  handleTransitionEnd(zoomTransition.requestId)
                }
              />
            </div>
          )}
          {showImageLoading && (
            <div className="geo-battle-overlay">
              <div className="geo-battle-spinner" />
              <span>{t("geo_online.loading_image")}</span>
            </div>
          )}
          {imgError && (
            <div className="geo-battle-overlay">
              <span>{t("geo_online.image_error")}</span>
            </div>
          )}
          {imageObjectUrl && !imgError && (
            <div
              className={`geo-battle-satellite-center-pin ${
                room.phase === "playing"
                  ? "geo-battle-satellite-center-pin--neutral"
                  : "geo-battle-satellite-center-pin--answer"
              }`}
              aria-label={t("geo.image_center")}
            />
          )}
          {room.phase === "playing" && (
            <div className="geo-battle-satellite-controls">
              <button
                type="button"
                className="geo-battle-zoom-btn"
                disabled={
                  !room.can_zoom_out ||
                  actionBusy !== "" ||
                  imageInteractionPending
                }
                onClick={onZoomOut}
                aria-busy={actionBusy === "zoom"}
              >
                {actionBusy === "zoom"
                  ? t("geo_online.loading")
                  : t("geo_online.zoom_out")}
              </button>
              <span>
                {t("geo.zoom_out_count")}:{" "}
                {t("geo.zoom_out_count_value", {
                  count: room.round?.zoom_steps || 0,
                })}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="geo-battle-overlay geo-battle-overlay--placeholder">
          <span>{t("geo_online.waiting_image")}</span>
        </div>
      )}
    </div>
  );
}

export { GeoBattleSatellitePanel };
