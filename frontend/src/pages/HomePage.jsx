import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
  lazy,
  Suspense,
} from "react";
import { useTranslation } from "react-i18next";
import TopBar from "../components/TopBar";
import Sidebar from "../components/Sidebar";
import "../styles/animations.css";
import "../styles/HomePage.css";
import "../styles/responsive.css";

const StreetView = lazy(() => import("../components/StreetView"));

// Lazy load components that are not immediately visible
const GlobalLoading = lazy(() => import("../components/GlobalLoading"));
const ErrorDisplay = lazy(() => import("../components/ErrorDisplay"));
const Toast = lazy(() => import("../components/Toast"));
const FootprintMap = lazy(() => import("../components/FootprintMap"));

// 自定义钩子
import useLocationData from "../hooks/useLocationData";
import useLocationDescription from "../hooks/useLocationDescription";
import useExplorationMode, {
  EXPLORATION_MODES,
} from "../hooks/useExplorationMode";
import useUIHandlers from "../hooks/useUIHandlers";
import useKeyboardNavigation from "../hooks/useKeyboardNavigation";
import useStore from "../store/useStore";

// Memoized StreetViewContainer wrapper
const StreetViewContainer = memo(
  ({ latitude, longitude, heading, onPovChanged }) => {
    return (
      <div className="street-view-container">
        <Suspense fallback={<div style={{ width: '100%', height: '100%', backgroundColor: '#222' }} />}>
          <StreetView
            latitude={latitude}
            longitude={longitude}
            heading={heading}
            onPovChanged={onPovChanged}
          />
        </Suspense>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.latitude === nextProps.latitude &&
      prevProps.longitude === nextProps.longitude &&
      prevProps.heading === nextProps.heading
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

export default function HomePage() {
  const { i18n } = useTranslation();
  const loadLocationFromURL = useStore((state) => state.loadLocationFromURL);
  const urlLocationRef = useRef(getLocationFromURL());
  const hasLoadedInitialLocationRef = useRef(false);
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

  const { heading, setHeading, toastMessage, showToast } = useUIHandlers();

  const [showFootprint, setShowFootprint] = useState(false);

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

  const handleRetryDescription = useCallback(() => {
    if (location?.pano_id) {
      loadLocationDescription(location.pano_id);
    }
  }, [location?.pano_id, loadLocationDescription]);

  const handleExplore = useCallback(() => {
    loadRandomLocation();
  }, [loadRandomLocation]);

  // Debounced location description loading
  useEffect(() => {
    let mounted = true;
    let timeoutId = null;

    if (isLanguageReady && location?.pano_id) {
      locationRef.current = location;

      // Debounce description loading
      timeoutId = setTimeout(() => {
        if (mounted && locationRef.current?.pano_id === location.pano_id) {
          loadLocationDescription(location.pano_id);
        }
      }, 300);
    }

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [activeLanguage, isLanguageReady, location?.pano_id, locationRef, loadLocationDescription]);

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
        onOpenFootprint={() => setShowFootprint(true)}
      />

      {/* 主要内容区域 */}
      <div style={styles.mainContent}>
        {/* 街景容器 */}
        <div style={styles.streetViewWrapper} className="street-view-wrapper">
          <StreetViewContainer
            latitude={location?.latitude}
            longitude={location?.longitude}
            heading={heading}
            onPovChanged={handlePovChanged}
          />
        </div>

        {/* 侧边栏 */}
        <Sidebar
          location={location}
          heading={heading}
          description={description}
          descriptionCitations={descriptionCitations}
          isLoadingDesc={isLoadingDesc}
          descError={descError}
          descRetries={descRetries}
          onRetryDescription={handleRetryDescription}
        />
      </div>

      {/* 全局加载动画 - lazy loaded */}
      {isLoading && (
        <Suspense fallback={null}>
          <GlobalLoading />
        </Suspense>
      )}

      {/* Toast 通知 - lazy loaded */}
      <Suspense fallback={null}>
        <Toast message={toastMessage} visible={showToast} />
      </Suspense>

      {/* 全球足迹地图 */}
      {showFootprint && (
        <Suspense fallback={null}>
          <FootprintMap onClose={() => setShowFootprint(false)} />
        </Suspense>
      )}
    </div>
  );
}
