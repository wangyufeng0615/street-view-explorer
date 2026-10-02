import i18n from "../i18n";
import {
  isMapsRelayEnabled,
  prepareMapsRelay,
  releaseMapsRelay,
} from "./mapsRelay";

releaseMapsRelay();

// 全局状态管理
let googleMapsPromise = null;
let isLoadingScript = false;
let isApiLoaded = false;
let deferredLoadResolvers = [];
let loadAttemptCount = 0; // 添加加载尝试计数器

// 检查Google Maps API是否已经加载
function isGoogleMapsLoaded() {
  return !!(window.google && window.google.maps && window.google.maps.Map);
}

// 生成唯一的回调函数名
function generateCallbackName() {
  return `initGoogleMaps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 清理现有的Google Maps script标签
function cleanupExistingScripts() {
  const existingScripts = document.querySelectorAll(
    'script[data-google-maps="true"], script[src*="maps.googleapis.com/maps/api/js"]',
  );
  existingScripts.forEach((script) => {
    script.remove();
  });
}

// 生产环境提前建立到地图域名的连接；本地开发的浏览器出网走代理，不做预连接
function preconnectGoogleMaps() {
  if (
    isMapsRelayEnabled() ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = "https://maps.googleapis.com";
  document.head.appendChild(link);

  const tileLink = document.createElement("link");
  tileLink.rel = "preconnect";
  tileLink.href = "https://streetviewpixels-pa.googleapis.com";
  document.head.appendChild(tileLink);
}

/**
 * 页面挂载时提前加载 Maps JS 脚本，和业务接口请求并行。
 * 只加载脚本、不创建地图或街景，不产生地图加载计费；之后的
 * loadGoogleMapsScript / loadGoogleMapsWhenVisible 复用同一个加载过程。
 * 失败不抛出，真正用到地图的组件会重试并展示自己的错误。
 */
export function preloadGoogleMaps() {
  return loadGoogleMapsScript().catch(() => undefined);
}

/**
 * Load Google Maps Script with improved performance
 * - Uses IntersectionObserver for viewport-based loading
 * - Starts immediately because Street View is the primary visual surface
 * - Adds performance marks for monitoring
 */
export function loadGoogleMapsScript() {
  const currentLanguage = i18n.language || "en";

  // Mark performance timing
  if (window.performance && window.performance.mark) {
    window.performance.mark("googleMapsLoadStart");
  }

  // Maps registers custom elements globally; removing its script/global does
  // not unload them. Keep one SDK per document, even when app language changes.
  if (isApiLoaded && isGoogleMapsLoaded()) {
    return Promise.resolve(window.google.maps);
  }

  // 防止多次加载尝试
  if (loadAttemptCount > 0 && isGoogleMapsLoaded()) {
    isApiLoaded = true;
    return Promise.resolve(window.google.maps);
  }

  // If already loading, return existing promise
  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  // If script is loading, wait for it
  if (isLoadingScript) {
    return new Promise((resolve, reject) => {
      deferredLoadResolvers.push({ resolve, reject });
    });
  }

  // Start new loading process
  isLoadingScript = true;
  loadAttemptCount++;

  googleMapsPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if (isGoogleMapsLoaded()) {
      isLoadingScript = false;
      isApiLoaded = true;
      if (window.performance && window.performance.mark) {
        window.performance.mark("googleMapsLoadEnd");
        window.performance.measure(
          "googleMapsLoadTime",
          "googleMapsLoadStart",
          "googleMapsLoadEnd",
        );
      }
      resolve(window.google.maps);
      return;
    }

    const loadScript = () => {
      // 再次检查是否已经加载，避免重复
      if (isGoogleMapsLoaded()) {
        isLoadingScript = false;
        isApiLoaded = true;
        resolve(window.google.maps);
        return;
      }

      // Clean up old scripts
      cleanupExistingScripts();

      const callbackName = generateCallbackName();

      // Set timeout - 增加到30秒
      const timeoutId = setTimeout(() => {
        isLoadingScript = false;
        cleanup();
        reject(new Error("Google Maps loading timed out"));
      }, 30000);

      // Cleanup function
      const cleanup = () => {
        clearTimeout(timeoutId);
        if (window[callbackName]) {
          delete window[callbackName];
        }
      };

      // Success callback
      window[callbackName] = () => {
        cleanup();

        if (isGoogleMapsLoaded()) {
          isLoadingScript = false;
          isApiLoaded = true;

          // Performance marking
          if (window.performance && window.performance.mark) {
            window.performance.mark("googleMapsLoadEnd");
            window.performance.measure(
              "googleMapsLoadTime",
              "googleMapsLoadStart",
              "googleMapsLoadEnd",
            );
          }

          // Resolve main promise
          resolve(window.google.maps);

          // Resolve any deferred promises
          deferredLoadResolvers.forEach(({ resolve }) =>
            resolve(window.google.maps),
          );
          deferredLoadResolvers = [];
        } else {
          isLoadingScript = false;
          const error = new Error("Google Maps failed to initialize");
          reject(error);
          deferredLoadResolvers.forEach(({ reject }) => reject(error));
          deferredLoadResolvers = [];
        }
      };

      // Create and append script
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&callback=${callbackName}&loading=async&libraries=marker&language=${currentLanguage}&v=weekly`;
      script.async = true;
      script.defer = true;
      script.setAttribute("data-google-maps", "true");

      // Error handling
      script.onerror = () => {
        isLoadingScript = false;
        cleanup();
        const error = new Error("Google Maps script loading error");
        reject(error);
        deferredLoadResolvers.forEach(({ reject }) => reject(error));
        deferredLoadResolvers = [];
      };

      document.head.appendChild(script);
    };

    // Street View is the primary page surface, so load its API immediately.
    if (isMapsRelayEnabled()) {
      prepareMapsRelay().then(loadScript).catch(reject);
    } else {
      loadScript();
    }
  }).catch((err) => {
    isLoadingScript = false;
    googleMapsPromise = null;
    throw err;
  });

  return googleMapsPromise;
}

function abortError() {
  const error = new Error("Google Maps visibility wait was cancelled");
  error.name = "AbortError";
  return error;
}

/**
 * Load Google Maps when element becomes visible
 * Uses IntersectionObserver for viewport-based loading.
 * Pass `signal` to stop waiting (the observer is disconnected and the promise
 * rejects with an AbortError) when the caller no longer needs the map.
 */
export function loadGoogleMapsWhenVisible(element, { signal } = {}) {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }

  if (!element) {
    return loadGoogleMapsScript();
  }

  return new Promise((resolve, reject) => {
    // If IntersectionObserver is not supported, load immediately
    if (!("IntersectionObserver" in window)) {
      loadGoogleMapsScript().then(resolve).catch(reject);
      return;
    }

    let observer = null;
    const handleAbort = () => {
      observer?.disconnect();
      reject(abortError());
    };

    // Create observer
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            observer.disconnect();
            signal?.removeEventListener("abort", handleAbort);
            loadGoogleMapsScript().then(resolve).catch(reject);
          }
        });
      },
      {
        root: null,
        rootMargin: "50px", // Start loading 50px before element is visible
        threshold: 0.01,
      },
    );

    signal?.addEventListener("abort", handleAbort, { once: true });
    observer.observe(element);
  });
}

// Already exported above, no need to re-export

// Preload Google Maps connections early but non-blocking
if (typeof window !== "undefined") {
  const schedulePreload = () => {
    preconnectGoogleMaps();
  };

  // Start preloading as soon as DOM is ready (earlier than 'load' event)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedulePreload);
  } else {
    // DOM already loaded, schedule immediately
    schedulePreload();
  }
}
