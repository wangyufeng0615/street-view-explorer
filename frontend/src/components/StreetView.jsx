import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadGoogleMapsWhenVisible } from "../utils/googleMaps";
import { useMapsReachability } from "../utils/mapsReachability";
import {
  isOfficialPanoId,
  resolveOfficialPanoId,
} from "../utils/officialStreetView";

const AUTO_ROTATE_FRAME_INTERVAL_MS = 1000 / 24;
const AUTO_ROTATE_DEGREES_PER_SECOND = 1.8;
const AUTO_ROTATE_START_DELAY_MS = 2000;
const AUTO_ROTATE_RESUME_DELAY_MS = 3000;
const AUTO_ROTATE_VISIBILITY_RESUME_DELAY_MS = 500;

function isDocumentVisible() {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

function isPageFocused() {
  return (
    typeof document === "undefined" ||
    typeof document.hasFocus !== "function" ||
    document.hasFocus()
  );
}

function normalizeHeading(heading) {
  const numericHeading = Number(heading);
  if (!Number.isFinite(numericHeading)) return 0;
  return ((numericHeading % 360) + 360) % 360;
}

function headingDistance(a, b) {
  const delta = Math.abs(normalizeHeading(a) - normalizeHeading(b));
  return Math.min(delta, 360 - delta);
}

export function streetViewFovFromZoom(zoom) {
  const numericZoom = Number(zoom);
  if (!Number.isFinite(numericZoom)) return 90;
  return Math.round(Math.max(10, Math.min(120, 180 / 2 ** numericZoom)));
}

const styles = {
  container: {
    width: "100%",
    height: "100%",
    position: "relative",
  },
  interactionTip: {
    position: "absolute",
    top: "var(--streetview-tip-top, 20px)",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: "rgba(33, 26, 20, 0.78)",
    color: "rgba(255, 245, 230, 0.95)",
    padding: "10px 18px",
    borderRadius: "24px",
    fontSize: "13px",
    fontWeight: "400",
    zIndex: 100,
    backdropFilter: "blur(12px)",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.25), 0 2px 4px rgba(0, 0, 0, 0.1)",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
    opacity: 0.9,
    transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
    lineHeight: "1.4",
    textShadow: "0 1px 3px rgba(0, 0, 0, 0.4)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    animation: "tipFadeIn 0.6s ease-out",
    letterSpacing: "0.02em",
  },
  errorContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 22, 17, 0.85)",
    padding: "30px 20px",
    textAlign: "center",
    zIndex: 1,
  },
  errorText: {
    fontSize: "18px",
    color: "rgba(255, 245, 230, 0.95)",
    fontWeight: "500",
    lineHeight: "1.4",
    maxWidth: "400px",
  },
};

// 操作提示每次打开网页只弹一次，之后每到一站都不再打扰
let interactionTipShown = false;

export function resetInteractionTipForTests() {
  interactionTipShown = false;
}

function createLocationLoad() {
  return {
    // 当前位置的加载是否仍有效；位置切走后，旧位置的迟到事件一律忽略
    active: false,
    pending: false,
    targetPano: "",
    previousPano: "",
    hasScheduledTip: false,
    loadTimeoutId: null,
    autoRotateTimeoutId: null,
    tipTimeoutId: null,
    hideTipTimeoutId: null,
  };
}

function clearLocationTimers(load) {
  clearTimeout(load.loadTimeoutId);
  clearTimeout(load.autoRotateTimeoutId);
  clearTimeout(load.tipTimeoutId);
  clearTimeout(load.hideTipTimeoutId);
  load.loadTimeoutId = null;
  load.autoRotateTimeoutId = null;
  load.tipTimeoutId = null;
  load.hideTipTimeoutId = null;
}

