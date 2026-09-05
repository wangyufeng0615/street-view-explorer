import React, { memo, useRef, useEffect, useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import AiDescription from "./AiDescription";
import AtlasVoicePanel from "./AtlasVoicePanel";
import "../styles/Sidebar.css";

const GlobalMap = lazy(() => import("./GlobalMap"));
const PreviewMap = lazy(() => import("./PreviewMap"));

const SECONDARY_MAP_DELAY_MS = 700;

const Sidebar = memo(function Sidebar({
  location,
  heading,
  streetViewView,
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
  const scrollContainerRef = useRef(null);
  const [shouldLoadSecondaryMaps, setShouldLoadSecondaryMaps] = useState(false);

  useEffect(() => {
    setShouldLoadSecondaryMaps(false);
    if (!location?.pano_id) return undefined;

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
  }, [location?.pano_id]);

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
            {location && shouldLoadSecondaryMaps ? (
              <Suspense fallback={<div style={styles.mapPlaceholder}>{t("loading_location")}</div>}>
                <GlobalMap
                  latitude={location.latitude}
                  longitude={location.longitude}
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
            {location && shouldLoadSecondaryMaps ? (
              <Suspense fallback={null}>
                <PreviewMap
                  latitude={location.latitude}
                  longitude={location.longitude}
                  heading={heading}
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
              voiceControl={<AtlasVoicePanel />}
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
