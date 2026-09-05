import React, { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { loadGoogleMapsScript } from "../utils/googleMaps";

function removeMapListener(listenerRef) {
  if (listenerRef.current) {
    listenerRef.current.remove();
    listenerRef.current = null;
  }
}

function removeMarker(markerRef) {
  if (!markerRef.current) return;

  if (typeof markerRef.current.setMap === "function") {
    markerRef.current.setMap(null);
  } else {
    markerRef.current.map = null;
  }
  markerRef.current = null;
}

function setMarkerPosition(marker, position) {
  if (!marker) return;

  if (typeof marker.setPosition === "function") {
    marker.setPosition(position);
    return;
  }
  marker.position = position;
}

function PickStatusOverlay({ status, message }) {
  if (!message || status === "idle") {
    return null;
  }

  const isError = status === "error";
  const isSuccess = status === "success";

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: "10px",
        transform: "translateX(-50%)",
        maxWidth: "calc(100% - 24px)",
        padding: "6px 10px",
        borderRadius: "999px",
        background: isError
          ? "rgba(127, 29, 29, 0.9)"
          : isSuccess
            ? "rgba(20, 83, 45, 0.9)"
            : "rgba(15, 23, 42, 0.88)",
        color: "#fff",
        fontSize: "12px",
        lineHeight: 1.3,
        textAlign: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        pointerEvents: "none",
        zIndex: 2,
        boxShadow: "0 8px 20px rgba(15, 23, 42, 0.25)",
      }}
    >
      {message}
    </div>
  );
}

