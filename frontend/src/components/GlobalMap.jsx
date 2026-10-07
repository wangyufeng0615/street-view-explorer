import React, { memo, useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { loadGoogleMapsScript, loadMarkerLibrary } from "../utils/googleMaps";
import {
  removeMapListener,
  removeMarker,
  setMarkerPosition,
} from "../utils/mapMarkers";
import PickStatusOverlay from "./PickStatusOverlay";

function createLocationDot() {
  const dot = document.createElement("div");
  dot.className = "atlas-location-dot-marker";
  return dot;
}

function GlobalMap({
  latitude,
  longitude,
  mapId = "global",
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

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const position = { lat, lng };
    if (mapsApiRef.current?.event) {
      mapsApiRef.current.event.trigger(map, "resize");
    }
    map.setCenter(position);
    setMarkerPosition(markerInstanceRef.current, position);
  }, [latitude, longitude]);

  // 使用useCallback确保initMap函数引用稳定
  const initMap = useCallback(async () => {
    if (!mapRef.current) return;

    try {
      const maps = await loadGoogleMapsScript();
      mapsApiRef.current = maps;

      // 再次检查组件是否仍然挂载且DOM元素存在
      if (!mapRef.current) return;

      // 确保坐标是数字类型
      const { latitude: latestLatitude, longitude: latestLongitude } =
        positionRef.current;
      const lat = parseFloat(latestLatitude);
      const lng = parseFloat(latestLongitude);

      if (isNaN(lat) || isNaN(lng)) {
        console.error("Invalid coordinates for GlobalMap:", {
          latitude: latestLatitude,
          longitude: latestLongitude,
        });
        throw new Error("Invalid coordinates for GlobalMap");
      }

      // 如果已经有地图实例，清理它
      if (mapInstanceRef.current) {
        mapInstanceRef.current = null;
      }
      removeMarker(markerInstanceRef);
      removeMapListener(clickListenerRef);

      let position = { lat, lng };

      // 创建新的地图实例
      mapInstanceRef.current = new maps.Map(mapRef.current, {
        mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
        center: position,
        zoom: 3,
        mapTypeId: "terrain",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        // 放大后的选点地图需要能缩放；侧栏小地图上盖着展开按钮，不放控件
        zoomControl: Boolean(onLocationPickRef.current),
        disableDefaultUI: true,
        // 侧栏小地图不接收键盘操作，版权行里就不放"键盘快捷键"入口
        keyboardShortcuts: Boolean(onLocationPickRef.current),
        gestureHandling: onLocationPickRef.current ? "greedy" : "none",
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

      // 创建自定义红点标记
      const dot = createLocationDot();

      // 只添加一次样式
      if (!document.querySelector("#globalmap-styles")) {
        const style = document.createElement("style");
        style.id = "globalmap-styles";
        style.textContent = `
                    @keyframes atlasLocationPulse {
                        0% {
                            opacity: 0.65;
                            transform: scale(0.45);
                        }
                        70% {
                            opacity: 0;
                            transform: scale(1.25);
                        }
                        100% {
                            opacity: 0;
                            transform: scale(1.25);
                        }
                    }
                    .atlas-location-dot-marker {
                        position: relative;
                        width: 20px;
                        height: 20px;
                        pointer-events: none;
                        overflow: visible;
                    }
                    .atlas-location-dot-marker::before {
                        content: "";
                        position: absolute;
                        inset: 0;
                        border-radius: 999px;
                        background: rgba(255, 68, 68, 0.34);
                        animation: atlasLocationPulse 1.8s ease-out infinite;
                    }
                    .atlas-location-dot-marker::after {
                        content: "";
                        position: absolute;
                        left: 50%;
                        top: 50%;
                        width: 9px;
                        height: 9px;
                        border-radius: 999px;
                        background: #ff4444;
                        border: 2px solid #ffffff;
                        box-shadow: 0 2px 6px rgba(15, 23, 42, 0.36);
                        transform: translate(-50%, -50%);
                    }
                `;
        document.head.appendChild(style);
      }

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
          content: dot,
          zIndex: 1000,
          anchorLeft: "-50%",
          anchorTop: "-50%",
        });
      } else if (maps.Marker) {
        markerInstanceRef.current = new maps.Marker({
          map: mapInstanceRef.current,
          position,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: "#ff4444",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 1000,
        });
      }

      // 确保地图中心点和标记位置一致
      mapInstanceRef.current.setCenter(position);

      // 清除错误状态
      setMapLoadFailed(false);
    } catch (err) {
      console.error("GlobalMap initialization error:", err);
      setMapLoadFailed(true);
    }
  }, [pickFromLatLng]);

  // 缺坐标时渲染的是占位符，mapRef 不存在；坐标到位后才创建地图
  const hasCoordinates = latitude !== undefined && longitude !== undefined;

  useEffect(() => {
    if (!hasCoordinates) return undefined;
    let isMounted = true;

    // 延迟执行以避免React Strict Mode的重复调用
    const timeoutId = setTimeout(() => {
      if (isMounted) {
        initMap();
      }
    }, 0);

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
  }, [hasCoordinates, initMap]);

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

  // 参数验证放在所有 hook 之后，保证每次渲染的 hook 调用顺序一致
  if (latitude === undefined || longitude === undefined) {
    console.warn("GlobalMap: Missing coordinates", { latitude, longitude });
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
        {t("loading_location")}
      </div>
    );
  }

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

export default memo(GlobalMap);
