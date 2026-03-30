import React, { memo, useRef, useEffect, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import AiDescription from "./AiDescription";
import "../styles/Sidebar.css";

const GlobalMap = lazy(() => import("./GlobalMap"));
const PreviewMap = lazy(() => import("./PreviewMap"));

const Sidebar = memo(function Sidebar({
  location,
  heading,
  description,
  descriptionCitations,
  isLoadingDesc,
  descError,
  descRetries,
  onRetryDescription,
}) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef(null);

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
        <div style={styles.section}>
          <div style={styles.mapContainer}>
            {location ? (
              <Suspense fallback={<div style={styles.mapPlaceholder}>{t("loading_location")}</div>}>
                <GlobalMap
                  latitude={location.latitude}
                  longitude={location.longitude}
                />
              </Suspense>
            ) : (
              <div style={styles.mapPlaceholder}>{t("loading_location")}</div>
            )}
          </div>
        </div>

        {/* 局部地图区域 */}
        <div style={styles.section}>
          <div style={styles.mapContainer}>
            {location && (
              <Suspense fallback={null}>
                <PreviewMap
                  latitude={location.latitude}
                  longitude={location.longitude}
                  heading={heading}
                />
              </Suspense>
            )}
          </div>
        </div>

        {/* AI解读区域 */}
        <div style={styles.section}>
          <div style={styles.aiContainer}>
            <AiDescription
              isLoading={isLoadingDesc}
              error={descError}
              description={description}
              citations={descriptionCitations}
              retries={descRetries}
              panoId={location?.pano_id}
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
    padding: "16px",
    WebkitOverflowScrolling: "touch",
  },
  section: {
    marginBottom: "16px",
  },
  mapContainer: {
    height: "200px",
    borderRadius: "8px",
    overflow: "hidden",
    border: "1px solid rgba(0, 0, 0, 0.1)",
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