export default function PreviewMap({
  latitude,
  longitude,
  mapId = "preview",
  onLocationPick,
  isPickingLocation = false,
  pickStatus = "idle",
  pickMessage = "",
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerInstanceRef = useRef(null);
  const mapsApiRef = useRef(null);
  const clickListenerRef = useRef(null);
  const dragEndListenerRef = useRef(null);
  const onLocationPickRef = useRef(onLocationPick);
  const isPickingLocationRef = useRef(isPickingLocation);
  const [error, setError] = useState(null);
  const { t } = useTranslation();

  useEffect(() => {
    onLocationPickRef.current = onLocationPick;
  }, [onLocationPick]);

  useEffect(() => {
    isPickingLocationRef.current = isPickingLocation;
  }, [isPickingLocation]);

  const pickFromLatLng = useCallback(
    (latLng, inputType) => {
      const handler = onLocationPickRef.current;
      if (!handler || !latLng || isPickingLocationRef.current) return;

      const lat = latLng.lat();
      const lng = latLng.lng();
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      handler({
        lat,
        lng,
        mapId,
        inputType,
      });
    },
    [mapId],
  );

  const syncMapToPosition = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const position = { lat, lng };
    if (mapsApiRef.current?.event) {
      mapsApiRef.current.event.trigger(map, "resize");
    }
    map.setCenter(position);
    setMarkerPosition(markerInstanceRef.current, position);
  }, [latitude, longitude]);

  const initMap = useCallback(async () => {
    if (!mapRef.current) return;

    try {
      const maps = await loadGoogleMapsScript();
      mapsApiRef.current = maps;
      if (!mapRef.current) return;

      // 清理之前的实例
      if (mapInstanceRef.current) {
        mapInstanceRef.current = null;
      }
      removeMarker(markerInstanceRef);
      removeMapListener(clickListenerRef);
      removeMapListener(dragEndListenerRef);

      const position = { lat: latitude, lng: longitude };

      // 创建地图实例
      mapInstanceRef.current = new maps.Map(mapRef.current, {
        mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
        center: position,
        zoom: 13,
        mapTypeId: "roadmap",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: true,
        disableDefaultUI: true,
        gestureHandling: onLocationPickRef.current ? "greedy" : "auto",
        scrollwheel: false,
        draggableCursor: onLocationPickRef.current ? "crosshair" : undefined,
        draggingCursor: "grabbing",
        zoomControlOptions: {
          position: maps.ControlPosition.RIGHT_TOP,
        },
      });

      if (onLocationPickRef.current) {
        clickListenerRef.current = mapInstanceRef.current.addListener(
          "click",
          (event) => {
            pickFromLatLng(event.latLng, "click");
          },
        );
        dragEndListenerRef.current = mapInstanceRef.current.addListener(
          "dragend",
          () => {
            pickFromLatLng(mapInstanceRef.current?.getCenter(), "drag");
          },
        );
      }

      // 只添加一次样式
      if (!document.querySelector("#previewmap-styles")) {
        const style = document.createElement("style");
        style.id = "previewmap-styles";
        style.textContent = `
                    .gm-style-cc { display: none; }
                    a[href^="http://maps.google.com/maps"]{display:none !important}
                    a[href^="https://maps.google.com/maps"]{display:none !important}
                    .gmnoprint a, .gmnoprint span, .gm-style-cc {
                        display:none;
                    }
                    .gmnoprint div {
                        background:none !important;
                    }
                `;
        document.head.appendChild(style);
      }

      // 创建图钉标记
      const pin = document.createElement("div");
      pin.innerHTML = `
                <svg width="32" height="32" viewBox="0 0 32 32" style="display: block;">
                    <path d="M16 0C10.477 0 6 4.477 6 10c0 7 10 22 10 22s10-15 10-22c0-5.523-4.477-10-10-10zm0 14a4 4 0 110-8 4 4 0 010 8z" 
                          fill="#FF4444" 
                          stroke="#FFFFFF" 
                          stroke-width="1.5"/>
                </svg>
            `;
      pin.style.width = "32px";
      pin.style.height = "32px";

      // 创建标记点
      if (maps.marker?.AdvancedMarkerElement) {
        markerInstanceRef.current = new maps.marker.AdvancedMarkerElement({
          map: mapInstanceRef.current,
          position,
          content: pin,
          zIndex: 1000,
          anchorLeft: "-50%",
          anchorTop: "-100%",
        });
      } else if (maps.Marker) {
        markerInstanceRef.current = new maps.Marker({
          map: mapInstanceRef.current,
          position,
          zIndex: 1000,
        });
      }

      // 确保地图中心点和标记位置一致
      mapInstanceRef.current.setCenter(position);

      // 清除错误状态
      setError(null);
    } catch (err) {
      console.error("PreviewMap initialization error:", err);
      setError(t("error.mapLoadFailed"));
    }
  }, [latitude, longitude, pickFromLatLng, t]);

  useEffect(() => {
    let isMounted = true;

    // 延迟执行以避免与其他地图组件的竞态条件
    const timeoutId = setTimeout(() => {
      if (isMounted) {
        initMap();
      }
    }, 100); // 比GlobalMap稍微延迟一点

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);

      // 清理地图实例
      removeMarker(markerInstanceRef);
      removeMapListener(clickListenerRef);
      removeMapListener(dragEndListenerRef);
      if (mapInstanceRef.current) {
        mapInstanceRef.current = null;
      }
    };
  }, [initMap]);

  useEffect(() => {
    if (!mapRef.current) return undefined;

    let frameId = 0;
    const requestSync = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(syncMapToPosition);
    };

    const ResizeObserverCtor = window.ResizeObserver;
    const resizeObserver = ResizeObserverCtor
      ? new ResizeObserverCtor(requestSync)
      : null;

    resizeObserver?.observe(mapRef.current);
    window.addEventListener("resize", requestSync);
    window.addEventListener("orientationchange", requestSync);
    requestSync();

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", requestSync);
      window.removeEventListener("orientationchange", requestSync);
    };
  }, [syncMapToPosition]);

  if (error) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f5f5f5",
          borderRadius: "8px",
          color: "#666",
        }}
      >
        {error}
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        borderRadius: "8px",
        overflow: "hidden",
      }}
    >
      <div
        ref={mapRef}
        style={{
          width: "100%",
          height: "100%",
          cursor: isPickingLocation ? "progress" : undefined,
        }}
      />
      <PickStatusOverlay status={pickStatus} message={pickMessage} />
    </div>
  );
}
