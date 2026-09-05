import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadGoogleMapsWhenVisible } from "../utils/googleMaps";

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
    top: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    color: "rgba(255, 255, 255, 0.95)",
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
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    padding: "30px 20px",
    textAlign: "center",
    zIndex: 1000,
    backdropFilter: "blur(4px)",
  },
  errorIcon: {
    fontSize: "48px",
    marginBottom: "20px",
    animation: "pulse 2s infinite",
  },
  errorText: {
    fontSize: "18px",
    color: "#333",
    marginBottom: "12px",
    fontWeight: "600",
    lineHeight: "1.4",
    maxWidth: "400px",
  },
  errorSubText: {
    fontSize: "14px",
    color: "#666",
    maxWidth: "300px",
    lineHeight: "1.5",
  },
};

export default function StreetView({
  latitude,
  longitude,
  heading = 0,
  onPovChanged,
  onViewChanged,
}) {
  const panoramaRef = useRef(null);
  const panoramaInstanceRef = useRef(null); // 存储街景实例的引用
  const autoRotateRef = useRef(null); // 存储自动旋转动画帧的引用
  const userInteractionTimerRef = useRef(null); // 存储用户交互恢复定时器
  const isAutoRotatingRef = useRef(false); // 标记是否正在自动旋转
  const isContainerVisibleRef = useRef(true);
  const onPovChangedRef = useRef(onPovChanged);
  const onViewChangedRef = useRef(onViewChanged);
  const viewSourceRef = useRef("initial");
  const latestHeadingRef = useRef(heading);
  const lastNotifiedHeadingRef = useRef(null);
  const cleanupFunctionsRef = useRef([]); // 存储所有需要清理的函数
  const mountedRef = useRef(true); // 跟踪组件是否已挂载
  const [error, setError] = useState(null);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [showInteractionTip, setShowInteractionTip] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    onPovChangedRef.current = onPovChanged;
  }, [onPovChanged]);

  useEffect(() => {
    onViewChangedRef.current = onViewChanged;
  }, [onViewChanged]);

  useEffect(() => {
    latestHeadingRef.current = heading;
  }, [heading]);

  const canAutoRotate = () =>
    mountedRef.current &&
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
      typeof position?.lat === "function" ? position.lat() : Number(latitude);
    const lng =
      typeof position?.lng === "function" ? position.lng() : Number(longitude);
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
    if (!panorama || !Number.isFinite(numericHeading)) {
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
  }, [heading]);

  // 处理用户交互
  const handleUserInteraction = () => {
    viewSourceRef.current = "user";
    // 隐藏操作提示
    if (showInteractionTip) {
      setShowInteractionTip(false);
    }

    if (isAutoRotatingRef.current) {
      stopAutoRotate();

      // 3秒后恢复自动旋转
      scheduleAutoRotateResume();
    }
  };

  // 组件卸载时的清理
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
      // 清理所有注册的清理函数
      cleanupFunctionsRef.current.forEach((fn) => fn());
      cleanupFunctionsRef.current = [];
    };
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
    };
  }, []);

  useEffect(() => {
    // Ensure mounted state is set for this effect
    mountedRef.current = true;
    let isMounted = true;
    let panorama = null;
    let cleanup = null;
    let loadTimeoutId = null;
    let tipTimeoutId = null;
    let autoRotateTimeoutId = null;

    const initStreetView = async () => {
      try {
        setError(null);
        setIsNetworkError(false);

        // 停止之前的自动旋转
        stopAutoRotate();

        // 验证坐标
        const lat = Number(latitude);
        const lng = Number(longitude);

        if (isNaN(lat) || isNaN(lng)) {
          throw new Error(t("error.invalidCoordinateValues"));
        }

        // Load Google Maps when the panorama container is visible
        const maps = await loadGoogleMapsWhenVisible(panoramaRef.current);
        if (!isMounted) return;

        if (!panoramaRef.current) return;

        // 创建街景实例
        const panoramaContainer = panoramaRef.current;
        panoramaContainer.replaceChildren();
        panorama = new maps.StreetViewPanorama(panoramaContainer, {
          position: { lat, lng },
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
        });

        // 存储街景实例引用
        panoramaInstanceRef.current = panorama;

        // 存储所有的监听器以便清理
        const listeners = [];

        // 设置加载超时
        loadTimeoutId = setTimeout(() => {
          if (isMounted && mountedRef.current) {
            setError(t("error.networkConnectionFailed"));
            setIsNetworkError(true);
            stopAutoRotate();
          }
        }, 10000); // 10秒超时

        // 监听街景状态变化
        const statusListener = panorama.addListener("status_changed", () => {
          if (!isMounted) return;

          const status = panorama.getStatus();
          if (status !== "OK") {
            // 街景数据不可用
            setError(t("error.streetViewNotAvailable"));
            setIsNetworkError(false);
            stopAutoRotate(); // 如果街景加载失败，停止自动旋转
          }
        });
        listeners.push(statusListener);

        // 监听街景成功加载 - 统一处理
        const panoListener = panorama.addListener("pano_changed", () => {
          if (!isMounted || !mountedRef.current) {
            return;
          }

          // 清除加载超时
          if (loadTimeoutId) {
            clearTimeout(loadTimeoutId);
            loadTimeoutId = null;
          }

          // 重置错误状态
          setError(null);
          setIsNetworkError(false);
          notifyViewChanged(panorama);

          // 清除之前的自动旋转定时器
          if (autoRotateTimeoutId) {
            clearTimeout(autoRotateTimeoutId);
          }

          // 延迟启动自动旋转，让街景先完全加载
          autoRotateTimeoutId = setTimeout(() => {
            if (
              isMounted &&
              mountedRef.current &&
              panoramaInstanceRef.current &&
              canAutoRotate()
            ) {
              startAutoRotate(panorama);
            }
          }, AUTO_ROTATE_START_DELAY_MS); // 街景加载完成后等待2秒再开始旋转

          // 延迟显示操作提示
          tipTimeoutId = setTimeout(() => {
            if (isMounted && mountedRef.current) {
              setShowInteractionTip(true);
              // 8秒后自动隐藏提示
              const hideTipTimeoutId = setTimeout(() => {
                if (isMounted && mountedRef.current) {
                  setShowInteractionTip(false);
                }
              }, 8000);
              // 添加到清理列表
              cleanupFunctionsRef.current.push(() =>
                clearTimeout(hideTipTimeoutId),
              );
            }
          }, 3000); // 街景加载完成后等待3秒再显示提示
        });
        listeners.push(panoListener);

        // 监听视角变化，只用于通知父组件
        const povListener = panorama.addListener("pov_changed", () => {
          if (panorama) {
            const currentPov = panorama.getPov();
            notifyHeadingChanged(currentPov.heading);
            notifyViewChanged(panorama);
          }
        });
        listeners.push(povListener);

        const zoomListener = panorama.addListener("zoom_changed", () => {
          notifyViewChanged(panorama);
        });
        listeners.push(zoomListener);

        // 监听DOM事件（鼠标和触摸）
        const streetViewElement = panoramaRef.current;
        streetViewElement.addEventListener("mousedown", handleUserInteraction);
        streetViewElement.addEventListener("wheel", handleUserInteraction);
        streetViewElement.addEventListener("touchstart", handleUserInteraction);

        // 清理函数
        cleanup = () => {
          panorama.setVisible?.(false);
          panorama.unbindAll?.();
          maps.event?.clearInstanceListeners?.(panorama);
          panoramaContainer.replaceChildren();
          // 清理Google Maps监听器
          listeners.forEach((listener) => {
            if (listener && listener.remove) {
              listener.remove();
            }
          });

          // 清理DOM事件监听器
          if (streetViewElement) {
            streetViewElement.removeEventListener(
              "mousedown",
              handleUserInteraction,
            );
            streetViewElement.removeEventListener(
              "wheel",
              handleUserInteraction,
            );
            streetViewElement.removeEventListener(
              "touchstart",
              handleUserInteraction,
            );
          }

          // 清理所有定时器
          if (loadTimeoutId) clearTimeout(loadTimeoutId);
          if (tipTimeoutId) clearTimeout(tipTimeoutId);
          if (autoRotateTimeoutId) clearTimeout(autoRotateTimeoutId);
          if (userInteractionTimerRef.current) {
            clearTimeout(userInteractionTimerRef.current);
            userInteractionTimerRef.current = null;
          }

          // 停止动画
          stopAutoRotate();

          // 清理街景实例引用
          panoramaInstanceRef.current = null;
        };
      } catch (err) {
        if (isMounted) {
          console.error("StreetView initialization error:", err);
          stopAutoRotate();

          // 判断是否为网络相关错误
          const isNetworkIssue =
            err.message?.includes("network") ||
            err.message?.includes("timeout") ||
            err.message?.includes("fetch") ||
            err.message?.includes("Google Maps") ||
            err.name === "NetworkError" ||
            !navigator.onLine;

          if (isNetworkIssue) {
            setError(t("error.networkConnectionFailed"));
            setIsNetworkError(true);
          } else {
            setError(t("error.streetViewLoadFailed"));
            setIsNetworkError(false);
          }
        }
      }
    };

    if (latitude && longitude && isMounted && mountedRef.current) {
      // Street View is the primary visual surface; start it before secondary maps.
      initStreetView();
    }

    return () => {
      isMounted = false;
      mountedRef.current = false;

      // 停止所有动画
      stopAutoRotate();

      // 清理所有定时器
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
      if (tipTimeoutId) clearTimeout(tipTimeoutId);
      if (autoRotateTimeoutId) clearTimeout(autoRotateTimeoutId);
      if (userInteractionTimerRef.current) {
        clearTimeout(userInteractionTimerRef.current);
        userInteractionTimerRef.current = null;
      }

      // 重置状态
      setShowInteractionTip(false);
      panoramaInstanceRef.current = null;

      // 调用清理函数（如果存在）
      if (cleanup) {
        cleanup();
      }

      // 清理所有注册的清理函数
      cleanupFunctionsRef.current.forEach((fn) => fn());
      cleanupFunctionsRef.current = [];
    };
  }, [latitude, longitude, t]);

  return (
    <div style={styles.container}>
      <div ref={panoramaRef} style={{ width: "100%", height: "100%" }} />

      {/* 操作提示气泡 */}
      {showInteractionTip && !error && (
        <div style={styles.interactionTip}>
          {t("streetview.interactionTip")}
        </div>
      )}

      {error && (
        <div style={styles.errorContainer}>
          <div style={styles.errorIcon}>{isNetworkError ? "🌐" : "⚠️"}</div>
          <div style={styles.errorText}>{error}</div>
          <div style={styles.errorSubText}>
            {isNetworkError
              ? t("error.checkNetworkConnection")
              : error === t("error.streetViewNotAvailable")
                ? t("error.tryOtherLocationOrLater")
                : ""}
          </div>
        </div>
      )}
    </div>
  );
}
