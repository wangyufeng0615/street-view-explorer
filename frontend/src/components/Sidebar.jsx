import React, {
  memo,
  useRef,
  useEffect,
  useState,
  lazy,
  Suspense,
} from "react";
import { useTranslation } from "react-i18next";
import AiDescription from "./AiDescription";
import AtlasVoicePanel from "./AtlasVoicePanel";
import useStore from "../store/useStore";
import "../styles/Sidebar.css";

const GlobalMap = lazy(() => import("./GlobalMap"));
const PreviewMap = lazy(() => import("./PreviewMap"));

const SECONDARY_MAP_DELAY_MS = 700;

// 固定的元素引用，AiDescription 重渲染时不会连带重渲染语音面板
const ATLAS_VOICE_CONTROL = <AtlasVoicePanel />;

const Sidebar = memo(function Sidebar({
  location,
  description,
  descriptionCitations,
  descriptionResearchStatus,
  isLoadingDesc,
  isLocationLoading,
  descError,
  descRetries,
  onRetryDescription,
  onMapLocationPick,
  isMapPickLoading,
  mapPickStatus,
}) {
  const { t } = useTranslation();
  // 朝向和视角变化很频繁，只在侧栏内订阅，首页其余部分不跟着重渲染
  const heading = useStore((state) => state.heading);
  const streetViewView = useStore((state) => state.streetViewView);
  const scrollContainerRef = useRef(null);
  const [shouldLoadSecondaryMaps, setShouldLoadSecondaryMaps] = useState(false);
  // 加载新位置时 location 会短暂为空；地图继续显示上一个位置，不卸载重建
  const [mapLocation, setMapLocation] = useState(location);
  if (location && location !== mapLocation) {
    setMapLocation(location);
  }

  // 只在首次拿到位置时延迟加载地图，让街景先占用网络；之后地图常驻
  useEffect(() => {
    if (shouldLoadSecondaryMaps || !location?.pano_id) return undefined;

    let idleId = null;
    const timerId = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(
          () => setShouldLoadSecondaryMaps(true),
          { timeout: 1200 },
        );
      } else {
        setShouldLoadSecondaryMaps(true);
      }
    }, SECONDARY_MAP_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [location?.pano_id, shouldLoadSecondaryMaps]);

  // 当组件挂载时重置滚动位置
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, []);

  // 当位置改变时也重置滚动位置
  useEffect(() => {
    if (scrollContainerRef.current && location?.pano_id) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [location?.pano_id]);

  return (
    <div style={styles.sidebar} className="new-sidebar">
      <div
        ref={scrollContainerRef}
        style={styles.scrollContainer}
        className="sidebar-scroll force-scrollbar"
      >
        {/* 世界地图区域 */}
        <div
          style={styles.section}
          className="sidebar-section sidebar-section--global-map"
        >
          <div style={styles.mapContainer} className="sidebar-map-container">
            {mapLocation && shouldLoadSecondaryMaps ? (
              <Suspense
                fallback={
                  <div style={styles.mapPlaceholder}>
                    {t("loading_location")}
                  </div>
                }
              >
                <GlobalMap
                  latitude={mapLocation.latitude}
                  longitude={mapLocation.longitude}
                  mapId="global"
                  onLocationPick={onMapLocationPick}
                  isPickingLocation={isMapPickLoading}
                  pickStatus={
                    mapPickStatus?.mapId === "global"
                      ? mapPickStatus.status
                      : "idle"
                  }
                  pickMessage={
                    mapPickStatus?.mapId === "global"
                      ? mapPickStatus.message
                      : ""
                  }
                />
              </Suspense>
            ) : (
              <div style={styles.mapPlaceholder}>{t("loading_location")}</div>
            )}
          </div>
        </div>

        {/* 局部地图区域 */}
        <div
          style={styles.section}
          className="sidebar-section sidebar-section--preview-map"
        >
          <div style={styles.mapContainer} className="sidebar-map-container">
            {mapLocation && shouldLoadSecondaryMaps ? (
              <Suspense fallback={null}>
                <PreviewMap
                  latitude={mapLocation.latitude}
                  longitude={mapLocation.longitude}
                  mapId="preview"
                  onLocationPick={onMapLocationPick}
                  isPickingLocation={isMapPickLoading}
                  pickStatus={
                    mapPickStatus?.mapId === "preview"
                      ? mapPickStatus.status
                      : "idle"
                  }
                  pickMessage={
                    mapPickStatus?.mapId === "preview"
                      ? mapPickStatus.message
                      : ""
                  }
                />
              </Suspense>
            ) : (
              <div style={styles.mapPlaceholder}>{t("loading_location")}</div>
            )}
          </div>
        </div>

        {/* AI解读区域 */}
        <div
          style={styles.section}
          className="sidebar-section sidebar-section--ai"
        >
          <div style={styles.aiContainer} className="sidebar-ai-container">
            <AiDescription
              voiceControl={ATLAS_VOICE_CONTROL}
              isLoading={isLoadingDesc || isLocationLoading}
              error={descError}
              description={description}
              citations={descriptionCitations}
              researchStatus={descriptionResearchStatus}
              retries={descRetries}
              panoId={location?.pano_id}
              heading={heading}
              view={streetViewView}
              onRetry={onRetryDescription}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

const styles = {
  sidebar: {
    position: "fixed",
    top: "var(--top-bar-height, 50px)",
    right: 0,
    bottom: 0,
    width: "320px",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    backdropFilter: "blur(10px)",
    borderLeft: "1px solid rgba(0, 0, 0, 0.1)",
    display: "flex",
    flexDirection: "column",
    zIndex: 900,
    boxShadow: "-2px 0 8px rgba(0, 0, 0, 0.1)",
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  scrollContainer: {
    flex: 1,
    overflowY: "scroll",
    overflowX: "hidden",
    padding: "10px",
    WebkitOverflowScrolling: "touch",
  },
  section: {
    marginBottom: "7px",
  },
  mapContainer: {
    height: "200px",
    borderRadius: "4px",
    overflow: "hidden",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    backgroundColor: "#f8f9fa",
  },
  aiContainer: {
    minHeight: "120px",
  },
  mapPlaceholder: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#666",
    fontSize: "14px",
    backgroundColor: "#f8f9fa",
  },
};

export default Sidebar;
