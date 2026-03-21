import i18n from '../i18n';

let baiduMapsPromise = null;
let isLoadingScript = false;
let isApiLoaded = false;
let deferredLoadResolvers = [];

function isBaiduMapsLoaded() {
    return !!(window.BMapGL && window.BMapGL.Map);
}

function generateCallbackName() {
    return `initBaiduMaps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function cleanupExistingScripts() {
    const existingScripts = document.querySelectorAll('script[data-baidu-maps="true"], script[src*="api.map.baidu.com"]');
    existingScripts.forEach(script => script.remove());
}

export function preloadBaiduMaps() {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://api.map.baidu.com';
    document.head.appendChild(link);
}

export function loadBaiduMapsScript() {
    if (isApiLoaded && isBaiduMapsLoaded()) {
        return Promise.resolve(window.BMapGL);
    }

    if (baiduMapsPromise) {
        return baiduMapsPromise;
    }

    if (isLoadingScript) {
        return new Promise((resolve, reject) => {
            deferredLoadResolvers.push({ resolve, reject });
        });
    }

    isLoadingScript = true;

    baiduMapsPromise = new Promise((resolve, reject) => {
        if (isBaiduMapsLoaded()) {
            isLoadingScript = false;
            isApiLoaded = true;
            resolve(window.BMapGL);
            return;
        }

        const loadScript = () => {
            if (isBaiduMapsLoaded()) {
                isLoadingScript = false;
                isApiLoaded = true;
                resolve(window.BMapGL);
                return;
            }

            cleanupExistingScripts();

            const callbackName = generateCallbackName();

            const timeoutId = setTimeout(() => {
                isLoadingScript = false;
                cleanup();
                reject(new Error('Baidu Maps loading timed out'));
            }, 30000);

            const cleanup = () => {
                clearTimeout(timeoutId);
                if (window[callbackName]) {
                    delete window[callbackName];
                }
            };

            window[callbackName] = () => {
                cleanup();
                if (isBaiduMapsLoaded()) {
                    isLoadingScript = false;
                    isApiLoaded = true;
                    resolve(window.BMapGL);
                    deferredLoadResolvers.forEach(({ resolve }) => resolve(window.BMapGL));
                    deferredLoadResolvers = [];
                } else {
                    isLoadingScript = false;
                    const error = new Error('Baidu Maps failed to initialize');
                    reject(error);
                    deferredLoadResolvers.forEach(({ reject }) => reject(error));
                    deferredLoadResolvers = [];
                }
            };

            const script = document.createElement('script');
            script.src = `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${import.meta.env.VITE_BAIDU_MAP_AK}&callback=${callbackName}`;
            script.async = true;
            script.defer = true;
            script.setAttribute('data-baidu-maps', 'true');

            script.onerror = () => {
                isLoadingScript = false;
                cleanup();
                const error = new Error('Baidu Maps script loading error');
                reject(error);
                deferredLoadResolvers.forEach(({ reject }) => reject(error));
                deferredLoadResolvers = [];
            };

            document.head.appendChild(script);
        };

        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(loadScript, { timeout: 2000 });
        } else {
            setTimeout(loadScript, 0);
        }
    }).catch(err => {
        isLoadingScript = false;
        baiduMapsPromise = null;
        throw err;
    });

    return baiduMapsPromise;
}

export function loadBaiduMapsWhenVisible(element) {
    if (!element) {
        return loadBaiduMapsScript();
    }

    return new Promise((resolve, reject) => {
        if (!('IntersectionObserver' in window)) {
            loadBaiduMapsScript().then(resolve).catch(reject);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        observer.disconnect();
                        loadBaiduMapsScript().then(resolve).catch(reject);
                    }
                });
            },
            { root: null, rootMargin: '50px', threshold: 0.01 }
        );

        observer.observe(element);
    });
}
