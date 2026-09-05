import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import { useTranslation } from "react-i18next";
import { loadGoogleMapsWhenVisible } from "../utils/googleMaps";

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

// Memoized StreetView component - only re-renders when latitude/longitude changes
const StreetView = memo(
  ({ latitude, longitude, onPovChanged }) => {
    const panoramaRef = useRef(null);
    const panoramaInstanceRef = useRef(null);
    const autoRotateRef = useRef(null);
    const userInteractionTimerRef = useRef(null);
    const isAutoRotatingRef = useRef(false);
    const lastUserInteractionRef = useRef(0);
    const cleanupFunctionsRef = useRef([]);
    const mountedRef = useRef(true);
    const [error, setError] = useState(null);
    const [isNetworkError, setIsNetworkError] = useState(false);
    const [showInteractionTip, setShowInteractionTip] = useState(false);
    const { t } = useTranslation();

    // 自动旋转函数 - 使用 requestAnimationFrame 实现丝滑效果
    const startAutoRotate = (panorama) => {
      if (autoRotateRef.current) {
        stopAutoRotate(); // 先停止现有的旋转
      }

      let currentHeading = panorama.getPov().heading; // 从当前角度开始
      const rotateSpeed = 0.03; // 每帧旋转0.03度
      let lastTime = performance.now();
      let animationId;

      isAutoRotatingRef.current = true;

      const animate = (currentTime) => {
        // 检查组件是否已卸载
        if (!mountedRef.current) {
          stopAutoRotate();
          return;
        }

        if (
          !panorama ||
          !panoramaInstanceRef.current ||
          !isAutoRotatingRef.current
        ) {
          stopAutoRotate();
          return;
        }

        // 计算时间差，确保旋转速度在不同设备上保持一致
        const deltaTime = currentTime - lastTime;

        // 根据实际帧率调整旋转速度
        const speedMultiplier = deltaTime / 16.67; // 16.67ms约等于60fps
        const actualRotateSpeed = rotateSpeed * speedMultiplier;

        currentHeading = (currentHeading + actualRotateSpeed) % 360;

        // 使用更平滑的设置方式
        try {
          panorama.setPov({
            heading: currentHeading,
            pitch: panorama.getPov().pitch,
          });

          // 通知父组件视角变化
          if (onPovChanged) {
            onPovChanged(currentHeading);
          }
        } catch (error) {
          // 如果街景实例出现问题，停止旋转
          console.warn("街景旋转时出现错误:", error);
          stopAutoRotate();
          return;
        }

        lastTime = currentTime;

        // 继续下一帧 - 只有在组件挂载且正在旋转时
        if (mountedRef.current && isAutoRotatingRef.current) {
          animationId = requestAnimationFrame(animate);
          autoRotateRef.current = animationId;
        }
      };

      // 开始动画
      animationId = requestAnimationFrame(animate);
      autoRotateRef.current = animationId;
    };

    // 停止自动旋转
    const stopAutoRotate = () => {
      if (autoRotateRef.current) {
        cancelAnimationFrame(autoRotateRef.current);
        autoRotateRef.current = null;
      }
      isAutoRotatingRef.current = false;
    };

    // 处理用户交互
    const handleUserInteraction = () => {
      lastUserInteractionRef.current = Date.now();

      // 隐藏操作提示
      if (showInteractionTip) {
        setShowInteractionTip(false);
      }

      if (isAutoRotatingRef.current) {
        stopAutoRotate();

        // 清除之前的恢复定时器
        if (userInteractionTimerRef.current) {
          clearTimeout(userInteractionTimerRef.current);
        }

        // 3秒后恢复自动旋转
        userInteractionTimerRef.current = setTimeout(() => {
          if (panoramaInstanceRef.current) {
            startAutoRotate(panoramaInstanceRef.current);
          }
        }, 3000);
      }
    };

    // Memoized POV change handler
    const handlePovChanged = useCallback(() => {
      if (!panoramaInstanceRef.current || !onPovChanged) return;

      try {
        const pov = panoramaInstanceRef.current.getPov();
        onPovChanged(pov.heading);
      } catch (e) {
        console.warn("Failed to get POV:", e);
      }
    }, [onPovChanged]);

    useEffect(() => {
      mountedRef.current = true;
      let isMounted = true;
      let panorama = null;
      let loadTimeoutId = null;
      let interactionTipTimeoutId = null;
      let autoRotateTimeoutId = null;

      const loadStreetView = async () => {
        try {
          if (!latitude || !longitude) {
            // 不显示错误，等待坐标
            return;
          }

          const lat = Number(latitude);
          const lng = Number(longitude);

          if (isNaN(lat) || isNaN(lng)) {
            throw new Error(t("error.invalidCoordinateValues"));
          }

          // Load Google Maps when visible
          const maps = await loadGoogleMapsWhenVisible(panoramaRef.current);
          if (!isMounted) return;

          if (!panoramaRef.current) return;

          panorama = new maps.StreetViewPanorama(panoramaRef.current, {
            position: { lat, lng },
            pov: {
              heading: 0,
              pitch: 0,
            },
            zoom: 1,
            visible: true,
            motionTracking: false,
            motionTrackingControl: false,
            showRoadLabels: false,
            addressControl: false,
          });

          panoramaInstanceRef.current = panorama;

          const listeners = [];

          // Set loading timeout
          loadTimeoutId = setTimeout(() => {
            if (isMounted && mountedRef.current) {
              setError(t("error.networkConnectionFailed"));
              setIsNetworkError(true);
            }
          }, 15000);

          // Status change listener
          const statusListener = panorama.addListener("status_changed", () => {
            if (!isMounted) return;
            const status = panorama.getStatus();
            if (status === "ZERO_RESULTS" || status === "UNKNOWN_ERROR") {
              setError(t("error.streetViewNotAvailable"));
              setIsNetworkError(false);
              stopAutoRotate();
            }
          });
          listeners.push(statusListener);

          // Pano changed listener
          const panoListener = panorama.addListener("pano_changed", () => {
            if (!isMounted || !mountedRef.current) {
              return;
            }

            if (loadTimeoutId) {
              clearTimeout(loadTimeoutId);
              loadTimeoutId = null;
            }

            setError(null);
            setIsNetworkError(false);

            // Clear existing auto-rotate timeout before setting new one
            if (autoRotateTimeoutId) {
              clearTimeout(autoRotateTimeoutId);
              autoRotateTimeoutId = null;
            }

            // Start auto-rotate after delay
            autoRotateTimeoutId = setTimeout(() => {
              if (
                isMounted &&
                mountedRef.current &&
                panoramaInstanceRef.current
              ) {
                startAutoRotate(panorama);
              }
            }, 2000);

            // Show interaction tip
            interactionTipTimeoutId = setTimeout(() => {
              if (isMounted && mountedRef.current) {
                setShowInteractionTip(true);
                setTimeout(() => {
                  if (isMounted && mountedRef.current) {
                    setShowInteractionTip(false);
                  }
                }, 5000);
              }
            }, 3500);
          });
          listeners.push(panoListener);

          // POV changed listener - throttled
          let povThrottleTimer = null;
          const povListener = panorama.addListener("pov_changed", () => {
            if (!isMounted) return;

            // 只在非自动旋转时才视为用户交互
            if (!isAutoRotatingRef.current) {
              handleUserInteraction();
            }

            // Throttle POV updates to reduce re-renders
            if (!povThrottleTimer) {
              povThrottleTimer = setTimeout(() => {
                handlePovChanged();
                povThrottleTimer = null;
              }, 100); // Update every 100ms max
            }
          });
          listeners.push(povListener);

          // Position changed listener
          const positionListener = panorama.addListener(
            "position_changed",
            () => {
              if (!isMounted) return;
              handleUserInteraction();
            },
          );
          listeners.push(positionListener);

          // Store cleanup functions
          cleanupFunctionsRef.current = listeners.map(
            (listener) => () => listener.remove(),
          );

          // 监听DOM事件（鼠标和触摸）
          const streetViewElement = panoramaRef.current;
          if (streetViewElement) {
            streetViewElement.addEventListener(
              "mousedown",
              handleUserInteraction,
            );
            streetViewElement.addEventListener(
              "touchstart",
              handleUserInteraction,
            );
            streetViewElement.addEventListener("wheel", handleUserInteraction);

            // 添加到清理函数
            cleanupFunctionsRef.current.push(() => {
              streetViewElement.removeEventListener(
                "mousedown",
                handleUserInteraction,
              );
              streetViewElement.removeEventListener(
                "touchstart",
                handleUserInteraction,
              );
              streetViewElement.removeEventListener(
                "wheel",
                handleUserInteraction,
              );
            });
          }
        } catch (err) {
          if (isMounted) {
            console.error("Street View loading error:", err);
            setError(err.message || t("error.unableToLoadStreetView"));
            setIsNetworkError(
              err.message?.includes("network") ||
                err.message?.includes("Network"),
            );
          }
        }
      };

      loadStreetView();

      // Cleanup
      return () => {
        isMounted = false;
        mountedRef.current = false;

        stopAutoRotate();

        if (loadTimeoutId) clearTimeout(loadTimeoutId);
        if (interactionTipTimeoutId) clearTimeout(interactionTipTimeoutId);
        if (autoRotateTimeoutId) clearTimeout(autoRotateTimeoutId);
        if (userInteractionTimerRef.current)
          clearTimeout(userInteractionTimerRef.current);

        cleanupFunctionsRef.current.forEach((cleanup) => cleanup());
        cleanupFunctionsRef.current = [];

        if (panoramaInstanceRef.current) {
          try {
            panoramaInstanceRef.current.setVisible(false);
          } catch (e) {
            // Ignore cleanup errors
          }
          panoramaInstanceRef.current = null;
        }
      };
    }, [latitude, longitude, t]);

    if (error) {
      return (
        <div style={styles.errorContainer}>
          <div style={styles.errorIcon}>{isNetworkError ? "🌐" : "📍"}</div>
          <div style={styles.errorText}>{error}</div>
          <div style={styles.errorSubText}>
            {isNetworkError
              ? t("error.checkInternetConnection")
              : t("error.tryAnotherLocation")}
          </div>
        </div>
      );
    }

    return (
      <div style={styles.container}>
        <div ref={panoramaRef} style={{ width: "100%", height: "100%" }} />
        {showInteractionTip && (
          <div style={styles.interactionTip}>
            {t("streetView.interactionTip")}
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison - only re-render if coordinates actually change
    return (
      prevProps.latitude === nextProps.latitude &&
      prevProps.longitude === nextProps.longitude
    );
  },
);

StreetView.displayName = "StreetView";

export default StreetView;
