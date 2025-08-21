import i18n from '../i18n';

// 全局状态管理
let googleMapsPromise = null;
let lastLoadedLanguage = null;
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
    const existingScripts = document.querySelectorAll('script[data-google-maps="true"], script[src*="maps.googleapis.com/maps/api/js"]');
    existingScripts.forEach(script => {
        script.remove();
    });
}

/**
 * Preload Google Maps API (just establish connection, don't execute)
 */
export function preloadGoogleMaps() {
    // Only preconnect, don't actually load the script
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://maps.googleapis.com';
    document.head.appendChild(link);
    
    // Also prefetch the actual script URL without executing
    const prefetchLink = document.createElement('link');
    prefetchLink.rel = 'prefetch';
    prefetchLink.href = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&loading=async&libraries=marker&language=${i18n.language}&v=weekly`;
    document.head.appendChild(prefetchLink);
}

/**
 * Load Google Maps Script with improved performance
 * - Uses IntersectionObserver for viewport-based loading
 * - Implements request idle callback for non-blocking load
 * - Adds performance marks for monitoring
 */
export function loadGoogleMapsScript() {
    const currentLanguage = i18n.language || 'en';
    
    // Mark performance timing
    if (window.performance && window.performance.mark) {
        window.performance.mark('googleMapsLoadStart');
    }
    
    // If API already loaded with same language, return immediately
    if (isApiLoaded && isGoogleMapsLoaded() && lastLoadedLanguage === currentLanguage) {
        return Promise.resolve(window.google.maps);
    }
    
    // If language changed, need to reload
    if (lastLoadedLanguage !== null && lastLoadedLanguage !== currentLanguage) {
        hardResetGoogleMapsPromise();
    }
    
    // 防止多次加载尝试
    if (loadAttemptCount > 0 && isGoogleMapsLoaded()) {
        isApiLoaded = true;
        lastLoadedLanguage = currentLanguage;
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
    lastLoadedLanguage = currentLanguage;
    loadAttemptCount++;
    
    googleMapsPromise = new Promise((resolve, reject) => {
        // Check if already loaded
        if (isGoogleMapsLoaded()) {
            isLoadingScript = false;
            isApiLoaded = true;
            if (window.performance && window.performance.mark) {
                window.performance.mark('googleMapsLoadEnd');
                window.performance.measure('googleMapsLoadTime', 'googleMapsLoadStart', 'googleMapsLoadEnd');
            }
            resolve(window.google.maps);
            return;
        }
        
        // Use requestIdleCallback for non-blocking load
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
                reject(new Error('Google Maps loading timed out'));
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
                        window.performance.mark('googleMapsLoadEnd');
                        window.performance.measure('googleMapsLoadTime', 'googleMapsLoadStart', 'googleMapsLoadEnd');
                    }
                    
                    // Resolve main promise
                    resolve(window.google.maps);
                    
                    // Resolve any deferred promises
                    deferredLoadResolvers.forEach(({ resolve }) => resolve(window.google.maps));
                    deferredLoadResolvers = [];
                } else {
                    isLoadingScript = false;
                    const error = new Error('Google Maps failed to initialize');
                    reject(error);
                    deferredLoadResolvers.forEach(({ reject }) => reject(error));
                    deferredLoadResolvers = [];
                }
            };
            
            // Create and append script
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&callback=${callbackName}&loading=async&libraries=marker&language=${currentLanguage}&v=weekly`;
            script.async = true;
            script.defer = true;
            script.setAttribute('data-google-maps', 'true');
            
            // Error handling
            script.onerror = () => {
                isLoadingScript = false;
                cleanup();
                const error = new Error('Google Maps script loading error');
                reject(error);
                deferredLoadResolvers.forEach(({ reject }) => reject(error));
                deferredLoadResolvers = [];
            };
            
            document.head.appendChild(script);
        };
        
        // Use requestIdleCallback if available, otherwise setTimeout
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(loadScript, { timeout: 2000 });
        } else {
            setTimeout(loadScript, 0);
        }
    }).catch(err => {
        isLoadingScript = false;
        googleMapsPromise = null;
        throw err;
    });
    
    return googleMapsPromise;
}

/**
 * Load Google Maps when element becomes visible
 * Uses IntersectionObserver for viewport-based loading
 */
export function loadGoogleMapsWhenVisible(element) {
    if (!element) {
        return loadGoogleMapsScript();
    }
    
    return new Promise((resolve, reject) => {
        // If IntersectionObserver is not supported, load immediately
        if (!('IntersectionObserver' in window)) {
            loadGoogleMapsScript().then(resolve).catch(reject);
            return;
        }
        
        // Create observer
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        observer.disconnect();
                        loadGoogleMapsScript().then(resolve).catch(reject);
                    }
                });
            },
            {
                root: null,
                rootMargin: '50px', // Start loading 50px before element is visible
                threshold: 0.01
            }
        );
        
        observer.observe(element);
    });
}

/**
 * Hard reset Google Maps promise
 */
export function hardResetGoogleMapsPromise() {
    // Reset all flags
    googleMapsPromise = null;
    isLoadingScript = false;
    isApiLoaded = false;
    lastLoadedLanguage = null;
    
    // Clean up scripts
    cleanupExistingScripts();
    
    // Clean up Google Maps global
    if (window.google && window.google.maps) {
        // Try to clean up Google Maps objects
        try {
            delete window.google.maps;
            delete window.google;
        } catch (e) {
            // Some browsers don't allow deleting window properties
            window.google = undefined;
        }
    }
}

// Already exported above, no need to re-export

// Preload on page load (just connection, not script)
if (typeof window !== 'undefined') {
    // Wait a bit after page load to avoid competing with critical resources
    window.addEventListener('load', () => {
        setTimeout(preloadGoogleMaps, 1000);
    });
}