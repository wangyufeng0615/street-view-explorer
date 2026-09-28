import React, {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  memo,
  lazy,
  Suspense,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import TopBar from "../components/TopBar";
import Sidebar from "../components/Sidebar";
import StreetView from "../components/StreetView";
import GlobalLoading from "../components/GlobalLoading";
import "../styles/animations.css";
import "../styles/HomePage.css";
import "../styles/responsive.css";

// Lazy load components that are not immediately visible
const ErrorDisplay = lazy(() => import("../components/ErrorDisplay"));
const Toast = lazy(() => import("../components/Toast"));
const FootprintMap = lazy(() => import("../components/FootprintMap"));

// 自定义钩子
import useLocationData from "../hooks/useLocationData";
import useLocationDescription from "../hooks/useLocationDescription";
import useExplorationMode, {
  EXPLORATION_MODES,
} from "../hooks/useExplorationMode";
import useKeyboardNavigation from "../hooks/useKeyboardNavigation";
import useStore from "../store/useStore";

// Memoized StreetViewContainer wrapper
// 朝向在这里订阅，拖动或自动旋转时只重渲染街景，不牵动整个首页
const StreetViewContainer = memo(
  ({ latitude, longitude, paused, onPovChanged, onViewChanged }) => {
    const heading = useStore((state) => state.heading);
    return (
      <div className="street-view-container">
        <StreetView
          latitude={latitude}
          longitude={longitude}
          heading={heading}
          paused={paused}
          onPovChanged={onPovChanged}
          onViewChanged={onViewChanged}
        />
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.latitude === nextProps.latitude &&
      prevProps.longitude === nextProps.longitude &&
      prevProps.paused === nextProps.paused
    );
  },
);

StreetViewContainer.displayName = "StreetViewContainer";

// 解析 URL 中的位置参数
function getLocationFromURL() {
  const params = new URLSearchParams(window.location.search);
  const lat = parseFloat(params.get("lat"));
  const lng = parseFloat(params.get("lng"));
  if (
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  ) {
    return { lat, lng };
  }
  return null;
}

// 更新 URL（不触发页面刷新）
function updateURL(lat, lng) {
  const url = new URL(window.location.href);
  url.searchParams.set("lat", lat.toFixed(5));
  url.searchParams.set("lng", lng.toFixed(5));
  window.history.replaceState(null, "", url.toString());
}

function getCurrentRouteTarget(pathname) {
  return {
    pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

export default function HomePage({ showFootprintFromRoute = false }) {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const loadLocationFromURL = useStore((state) => state.loadLocationFromURL);
  const loadLocationFromMapPick = useStore(
    (state) => state.loadLocationFromMapPick,
  );
  const isMapLocationLoading = useStore((state) => state.isMapLocationLoading);
  const urlLocationRef = useRef(getLocationFromURL());
  const hasLoadedInitialLocationRef = useRef(false);
  const mapPickResetTimerRef = useRef(null);
  const [mapPickStatus, setMapPickStatus] = useState({
    status: "idle",
    mapId: null,
    message: "",
  });
  const activeLanguage = i18n.resolvedLanguage || i18n.language || "en";
  const isLanguageReady = i18n.isInitialized && Boolean(activeLanguage);

  // 使用自定义钩子
  const {
    location,
    error,
    isLoading,
    loadRandomLocation,
    loadingRef,
    lastRefreshTimeRef,
  } = useLocationData();

  const {
    description,
    descriptionCitations,
    descriptionResearchStatus,
    isLoadingDesc,
    descError,
    descRetries,
    loadLocationDescription,
    locationRef,
    networkStateRef,
  } = useLocationDescription();

  const {
    explorationMode,
    explorationInterest,
    isSavingPreference,
    preferenceError,
    isInitialized,
    handleModeChange,
    handlePreferenceChange,
  } = useExplorationMode(lastRefreshTimeRef, loadingRef);

  const setHeading = useStore((state) => state.setHeading);
  const toastMessage = useStore((state) => state.toastMessage);
  const showToast = useStore((state) => state.showToast);
  const setStreetViewView = useStore((state) => state.setStreetViewView);

  // 使用键盘导航钩子
  useKeyboardNavigation(loadRandomLocation, isLoading, loadingRef);

  // Memoized callbacks to prevent re-renders
  const handlePovChanged = useCallback(
    (newHeading) => {
      // Throttle heading updates
      setHeading(Math.round(newHeading));
    },
    [setHeading],
  );

  const handleViewChanged = useCallback(
    (nextView) => {
      setStreetViewView(nextView);
    },
    [setStreetViewView],
  );

  const handleRetryDescription = useCallback(() => {
    if (location?.pano_id) {
      loadLocationDescription(location.pano_id);
    }
  }, [location?.pano_id, loadLocationDescription]);

  const handleExplore = useCallback(() => {
    loadRandomLocation();
  }, [loadRandomLocation]);

  const handleOpenFootprint = useCallback(() => {
    navigate(getCurrentRouteTarget("/footprints"));
  }, [navigate]);

  const handleCloseFootprint = useCallback(() => {
    navigate(getCurrentRouteTarget("/"));
  }, [navigate]);

  const clearMapPickResetTimer = useCallback(() => {
    if (mapPickResetTimerRef.current) {
      clearTimeout(mapPickResetTimerRef.current);
      mapPickResetTimerRef.current = null;
    }
  }, []);

  const resetMapPickStatusSoon = useCallback(
    (delay = 2200) => {
      clearMapPickResetTimer();
      mapPickResetTimerRef.current = setTimeout(() => {
        setMapPickStatus({
          status: "idle",
          mapId: null,
          message: "",
        });
      }, delay);
    },
    [clearMapPickResetTimer],
  );

  const handleMapLocationPick = useCallback(
    async ({ lat, lng, mapId }) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return;
      }

      clearMapPickResetTimer();
      setMapPickStatus({
        status: "loading",
        mapId,
        message: t("mapPicker.finding"),
      });

      const result = await loadLocationFromMapPick(lat, lng);
      if (result?.success) {
        setMapPickStatus({
          status: "success",
          mapId,
          message: t("mapPicker.ready"),
        });
        resetMapPickStatusSoon(1500);
        return;
      }

      setMapPickStatus({
        status: "error",
        mapId,
        message: result?.error || t("mapPicker.failed"),
      });
      resetMapPickStatusSoon(3600);
    },
    [
      clearMapPickResetTimer,
      loadLocationFromMapPick,
      resetMapPickStatusSoon,
      t,
    ],
  );

  useEffect(() => {
    return () => {
      clearMapPickResetTimer();
    };
  }, [clearMapPickResetTimer]);

  // Start Atlas research as soon as a concrete panorama and UI language exist.
  // The store already deduplicates identical requests and aborts stale ones.
  useEffect(() => {
    if (isLanguageReady && location?.pano_id) {
      locationRef.current = location;

      if (locationRef.current?.pano_id === location.pano_id) {
        loadLocationDescription(location.pano_id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在全景或语言变化时触发，位置对象的其他字段变化不重新请求
  }, [
    activeLanguage,
    isLanguageReady,
    location?.pano_id,
    locationRef,
    loadLocationDescription,
  ]);

  // 监听网络状态变化，重新加载描述
  useEffect(() => {
    const handleOnline = () => {
      networkStateRef.current = true;
      // 如果有失败的请求，尝试重新加载
      if (descError && location?.pano_id) {
        loadLocationDescription(location.pano_id);
      }
    };

    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [descError, location?.pano_id, loadLocationDescription, networkStateRef]);

  // 页面加载时根据当前模式加载位置 - 等待状态初始化完成
  useEffect(() => {
    // 等待状态完全初始化
    if (
      hasLoadedInitialLocationRef.current ||
      !isInitialized ||
      !isLanguageReady
    ) {
      return;
    }

    hasLoadedInitialLocationRef.current = true;

    // 如果 URL 包含坐标参数，优先从 URL 加载
    const urlLocation = urlLocationRef.current;
    if (urlLocation) {
      urlLocationRef.current = null; // 只用一次
      loadLocationFromURL(urlLocation.lat, urlLocation.lng);
      return;
    }

    if (explorationMode === EXPLORATION_MODES.CUSTOM && !explorationInterest) {
      // 如果是特定兴趣模式但没有兴趣，切换到随机模式
      handleModeChange(EXPLORATION_MODES.RANDOM);
    } else {
      // 首次加载时跳过限流检查
      loadRandomLocation(true);
    }
  }, [
    handleModeChange,
    isInitialized,
    isLanguageReady,
    loadLocationFromURL,
    loadRandomLocation,
    explorationMode,
    explorationInterest,
  ]);

  // 位置变化时更新 URL
  useEffect(() => {
    if (location && location.latitude != null && location.longitude != null) {
      updateURL(location.latitude, location.longitude);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在坐标变化时更新地址栏
  }, [location?.latitude, location?.longitude]);

  // Memoized styles to prevent re-creation
  const styles = useMemo(
    () => ({
      container: {
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      },
      mainContent: {
        flex: 1,
        display: "flex",
        position: "relative",
      },
      streetViewWrapper: {
        position: "absolute",
        top: "var(--top-bar-height, 50px)",
        left: 0,
        right: "320px",
        bottom: 0,
        width: "auto",
        height: "auto",
      },
    }),
    [],
  );

  // 如果有错误，显示错误页面
  if (error) {
    return (
      <Suspense
        fallback={
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100vh",
            }}
          >
            Loading...
          </div>
        }
      >
        <ErrorDisplay error={error} onRetry={handleExplore} />
      </Suspense>
    );
  }

  return (
    <div style={styles.container}>
      {/* 顶栏 */}
      <TopBar
        location={location}
        isLoading={isLoading}
        onExplore={handleExplore}
        explorationMode={explorationMode}
        explorationInterest={explorationInterest}
        onModeChange={handleModeChange}
        onPreferenceChange={handlePreferenceChange}
        isSavingPreference={isSavingPreference}
        preferenceError={preferenceError}
        onOpenFootprint={handleOpenFootprint}
      />

      {/* 主要内容区域 */}
      <div style={styles.mainContent}>
        {/* 街景容器 */}
        <div style={styles.streetViewWrapper} className="street-view-wrapper">
          <StreetViewContainer
            latitude={location?.latitude}
            longitude={location?.longitude}
            paused={showFootprintFromRoute}
            onPovChanged={handlePovChanged}
            onViewChanged={handleViewChanged}
          />
        </div>

        {/* 侧边栏 */}
        <Sidebar
          location={location}
          description={description}
          descriptionCitations={descriptionCitations}
          descriptionResearchStatus={descriptionResearchStatus}
          isLoadingDesc={isLoadingDesc}
          isLocationLoading={isLoading}
          descError={descError}
          descRetries={descRetries}
          onRetryDescription={handleRetryDescription}
          onMapLocationPick={handleMapLocationPick}
          isMapPickLoading={isMapLocationLoading}
          mapPickStatus={mapPickStatus}
        />
      </div>

      {/* 全局加载动画 - lazy loaded */}
      {isLoading && (
        <Suspense fallback={null}>
          <GlobalLoading />
        </Suspense>
      )}

      {/* Toast 通知 - lazy loaded */}
      {showToast && (
        <Suspense fallback={null}>
          <Toast message={toastMessage} visible />
        </Suspense>
      )}

      {/* 全球足迹地图 */}
      {showFootprintFromRoute && (
        <Suspense fallback={null}>
          <FootprintMap onClose={handleCloseFootprint} />
        </Suspense>
      )}
    </div>
  );
}
