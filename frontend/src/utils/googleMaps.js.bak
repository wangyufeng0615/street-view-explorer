import i18n from '../i18n';

// 全局状态管理
let googleMapsPromise = null;
let lastLoadedLanguage = null;
let isLoadingScript = false;
let isApiLoaded = false;

// 检查Google Maps API是否已经加载
function isGoogleMapsLoaded() {
    return !!(window.google && window.google.maps && window.google.maps.Map);
}

// 检查是否已有Google Maps script标签
function hasGoogleMapsScript() {
    return !!document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
}

// 生成唯一的回调函数名
function generateCallbackName() {
    return `initGoogleMaps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function loadGoogleMapsScript() {
    const currentLanguage = i18n.language || 'en';
    
    // 如果API已经完全加载且语言相同，直接返回resolved promise
    if (isApiLoaded && isGoogleMapsLoaded() && lastLoadedLanguage === currentLanguage) {
        return Promise.resolve(window.google.maps);
    }
    
    // 如果语言发生变化，需要重置和重新加载
    if (lastLoadedLanguage !== null && lastLoadedLanguage !== currentLanguage) {
        hardResetGoogleMapsPromise();
    }
    
    // 如果已经有promise在进行中，返回它
    if (googleMapsPromise) {
        return googleMapsPromise;
    }
    
    // 如果正在加载中，等待加载完成
    if (isLoadingScript) {
        googleMapsPromise = new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (isGoogleMapsLoaded()) {
                    clearInterval(checkInterval);
                    isApiLoaded = true;
                    resolve(window.google.maps);
                } else if (!isLoadingScript) {
                    clearInterval(checkInterval);
                    reject(new Error('Google Maps loading failed'));
                }
            }, 100);
            
            // 20秒超时
            setTimeout(() => {
                clearInterval(checkInterval);
                if (!isGoogleMapsLoaded()) {
                    reject(new Error('Google Maps loading timed out'));
                }
            }, 20000);
        });
        return googleMapsPromise;
    }
    
    // 开始新的加载过程
    isLoadingScript = true;
    lastLoadedLanguage = currentLanguage;
    
    googleMapsPromise = new Promise((resolve, reject) => {
        // 再次检查是否已经加载（双重检查）
        if (isGoogleMapsLoaded()) {
            isLoadingScript = false;
            isApiLoaded = true;
            resolve(window.google.maps);
            return;
        }
        
        // 清理可能存在的旧script标签
        cleanupExistingScripts();
        
        // 生成唯一的回调函数名
        const callbackName = generateCallbackName();
        
        // 设置超时处理
        const timeoutId = setTimeout(() => {
            isLoadingScript = false;
            cleanup();
            reject(new Error('Google Maps loading timed out after 20 seconds'));
        }, 20000);
        
        // 清理函数
        const cleanup = () => {
            clearTimeout(timeoutId);
            if (window[callbackName]) {
                delete window[callbackName];
            }
        };
        
        // 定义回调函数
        window[callbackName] = () => {
            cleanup();
            
            if (isGoogleMapsLoaded()) {
                isLoadingScript = false;
                isApiLoaded = true;
                resolve(window.google.maps);
            } else {
                isLoadingScript = false;
                reject(new Error('Google Maps failed to initialize properly'));
            }
        };
        
        // 创建script标签
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}&callback=${callbackName}&loading=async&libraries=marker&language=${currentLanguage}&v=weekly`;
        script.async = true;
        script.defer = true;
        script.setAttribute('data-google-maps', 'true');
        
        script.onerror = () => {
            isLoadingScript = false;
            cleanup();
            reject(new Error('Google Maps script loading error'));
        };
        
        document.head.appendChild(script);
    }).catch(err => {
        isLoadingScript = false;
        googleMapsPromise = null;
        throw err;
    });
    
    return googleMapsPromise;
}

// 清理现有的Google Maps script标签
function cleanupExistingScripts() {
    const existingScripts = document.querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"], script[data-google-maps="true"]');
    existingScripts.forEach(script => {
        if (script.parentNode) {
            script.parentNode.removeChild(script);
        }
    });
}

// 清理Google Maps相关对象
function cleanupGoogleMapsObjects() {
    if (window.google && window.google.maps) {
        // 删除所有地图实例的节点
        const mapNodes = document.querySelectorAll('.gm-style');
        mapNodes.forEach(node => {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        });
        
        // 语言切换时删除google对象
        try {
            if (lastLoadedLanguage !== null && lastLoadedLanguage !== (i18n.language || 'en')) {
                delete window.google;
                isApiLoaded = false;
            }
        } catch (e) {
            console.error('Failed to delete google object', e);
        }
    }
}

// 强制重置所有状态
function hardResetGoogleMapsPromise() {
    googleMapsPromise = null;
    lastLoadedLanguage = null;
    isLoadingScript = false;
    isApiLoaded = false;
    
    // 清理所有可能的回调函数
    Object.keys(window).forEach(key => {
        if (key.startsWith('initGoogleMaps')) {
            delete window[key];
        }
    });
    
    // 清理script标签
    cleanupExistingScripts();
    
    // 清理Google Maps对象
    cleanupGoogleMapsObjects();
}

export function resetGoogleMapsPromise() {
    hardResetGoogleMapsPromise();
} 