// 只显示 Google 官方街景：官方全景 ID 直接加载；没有 ID 时按坐标加载（首页的位置总带 ID）。
// 用户上传的全景返回 null，由 findOfficialTarget 就近换成官方全景
function streetViewTarget(panoId, latitude, longitude) {
  if (panoId) {
    return isOfficialPanoId(panoId) ? { pano: String(panoId) } : null;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (isNaN(lat) || isNaN(lng)) {
    const invalidCoordinates = new Error("Invalid Street View coordinates");
    invalidCoordinates.errorKey = "error.invalidCoordinateValues";
    throw invalidCoordinates;
  }
  return { position: { lat, lng } };
}

// 附近没有官方全景就算这里没有街景，不退回用户全景
async function findOfficialTarget(maps, panoId, latitude, longitude) {
  const officialPanoId = await resolveOfficialPanoId(maps, {
    lat: Number(latitude),
    lng: Number(longitude),
    panoId,
  });
  if (!officialPanoId) {
    const noOfficialImagery = new Error("No official Street View nearby");
    noOfficialImagery.errorKey = "error.streetViewNotAvailable";
    throw noOfficialImagery;
  }
  return { pano: officialPanoId };
}

export default function StreetView({
  panoId,
  latitude,
  longitude,
  heading = 0,
  onPovChanged,
  onViewChanged,
  onLoadError,
  paused = false,
  // 手机上滑切换时，提示由外层给出；街景控件只留方向箭头，右侧让给操作栏
  interactionTip = true,
  compactControls = false,
}) {
  const panoramaRef = useRef(null);
  const panoramaInstanceRef = useRef(null); // 存储街景实例的引用，换位置时复用
  const destroyPanoramaRef = useRef(null); // 卸载时销毁街景实例和它的监听器
  const locationLoadRef = useRef(createLocationLoad());
  const latestCoordinatesRef = useRef({ latitude, longitude });
  const autoRotateRef = useRef(null); // 存储自动旋转动画帧的引用
  const userInteractionTimerRef = useRef(null); // 存储用户交互恢复定时器
  const isAutoRotatingRef = useRef(false); // 标记是否正在自动旋转
  const isContainerVisibleRef = useRef(true);
  const onPovChangedRef = useRef(onPovChanged);
  const onViewChangedRef = useRef(onViewChanged);
  const onLoadErrorRef = useRef(onLoadError);
  const viewSourceRef = useRef("initial");
  const latestHeadingRef = useRef(heading);
  const lastNotifiedHeadingRef = useRef(null);
  const mountedRef = useRef(true); // 跟踪组件是否已挂载
  // 被其他全屏层遮挡时暂停自动旋转（IntersectionObserver 检测不到遮挡）
  const pausedRef = useRef(paused);
  const interactionTipRef = useRef(interactionTip);
  interactionTipRef.current = interactionTip;
  // 保存翻译键而不是译文，切换语言时不需要重建街景
  const [error, setError] = useState(null);
  const [showInteractionTip, setShowInteractionTip] = useState(false);
  const { t } = useTranslation();
  // 连不上 Google 或密钥被拒时，首页在整个街景区域给出统一提示，这里的报错都让给它
  const reachability = useMapsReachability();
  const mapsDown =
    reachability === "unreachable" || reachability === "unavailable";

  // 已经加载好的街景（手机上预先备好的下一张卡片）换上新的监听方时，
  // 立刻补报一次当前朝向和视野，不必等用户拖动或自动旋转
  const isLoadSettled = () =>
    locationLoadRef.current.active && !locationLoadRef.current.pending;

  useEffect(() => {
    onPovChangedRef.current = onPovChanged;
    const panorama = panoramaInstanceRef.current;
    if (onPovChanged && panorama && isLoadSettled()) {
      const currentHeading = normalizeHeading(panorama.getPov().heading);
      lastNotifiedHeadingRef.current = Math.round(currentHeading);
      onPovChanged(currentHeading);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在监听方变化时补报，辅助函数只读 ref
  }, [onPovChanged]);

  useEffect(() => {
    onViewChangedRef.current = onViewChanged;
    const panorama = panoramaInstanceRef.current;
    if (onViewChanged && panorama && isLoadSettled() && !error) {
      notifyViewChanged(panorama);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在监听方变化时补报；error 取本次渲染的值即可
  }, [onViewChanged]);

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  // 每个位置开始加载时 error 会先清空，所以这里每次失败都会通知一次；
  // 预先备好的卡片加载失败时还没有监听方，换上监听方后补报
  useEffect(() => {
    if (error) onLoadError?.(error);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoadError 由 ref 同步，这里只关心出错和监听方出现
  }, [error, Boolean(onLoadError)]);

  useEffect(() => {
    latestHeadingRef.current = heading;
  }, [heading]);

  const canAutoRotate = () =>
    mountedRef.current &&
    !pausedRef.current &&
    isDocumentVisible() &&
    isPageFocused() &&
    isContainerVisibleRef.current;

  const notifyHeadingChanged = (heading) => {
    const normalizedHeading = normalizeHeading(heading);
    const roundedHeading = Math.round(normalizedHeading);

    if (lastNotifiedHeadingRef.current === roundedHeading) {
      return;
    }

    lastNotifiedHeadingRef.current = roundedHeading;

    if (onPovChangedRef.current) {
      onPovChangedRef.current(normalizedHeading);
    }
  };

  const notifyViewChanged = (panorama) => {
    if (!panorama || !onViewChangedRef.current) return;
    const pov = panorama.getPov?.() || {
      heading: latestHeadingRef.current,
      pitch: 0,
    };
    const position = panorama.getPosition?.();
    const lat =
      typeof position?.lat === "function"
        ? position.lat()
        : Number(latestCoordinatesRef.current.latitude);
    const lng =
      typeof position?.lng === "function"
        ? position.lng()
        : Number(latestCoordinatesRef.current.longitude);
    const zoom = Number(panorama.getZoom?.() ?? 1);

    onViewChangedRef.current({
      panoId: panorama.getPano?.() || "",
      latitude: lat,
      longitude: lng,
      heading: normalizeHeading(pov.heading),
      pitch: Number(pov.pitch) || 0,
      zoom,
      fov: streetViewFovFromZoom(zoom),
      source: isAutoRotatingRef.current ? "auto" : viewSourceRef.current,
    });
  };

  const scheduleAutoRotateResume = (delay = AUTO_ROTATE_RESUME_DELAY_MS) => {
    if (userInteractionTimerRef.current) {
      clearTimeout(userInteractionTimerRef.current);
    }

    userInteractionTimerRef.current = setTimeout(() => {
      userInteractionTimerRef.current = null;
      if (panoramaInstanceRef.current && canAutoRotate()) {
        startAutoRotate(panoramaInstanceRef.current);
      }
    }, delay);
  };

  // 自动旋转函数 - 用 rAF 对齐屏幕刷新，但限制昂贵的 Street View POV 更新频率
  const startAutoRotate = (panorama) => {
    if (!canAutoRotate()) {
      return;
    }

    if (autoRotateRef.current) {
      stopAutoRotate(); // 先停止现有的旋转
    }

    let currentHeading = panorama.getPov().heading; // 从当前角度开始
    let lastTime = performance.now();
    let lastPovUpdateTime = lastTime;

    isAutoRotatingRef.current = true;
    viewSourceRef.current = "auto";

    const rotate = (currentTime) => {
      // 检查组件是否已卸载
      if (!mountedRef.current) {
        stopAutoRotate();
        return;
      }

      if (
        !panorama ||
        !panoramaInstanceRef.current ||
        !isAutoRotatingRef.current ||
        !canAutoRotate()
      ) {
        stopAutoRotate();
        return;
      }

      const elapsedSinceLastPovUpdate = currentTime - lastPovUpdateTime;
      if (elapsedSinceLastPovUpdate < AUTO_ROTATE_FRAME_INTERVAL_MS) {
        autoRotateRef.current = requestAnimationFrame(rotate);
        return;
      }

      // 计算时间差，确保旋转速度在不同设备上保持一致
      const deltaTime = currentTime - lastTime;
      currentHeading = normalizeHeading(
        currentHeading + AUTO_ROTATE_DEGREES_PER_SECOND * (deltaTime / 1000),
      );

      try {
        panorama.setPov({
          heading: currentHeading,
          pitch: panorama.getPov().pitch,
        });
      } catch (error) {
        // 如果街景实例出现问题，停止旋转
        console.warn("街景旋转时出现错误:", error);
        stopAutoRotate();
        return;
      }

      lastTime = currentTime;
      lastPovUpdateTime = currentTime;

      // 继续下一帧；真正的 POV 更新由上面的间隔限制到约 30fps
      if (mountedRef.current && isAutoRotatingRef.current) {
        autoRotateRef.current = requestAnimationFrame(rotate);
      }
    };

    // 开始动画
    autoRotateRef.current = requestAnimationFrame(rotate);
  };

  // 停止自动旋转
  const stopAutoRotate = () => {
    if (autoRotateRef.current) {
      cancelAnimationFrame(autoRotateRef.current);
      autoRotateRef.current = null;
    }
    isAutoRotatingRef.current = false;
  };

  useEffect(() => {
    const panorama = panoramaInstanceRef.current;
    const numericHeading = Number(heading);
    // 暂停（被遮住或是手机上的备用卡片）时不跟随外部朝向。这个 effect 排在
    // paused 的 effect 前面：卡片被换成当前卡片的那次渲染里，pausedRef 仍是 true，
    // 外部朝向不会把它刚才的画面扭过去，随后由补报把外部朝向对齐到画面
    if (!panorama || !Number.isFinite(numericHeading) || pausedRef.current) {
      return;
    }

    const nextHeading = normalizeHeading(numericHeading);
    const currentPov = panorama.getPov();
    if (headingDistance(currentPov.heading, nextHeading) < 0.5) {
      return;
    }

    try {
      stopAutoRotate();
      viewSourceRef.current = "programmatic";
      panorama.setPov({
        ...currentPov,
        heading: nextHeading,
      });
      scheduleAutoRotateResume();
    } catch (error) {
      console.warn("街景视角更新失败:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 辅助函数只读写 ref，每次渲染都会重建，只在朝向变化时执行
  }, [heading]);

  // 处理用户交互（监听器只在创建实例时绑定一次，所以不读取渲染时的 state）
  const handleUserInteraction = () => {
    viewSourceRef.current = "user";
    // 隐藏操作提示
    setShowInteractionTip(false);

    if (isAutoRotatingRef.current) {
      stopAutoRotate();

      // 3秒后恢复自动旋转
      scheduleAutoRotateResume();
    }
  };

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) {
      stopAutoRotate();
      if (userInteractionTimerRef.current) {
        clearTimeout(userInteractionTimerRef.current);
        userInteractionTimerRef.current = null;
      }
      return;
    }
    if (panoramaInstanceRef.current) {
      scheduleAutoRotateResume(AUTO_ROTATE_VISIBILITY_RESUME_DELAY_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 辅助函数只读写 ref，每次渲染都会重建，只在暂停状态变化时执行
  }, [paused]);

  // 当前位置的街景已可用：清掉超时和错误，稍后开始自动旋转，每个位置只提示一次
  const markLocationLoaded = (panorama) => {
    const load = locationLoadRef.current;
    if (!load.active) return;
    load.pending = false;
    clearTimeout(load.loadTimeoutId);
    load.loadTimeoutId = null;

    setError(null);
    notifyViewChanged(panorama);

    // 延迟启动自动旋转，让街景先完全加载
    clearTimeout(load.autoRotateTimeoutId);
    load.autoRotateTimeoutId = setTimeout(() => {
      load.autoRotateTimeoutId = null;
      if (
        load.active &&
        mountedRef.current &&
        panoramaInstanceRef.current === panorama &&
        canAutoRotate()
      ) {
        startAutoRotate(panorama);
      }
    }, AUTO_ROTATE_START_DELAY_MS);

    // 每次打开网页只提示一次；沿路走动（pano_changed）和换站都不再重复弹出。
    // 后台备好的卡片不弹，免得把唯一一次提示用在看不见的地方
    if (
      load.hasScheduledTip ||
      interactionTipShown ||
      !interactionTipRef.current ||
      pausedRef.current
    ) {
      return;
    }
    load.hasScheduledTip = true;
    load.tipTimeoutId = setTimeout(() => {
      load.tipTimeoutId = null;
      if (!load.active || !mountedRef.current || interactionTipShown) return;
      interactionTipShown = true;
      setShowInteractionTip(true);
      // 8秒后自动隐藏提示
      load.hideTipTimeoutId = setTimeout(() => {
        load.hideTipTimeoutId = null;
        if (mountedRef.current) {
          setShowInteractionTip(false);
        }
      }, 8000);
    }, 3000);
  };

  // 街景数据不可用：已有明确结论，不能再被加载超时改写成网络错误
  const markLocationUnavailable = () => {
    const load = locationLoadRef.current;
    if (!load.active) return;
    load.pending = false;
    clearLocationTimers(load);
    setError("error.streetViewNotAvailable");
    stopAutoRotate();
  };

  const handleLoadTimeout = (load) => {
    load.loadTimeoutId = null;
    if (!load.active || !load.pending || !mountedRef.current) return;

    // 复用实例时状态可能一直是 OK，status_changed 未必再触发；
    // 只要实例已经停在目标全景上，就按加载完成处理，不误报网络错误
    const panorama = panoramaInstanceRef.current;
    const currentPano = panorama?.getPano?.() || "";
    const arrived =
      panorama?.getStatus?.() === "OK" &&
      (load.targetPano
        ? currentPano === load.targetPano
        : Boolean(currentPano) && currentPano !== load.previousPano);
    if (arrived) {
      markLocationLoaded(panorama);
      return;
    }

    setError("error.networkConnectionFailed");
    stopAutoRotate();
  };

  const createPanorama = (maps, target) => {
    const panoramaContainer = panoramaRef.current;
    panoramaContainer.replaceChildren();
    const panorama = new maps.StreetViewPanorama(panoramaContainer, {
      ...target,
      pov: {
        heading: normalizeHeading(latestHeadingRef.current),
        pitch: 0,
      },
      zoom: 1,
      visible: true,
      motionTracking: false,
      motionTrackingControl: false,
      showRoadLabels: false,
      addressControl: false,
      // The home page is already full-bleed and keeps its corners for the
      // nav and side column, so the panorama controls sit on the right edge.
      fullscreenControl: false,
      zoomControl: !compactControls,
      panControl: !compactControls,
      zoomControlOptions: { position: maps.ControlPosition.RIGHT_CENTER },
      panControlOptions: { position: maps.ControlPosition.RIGHT_CENTER },
    });
    const isCurrent = () =>
      mountedRef.current && panoramaInstanceRef.current === panorama;

    const listeners = [
      // 监听街景状态变化
      panorama.addListener("status_changed", () => {
        if (!isCurrent()) return;
        if (panorama.getStatus() !== "OK") {
          markLocationUnavailable();
        } else if (locationLoadRef.current.pending) {
          markLocationLoaded(panorama);
        }
      }),
      // 复用实例按 ID 切换时状态保持 OK，status_changed 不会再触发；
      // 新全景的元数据到达时会触发 position_changed，以此判定加载完成
      panorama.addListener("position_changed", () => {
        if (!isCurrent()) return;
        const load = locationLoadRef.current;
        if (
          load.pending &&
          load.targetPano &&
          panorama.getPano?.() === load.targetPano &&
          panorama.getStatus?.() === "OK"
        ) {
          markLocationLoaded(panorama);
        }
      }),
      // 按坐标加载成功、或沿路走动时触发
      panorama.addListener("pano_changed", () => {
        if (!isCurrent()) return;
        const load = locationLoadRef.current;
        // 按全景 ID 加载时 setPano 自己就会触发 pano_changed，要等 status_changed 才算加载完成
        if (load.pending && load.targetPano) return;
        markLocationLoaded(panorama);
      }),
      // 监听视角变化，只用于通知父组件
      panorama.addListener("pov_changed", () => {
        if (!isCurrent()) return;
        notifyHeadingChanged(panorama.getPov().heading);
        // 新位置还没加载完时，实例上的位置仍是旧的，不上报视野
        if (!locationLoadRef.current.pending) notifyViewChanged(panorama);
      }),
      panorama.addListener("zoom_changed", () => {
        if (!isCurrent() || locationLoadRef.current.pending) return;
        notifyViewChanged(panorama);
      }),
    ];

    // 监听DOM事件（鼠标和触摸）
    panoramaContainer.addEventListener("mousedown", handleUserInteraction);
    panoramaContainer.addEventListener("wheel", handleUserInteraction);
    panoramaContainer.addEventListener("touchstart", handleUserInteraction);

    panoramaInstanceRef.current = panorama;
    destroyPanoramaRef.current = () => {
      listeners.forEach((listener) => listener?.remove?.());
      panoramaContainer.removeEventListener("mousedown", handleUserInteraction);
      panoramaContainer.removeEventListener("wheel", handleUserInteraction);
      panoramaContainer.removeEventListener(
        "touchstart",
        handleUserInteraction,
      );
      panorama.setVisible?.(false);
      panorama.unbindAll?.();
      maps.event?.clearInstanceListeners?.(panorama);
      panoramaContainer.replaceChildren();
    };
    return panorama;
  };

  // 组件挂载与卸载：街景实例只在卸载时销毁
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      // 停止所有动画和定时器
      stopAutoRotate();
      if (userInteractionTimerRef.current) {
        clearTimeout(userInteractionTimerRef.current);
        userInteractionTimerRef.current = null;
      }
      locationLoadRef.current.active = false;
      clearLocationTimers(locationLoadRef.current);
      destroyPanoramaRef.current?.();
      destroyPanoramaRef.current = null;
      panoramaInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载和卸载时执行，辅助函数只读写 ref
  }, []);

  useEffect(() => {
    const handleVisibilityOrFocusChange = () => {
      if (!isDocumentVisible() || !isPageFocused()) {
        stopAutoRotate();
        return;
      }

      scheduleAutoRotateResume(AUTO_ROTATE_VISIBILITY_RESUME_DELAY_MS);
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityOrFocusChange,
    );
    window.addEventListener("blur", handleVisibilityOrFocusChange);
    window.addEventListener("focus", handleVisibilityOrFocusChange);

    let observer = null;
    const streetViewElement = panoramaRef.current;
    if ("IntersectionObserver" in window && streetViewElement) {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          isContainerVisibleRef.current = entry?.isIntersecting ?? true;

          if (!isContainerVisibleRef.current) {
            stopAutoRotate();
            return;
          }

          scheduleAutoRotateResume(AUTO_ROTATE_VISIBILITY_RESUME_DELAY_MS);
        },
        { threshold: 0.1 },
      );

      observer.observe(streetViewElement);
    }

    // 容器尺寸变了（转屏、拖窗口、跨过布局断点）要通知街景重新计算画面，
    // 否则复用的实例可能停在旧尺寸、画面发黑；Google 文档要求这里手动触发 resize
    let resizeObserver = null;
    let resizeTimer = null;
    if ("ResizeObserver" in window && streetViewElement) {
      resizeObserver = new ResizeObserver(() => {
        // 拖动窗口时尺寸连续变化，合并成一次
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const panorama = panoramaInstanceRef.current;
          if (panorama) window.google?.maps?.event?.trigger(panorama, "resize");
        }, 120);
      });
      resizeObserver.observe(streetViewElement);
    }

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityOrFocusChange,
      );
      window.removeEventListener("blur", handleVisibilityOrFocusChange);
      window.removeEventListener("focus", handleVisibilityOrFocusChange);
      if (observer) {
        observer.disconnect();
      }
      resizeObserver?.disconnect();
      clearTimeout(resizeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时注册可见性监听，辅助函数只读写 ref
  }, []);

  useEffect(() => {
    latestCoordinatesRef.current = { latitude, longitude };
    if (!panoId && !(latitude && longitude)) {
      return undefined;
    }

    let isActive = true;
    let load = null;
    const visibilityController = new AbortController();

    const showLocation = async () => {
      try {
        setError(null);
        setShowInteractionTip(false);

        // 停止之前的自动旋转
        stopAutoRotate();

        let target = streetViewTarget(panoId, latitude, longitude);
        let panorama = panoramaInstanceRef.current;
        let maps = null;
        if (!panorama || !target) {
          // Load Google Maps when the panorama container is visible
          maps = await loadGoogleMapsWhenVisible(panoramaRef.current, {
            signal: visibilityController.signal,
          });
          if (!isActive || !mountedRef.current || !panoramaRef.current) {
            return;
          }
        }
        if (!target) {
          target = await findOfficialTarget(maps, panoId, latitude, longitude);
          if (!isActive || !mountedRef.current) return;
        }

        load = {
          ...createLocationLoad(),
          active: true,
          pending: true,
          targetPano: target.pano || "",
          previousPano: panorama?.getPano?.() || "",
        };
        locationLoadRef.current = load;
        const currentLoad = load;
        load.loadTimeoutId = setTimeout(
          () => handleLoadTimeout(currentLoad),
          10000,
        ); // 10秒超时

        if (!panorama) {
          createPanorama(maps, target);
          return;
        }

        // 复用已有实例：先回到初始视角，再切换全景或坐标
        panorama.setPov({
          heading: normalizeHeading(latestHeadingRef.current),
          pitch: 0,
        });
        panorama.setZoom?.(1);
        if (target.pano) {
          panorama.setPano(target.pano);
          // 同一个全景不会再触发加载事件，直接按已加载处理
          if (
            load.previousPano === target.pano &&
            panorama.getStatus?.() === "OK"
          ) {
            markLocationLoaded(panorama);
          }
        } else {
          panorama.setPosition(target.position);
        }
      } catch (err) {
        if (isActive && err.name !== "AbortError") {
          console.error("StreetView initialization error:", err);
          stopAutoRotate();

          if (err.errorKey) {
            setError(err.errorKey);
            return;
          }

          // 连不上 Google：首页在整个街景区域给出统一提示，这里不再叠一行报错
          if (err.mapsUnreachable) {
            setError("error.mapsUnreachable");
            return;
          }

          // 判断是否为网络相关错误
          const isNetworkIssue =
            err.message?.includes("network") ||
            err.message?.includes("timeout") ||
            err.message?.includes("fetch") ||
            err.message?.includes("Google Maps") ||
            err.name === "NetworkError" ||
            !navigator.onLine;

          if (isNetworkIssue) {
            setError("error.networkConnectionFailed");
          } else {
            setError("error.streetViewLoadFailed");
          }
        }
      }
    };

    // Street View is the primary visual surface; start it before secondary maps.
    showLocation();

    return () => {
      isActive = false;
      // 还在等容器可见时，断开 IntersectionObserver
      visibilityController.abort();

      // 停止所有动画和当前位置的定时器；街景实例留给下一个位置复用
      stopAutoRotate();
      if (load) {
        load.active = false;
        clearLocationTimers(load);
      }
      if (userInteractionTimerRef.current) {
        clearTimeout(userInteractionTimerRef.current);
        userInteractionTimerRef.current = null;
      }
      setShowInteractionTip(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在全景或坐标变化时切换位置（切换语言不重建），辅助函数只读写 ref
  }, [panoId, latitude, longitude]);

  return (
    <div style={styles.container}>
      <div ref={panoramaRef} style={{ width: "100%", height: "100%" }} />

      {/* 操作提示气泡 */}
      {showInteractionTip && !error && (
        <div style={styles.interactionTip}>
          {t("streetview.interactionTip")}
        </div>
      )}

      {/* 报错只有一句话，原因和下一步都写在这句里 */}
      {error && error !== "error.mapsUnreachable" && !mapsDown && (
        <div style={styles.errorContainer}>
          <div style={styles.errorText}>{t(error)}</div>
        </div>
      )}
    </div>
  );
}
