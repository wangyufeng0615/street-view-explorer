import React, { memo, useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { loadGoogleMapsScript, loadMarkerLibrary } from "../utils/googleMaps";
import {
  removeMapListener,
  removeMarker,
  setMarkerPosition,
} from "../utils/mapMarkers";
import PickStatusOverlay from "./PickStatusOverlay";

function PreviewMap({
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
  const onLocationPickRef = useRef(onLocationPick);
  const isPickingLocationRef = useRef(isPickingLocation);
  // 地图只创建一次；坐标变化由 syncMapToPosition 移动中心点和标记
  const positionRef = useRef({ latitude, longitude });
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    positionRef.current = { latitude, longitude };
  }, [latitude, longitude]);

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

      let position = {
        lat: Number(positionRef.current.latitude),
        lng: Number(positionRef.current.longitude),
      };

      // 创建地图实例
      mapInstanceRef.current = new maps.Map(mapRef.current, {
        mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
        center: position,
        zoom: 13,
        mapTypeId: "roadmap",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        // 放大后的选点地图需要能缩放；侧栏小地图上盖着展开按钮，不放控件
        zoomControl: Boolean(onLocationPickRef.current),
        disableDefaultUI: true,
        // 侧栏小地图不接收键盘操作，版权行里就不放"键盘快捷键"入口
        keyboardShortcuts: Boolean(onLocationPickRef.current),
        gestureHandling: onLocationPickRef.current ? "greedy" : "auto",
        scrollwheel: Boolean(onLocationPickRef.current),
        draggableCursor: onLocationPickRef.current ? "crosshair" : undefined,
        draggingCursor: "grabbing",
        zoomControlOptions: {
          position: maps.ControlPosition.RIGHT_TOP,
        },
      });

      // 只有点击才出发；拖动只是挪地图看看，不跳走
      if (onLocationPickRef.current) {
        clickListenerRef.current = mapInstanceRef.current.addListener(
          "click",
          (event) => {
            pickFromLatLng(event.latLng, "click");
          },
        );
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
      await loadMarkerLibrary(maps);
      if (!mapInstanceRef.current) return;
      // 等标记库期间可能已经换了站：按最新坐标放标记、定中心
      const latest = {
        lat: Number(positionRef.current.latitude),
        lng: Number(positionRef.current.longitude),
      };
      if (Number.isFinite(latest.lat) && Number.isFinite(latest.lng)) {
        position = latest;
      }
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
      setMapLoadFailed(false);
    } catch (err) {
      console.error("PreviewMap initialization error:", err);
      setMapLoadFailed(true);
    }
  }, [pickFromLatLng]);

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

  if (mapLoadFailed) {
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
        {t("error.mapLoadFailed")}
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

export default memo(PreviewMap);
