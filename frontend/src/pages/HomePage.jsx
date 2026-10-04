import React, {
  useEffect,
  useCallback,
  useRef,
  useState,
  memo,
  lazy,
  Suspense,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import StreetView from "../components/StreetView";
import HomeNav from "../components/home/HomeNav";
import HomeMiniMap from "../components/home/HomeMiniMap";
import HomeDock from "../components/home/HomeDock";
import AtlasLetter from "../components/home/AtlasLetter";
import ArrivalOverlay from "../components/home/ArrivalOverlay";
import HomeFeed from "../components/home/HomeFeed";
import { CloseGlyph } from "../components/home/HomeGlyphs";
import { preloadGoogleMaps } from "../utils/googleMaps";
import { loadNotoSerifSC } from "../utils/pageFonts";
import {
  coverPlaceForThisVisit,
  preloadCoverImage,
  shouldShowCover,
} from "../utils/coverGate";
import "../styles/animations.css";
import "../styles/HomePage.css";

// Lazy load components that are not immediately visible
const Toast = lazy(() => import("../components/Toast"));
const CoverOverlay = lazy(() => import("../components/cover/CoverOverlay"));

// 自定义钩子
import useLocationData from "../hooks/useLocationData";
import useLocationDescription from "../hooks/useLocationDescription";
import useExplorationMode, {
  EXPLORATION_MODES,
} from "../hooks/useExplorationMode";
import useKeyboardNavigation from "../hooks/useKeyboardNavigation";
import useStore from "../store/useStore";
import useHomeJourney, { locationFromStop } from "../hooks/useHomeJourney";
import useMediaQuery from "../hooks/useMediaQuery";
import useDismiss from "../hooks/useDismiss";

// 手机竖屏：全屏街景卡片上下滑动换站，来信和地图收进底部抽屉。断点和 HomePage.css 一致
const FEED_QUERY = "(max-width: 720px)";
// 只有触摸屏才能上下滑；窄窗口的电脑用操作栏里的"下一站"和空格
const TOUCH_QUERY = "(pointer: coarse)";

// Stop covering the street view even if the panorama never reports ready.
const LANDING_TIMEOUT_MS = 8000;

// Memoized StreetViewContainer wrapper
// 朝向在这里订阅，拖动或自动旋转时只重渲染街景，不牵动整个首页
const StreetViewContainer = memo(
  ({
    panoId,
    latitude,
    longitude,
    paused,
    onPovChanged,
    onViewChanged,
    onLoadError,
  }) => {
    const heading = useStore((state) => state.heading);
    return (
      <div className="street-view-container">
        <StreetView
          panoId={panoId}
          latitude={latitude}
          longitude={longitude}
          heading={heading}
          paused={paused}
          onPovChanged={onPovChanged}
          onViewChanged={onViewChanged}
          onLoadError={onLoadError}
        />
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.panoId === nextProps.panoId &&
      prevProps.latitude === nextProps.latitude &&
      prevProps.longitude === nextProps.longitude &&
      prevProps.panoId === nextProps.panoId &&
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
  // 保留路由写在 history.state 里的 key 和足迹浮层的 backgroundLocation
  window.history.replaceState(window.history.state, "", url.toString());
}

function getCurrentRouteTarget(pathname) {
  return {
    pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

// footprintOverlayOpen：足迹浮层叠在首页上时为 true，首页保持挂载但暂停街景自动旋转
export default function HomePage({ footprintOverlayOpen = false }) {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const loadLocationFromURL = useStore((state) => state.loadLocationFromURL);
  const loadLocationFromMapPick = useStore(
    (state) => state.loadLocationFromMapPick,
  );
  const relocalizeLocationAddress = useStore(
    (state) => state.relocalizeLocationAddress,
  );
  const applyNavigatedLocation = useStore(
    (state) => state.applyNavigatedLocation,
  );
  const isMapLocationLoading = useStore((state) => state.isMapLocationLoading);
  // 首次进入先显示封面，首页照常在底下加载第一站；封面开着时暂停街景和预取。
  // 决定显示的同时就开始下载封面图，不等封面组件的代码加载完。
  const [cover, setCover] = useState(() => {
    if (!shouldShowCover()) return null;
    const place = coverPlaceForThisVisit();
    preloadCoverImage(place);
    return place;
  });
  const closeCover = useCallback(() => setCover(null), []);
  const coverOpen = Boolean(cover);
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
  const isFeed = useMediaQuery(FEED_QUERY);
  const isTouch = useMediaQuery(TOUCH_QUERY);

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
  const maybePrefetchNext = useStore((state) => state.maybePrefetchNext);
  const stopPrefetch = useStore((state) => state.stopPrefetch);
  // Only whether the panorama has reported a view matters here; subscribing to
  // the view itself would re-render the whole page on every drag.
  const hasStreetViewView = useStore((state) => Boolean(state.streetViewView));

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

  // 用户主动探索（按钮、空格、错误页重试），计入预取的触发条件
  const handleExplore = useCallback(() => {
    loadRandomLocation(false, { userInitiated: true });
  }, [loadRandomLocation]);

  // 上滑换站：切换动画本身已经限速，正在出发时也滑不动，不再套 1 秒限流，
  // 否则连续快滑会被"操作太快"挡回去
  const handleSwipeExplore = useCallback(() => {
    loadRandomLocation(true, { userInitiated: true });
  }, [loadRandomLocation]);

  // 使用键盘导航钩子
  useKeyboardNavigation(
    handleExplore,
    isLoading || isSavingPreference || isMapLocationLoading,
    loadingRef,
  );

  // 足迹作为浮层打开，首页留在底下；地址参数由 updateURL 直接写入，从 window.location 读取
  const handleOpenFootprint = useCallback(() => {
    navigate(getCurrentRouteTarget("/footprints"), {
      state: {
        backgroundLocation: {
          ...routeLocation,
          search: window.location.search,
          hash: window.location.hash,
        },
      },
    });
  }, [navigate, routeLocation]);

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
      // 被别的导航（回到旧站、语音）作废：不算失败，静默收起提示
      if (result?.superseded) {
        setMapPickStatus({ status: "idle", mapId: null, message: "" });
        return;
      }
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

  // 街景脚本和偏好、随机位置请求并行加载；只加载脚本，不创建地图
  useEffect(() => {
    preloadGoogleMaps();
  }, []);

  // Atlas 来信和品牌字用衬线体。字体 CSS 和字形不小，等第一张全景出来再取，
  // 不和街景图块抢带宽；街景迟迟不来也最多等 3 秒。讲解一般在这之后才到。
  useEffect(() => {
    if (hasStreetViewView) {
      loadNotoSerifSC();
      return undefined;
    }
    const timerId = window.setTimeout(loadNotoSerifSC, 3000);
    return () => window.clearTimeout(timerId);
  }, [hasStreetViewView]);

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

  // 当前讲解结束后在后台预取下一站；是否满足条件由 store 判断
  const hasDescription = Boolean(description);
  useEffect(() => {
    // 手机上滑切换要提前备好下一张卡片：当前全景一出来就预取，第一站也预取
    const tryPrefetch = () =>
      maybePrefetchNext({
        overlayOpen: footprintOverlayOpen || coverOpen,
        eager: isFeed,
        landed: hasStreetViewView,
      });
    tryPrefetch();
    document.addEventListener("visibilitychange", tryPrefetch);
    return () => document.removeEventListener("visibilitychange", tryPrefetch);
  }, [
    maybePrefetchNext,
    footprintOverlayOpen,
    coverOpen,
    isFeed,
    hasStreetViewView,
    location?.pano_id,
    isLoading,
    isLoadingDesc,
    hasDescription,
    descError,
    activeLanguage,
  ]);

  // 离开首页时中止进行中的预取
  useEffect(() => stopPrefetch, [stopPrefetch]);

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

  // 地址跟着界面语言走：切换语言，或拿到的地点地址是另一种语言时，只重取地址
  useEffect(() => {
    if (isLanguageReady && location?.pano_id && location.address_language) {
      relocalizeLocationAddress();
    }
  }, [
    activeLanguage,
    isLanguageReady,
    location?.pano_id,
    location?.address_language,
    relocalizeLocationAddress,
  ]);

  // 位置变化时更新 URL
  useEffect(() => {
    if (location && location.latitude != null && location.longitude != null) {
      updateURL(location.latitude, location.longitude);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在坐标变化时更新地址栏
  }, [location?.latitude, location?.longitude]);

  // 街景超时或报错后不再盖着出发提示，让街景自己的错误说明露出来
  const [landingTimedOutPano, setLandingTimedOutPano] = useState(null);
  const locationPanoRef = useRef(null);
  locationPanoRef.current = location?.pano_id || null;
  const handleStreetViewError = useCallback(() => {
    setLandingTimedOutPano(locationPanoRef.current);
  }, []);

  useEffect(() => {
    // 每次到站重新计时；回到曾经超时或出错的全景时，遮罩照常盖住旧画面
    setLandingTimedOutPano(null);
    if (!location?.pano_id) return undefined;
    const timerId = window.setTimeout(
      () => setLandingTimedOutPano(location.pano_id),
      LANDING_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timerId);
  }, [location?.pano_id]);

  // streetViewView is cleared whenever a new location starts loading and set
  // again once the panorama reports its first view.
  const isLanding =
    Boolean(location?.pano_id) &&
    !hasStreetViewView &&
    landingTimedOutPano !== location.pano_id;
  const showArrival = isLoading || isLanding;

  const journeyStops = useHomeJourney(location, activeLanguage);

  const handlePickRandom = useCallback(() => {
    handleModeChange(EXPLORATION_MODES.RANDOM);
  }, [handleModeChange]);

  // 回到旅程里的某一站：直接用记下的全景，不再按坐标重新查找（可能落到别的全景，也会多记一次足迹）
  const handleRevisit = useCallback(
    (stop) => {
      applyNavigatedLocation(locationFromStop(stop));
    },
    [applyNavigatedLocation],
  );

  // 手机上的来信抽屉：地图第一次打开抽屉时才创建，不看的人不产生地图加载
  const [isLetterOpen, setLetterOpen] = useState(false);
  const [hasOpenedLetter, setHasOpenedLetter] = useState(false);
  const sideRef = useRef(null);
  const letterOpen = isFeed && isLetterOpen;
  const openLetter = useCallback(() => {
    setLetterOpen(true);
    setHasOpenedLetter(true);
  }, []);
  const closeLetter = useCallback(() => setLetterOpen(false), []);
  useDismiss(letterOpen, sideRef, closeLetter);
  useEffect(() => {
    if (letterOpen) sideRef.current?.focus({ preventScroll: true });
  }, [letterOpen]);

  // 上滑：回过头之后先沿着旅程往后走，走到头再出发去新地点；下拉：回到旅程里的上一站
  const handleSwipeNext = useCallback(
    (stop) => (stop ? handleRevisit(stop) : handleSwipeExplore()),
    [handleRevisit, handleSwipeExplore],
  );
  const handleSwipePrev = useCallback(
    (stop) => {
      if (stop) handleRevisit(stop);
    },
    [handleRevisit],
  );

  const isBusy = isLoading || isSavingPreference || isMapLocationLoading;

  const arrivalOverlay = (
    <ArrivalOverlay
      visible={showArrival}
      error={isLoading ? null : error}
      busy={isSavingPreference}
      onRetry={handleExplore}
      onGoRandom={
        explorationMode === EXPLORATION_MODES.CUSTOM ? handlePickRandom : null
      }
    />
  );

  return (
    <div className={`home-shell${isFeed ? " home-shell--feed" : ""}`}>
      <div className="home-stage">
        {isFeed ? (
          <HomeFeed
            location={location}
            journeyStops={journeyStops}
            isBusy={isBusy}
            paused={footprintOverlayOpen || coverOpen || letterOpen}
            hasLanded={hasStreetViewView}
            swipeEnabled={isTouch && !letterOpen && !coverOpen}
            description={description}
            isLoadingDesc={isLoadingDesc}
            descError={descError}
            onNext={handleSwipeNext}
            onPrev={handleSwipePrev}
            onOpenLetter={openLetter}
            onPovChanged={handlePovChanged}
            onViewChanged={handleViewChanged}
            onLoadError={handleStreetViewError}
          >
            {arrivalOverlay}
          </HomeFeed>
        ) : (
          <>
            <StreetViewContainer
              latitude={location?.latitude}
              longitude={location?.longitude}
              panoId={location?.pano_id}
              paused={footprintOverlayOpen || coverOpen}
              onPovChanged={handlePovChanged}
              onViewChanged={handleViewChanged}
              onLoadError={handleStreetViewError}
            />
            {arrivalOverlay}
          </>
        )}
      </div>

      <HomeNav onOpenFootprint={handleOpenFootprint} />

      {isFeed && (
        <div
          className={`home-sheet-backdrop${letterOpen ? " is-visible" : ""}`}
          aria-hidden="true"
        />
      )}
      <aside
        className={`home-side${letterOpen ? " is-open" : ""}`}
        ref={sideRef}
        tabIndex={isFeed ? -1 : undefined}
        role={isFeed ? "dialog" : undefined}
        aria-label={isFeed ? t("home.letter.label") : undefined}
        aria-hidden={isFeed && !letterOpen ? true : undefined}
        inert={isFeed && !letterOpen ? "" : undefined}
      >
        {isFeed && (
          <div className="home-sheet__header">
            <span className="home-sheet__grabber" aria-hidden="true" />
            <button
              type="button"
              className="home-icon-button home-sheet__close"
              aria-label={t("home.feed.closeLetter")}
              onClick={closeLetter}
            >
              <CloseGlyph />
            </button>
          </div>
        )}
        {(!isFeed || hasOpenedLetter) && (
          <HomeMiniMap
            location={location}
            onMapLocationPick={handleMapLocationPick}
            isMapPickLoading={isMapLocationLoading}
            mapPickStatus={mapPickStatus}
          />
        )}
        <AtlasLetter
          location={location}
          description={description}
          citations={descriptionCitations}
          researchStatus={descriptionResearchStatus}
          isLoadingDesc={isLoadingDesc}
          isLocationLoading={isLoading}
          descError={descError}
          descRetries={descRetries}
          onRetry={handleRetryDescription}
        />
      </aside>

      <div className="home-bottom">
        <HomeDock
          layout={isFeed ? "rail" : "bar"}
          isBusy={isBusy}
          onNext={handleExplore}
          explorationMode={explorationMode}
          explorationInterest={explorationInterest}
          isSavingPreference={isSavingPreference}
          preferenceError={preferenceError}
          onPickRandom={handlePickRandom}
          onPickInterest={handlePreferenceChange}
          stops={journeyStops}
          currentPanoId={location?.pano_id}
          onRevisit={handleRevisit}
        />
      </div>

      {/* Toast 通知 - lazy loaded */}
      {showToast && (
        <Suspense fallback={null}>
          <Toast message={toastMessage} visible />
        </Suspense>
      )}

      {cover && (
        <Suspense
          fallback={
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 10000,
                background: "#123a5e",
              }}
            />
          }
        >
          <CoverOverlay place={cover} onClose={closeCover} />
        </Suspense>
      )}
    </div>
  );
}
