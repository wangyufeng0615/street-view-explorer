import i18n from '../i18n'; // Import i18n instance

// 在组件外部维护一个加载状态
let googleMapsPromise = null;
// 记录上次加载脚本时使用的语言
let lastLoadedLanguage = null;
// 标记脚本是否正在加载中
let isLoadingScript = false;

export function loadGoogleMapsScript() {
    // 检查当前语言与上次加载时使用的语言是否不同
    const currentLanguage = i18n.language || 'en';
    
    console.log(`loadGoogleMapsScript called with language: ${currentLanguage}, last loaded: ${lastLoadedLanguage}`);
    
    // 如果语言变了或者是首次加载，强制重置 Promise 和脚本
    if (lastLoadedLanguage !== null && lastLoadedLanguage !== currentLanguage) {
        console.log(`Language changed from ${lastLoadedLanguage} to ${currentLanguage}, hard resetting Google Maps`);
        // 使用强制重置方法
        hardResetGoogleMapsPromise();
        // 确保不会使用缓存的Promise
        googleMapsPromise = null;
    }
    
    // 如果 Promise 已经存在且不是正在加载中，且语言没变，返回它
    if (googleMapsPromise && !isLoadingScript && currentLanguage === lastLoadedLanguage) {
        return googleMapsPromise;
    }
    
    // 防止重复触发加载 - 如果已经在加载中，返回现有 Promise
    if (isLoadingScript) {
        console.log("Google Maps script is already loading, returning existing promise");
        // 如果 googleMapsPromise 不存在但 isLoadingScript=true，可能在创建 promise 之前
        // 就有另一个调用进来了，这时创建一个新的 promise 以避免返回 null
        if (!googleMapsPromise) {
            googleMapsPromise = new Promise((resolve, reject) => {
                // 每100ms检查一次 window.google.maps 是否可用
                const checkGoogleMaps = () => {
                    if (window.google && window.google.maps) {
                        console.log('Google Maps detected in window object during loading check');
                        resolve(window.google.maps);
                    } else if (!isLoadingScript) {
                        // 如果 isLoadingScript 已变为 false 但还没有 google.maps，说明加载失败
                        reject(new Error('Google Maps loading timed out'));
                    } else {
                        setTimeout(checkGoogleMaps, 100);
                    }
                };
                checkGoogleMaps();
            });
        }
        return googleMapsPromise;
    }
    
    // 标记脚本正在加载
    isLoadingScript = true;
    
    // 记录当前要加载的语言
    lastLoadedLanguage = currentLanguage;
    console.log(`Creating new Google Maps promise with language: ${currentLanguage}`);

    googleMapsPromise = new Promise((resolve, reject) => {
        // 清理之前的任何GoogleMaps对象和状态
        cleanupGoogleMapsObjects();
        
        // 检查是否已经有script标签，移除它
        const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
        if (existingScript) {
            console.log('Found existing Google Maps script tag, removing it');
            existingScript.remove();
        }

        // 设置超时处理，避免永远等待
        const timeoutId = setTimeout(() => {
            if (isLoadingScript) {
                console.error('Google Maps loading timed out after 20 seconds');
                isLoadingScript = false;
                
                // 如果超时，重置所有状态
                hardResetGoogleMapsPromise();
                reject(new Error('Google Maps loading timed out'));
            }
        }, 20000);

        // 定义回调函数
        window.initGoogleMaps = () => {
            // 清除超时定时器
            clearTimeout(timeoutId);
            
            if (window.google && window.google.maps) {
                console.log(`Google Maps initialized with language: ${currentLanguage}`);
                isLoadingScript = false;
                resolve(window.google.maps);
            } else {
                console.error('Google Maps failed to initialize properly');
                isLoadingScript = false;
                hardResetGoogleMapsPromise(); // 确保清理干净
                reject(new Error(i18n.t('error.googleMapsLoadFailed', 'Google Maps failed to load'))); // Translate error
            }
        };

        console.log(`Loading Google Maps script with language: ${currentLanguage}`);
        const script = document.createElement('script');
        // 添加随机数参数以避免浏览器缓存
        script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}&callback=initGoogleMaps&loading=async&libraries=marker&language=${currentLanguage}&v=${new Date().getTime()}`;
        script.async = true;
        script.defer = true;
        script.onerror = () => {
            // 清除超时定时器
            clearTimeout(timeoutId);
            
            console.error('Google Maps script loading error');
            hardResetGoogleMapsPromise(); // 确保清理干净
            reject(new Error(i18n.t('error.googleMapsLoadFailed', 'Google Maps failed to load'))); // Translate error
        };

        document.head.appendChild(script);
    }).catch(err => {
        // 确保即使出错也会重置状态
        isLoadingScript = false;
        throw err;
    });

    return googleMapsPromise;
}

// 清理Google Maps相关对象的函数
function cleanupGoogleMapsObjects() {
    // 尝试移除可能存在的Google Maps实例
    if (window.google && window.google.maps) {
        // 删除所有地图实例的节点
        const mapNodes = document.querySelectorAll('.gm-style');
        mapNodes.forEach(node => {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        });
        
        // 尝试删除google对象 (这是一个激进的操作，可能影响到其他Google服务)
        // 只在我们确定需要完全重新加载时执行
        try {
            if (lastLoadedLanguage !== null && lastLoadedLanguage !== (i18n.language || 'en')) {
                console.log('Removing google global object due to language change');
                delete window.google;
            }
        } catch (e) {
            console.error('Failed to delete google object', e);
        }
    }
}

// 柔和重置 - 仅重置 Promise，不移除对象，避免破坏过多状态
function softResetGoogleMapsPromise() {
    console.log('Soft resetting Google Maps state...');
    
    // 只重置 Promise，允许重新加载脚本
    googleMapsPromise = null;
    
    // 重置语言标记，但不清理其他对象
    lastLoadedLanguage = null;
    
    // 重置加载状态
    isLoadingScript = false;
    
    // 为保险起见，删除回调函数，避免多个回调冲突
    if (window.initGoogleMaps) {
        delete window.initGoogleMaps;
    }
    
    console.log('Google Maps soft reset complete. Ready for new initialization');
}

// 强制重置 - 完全清理所有 Google Maps 相关状态
function hardResetGoogleMapsPromise() {
    console.log('Hard resetting Google Maps state...');
    
    // 重置 Promise
    googleMapsPromise = null;
    
    // 重置语言标记
    lastLoadedLanguage = null;
    
    // 重置加载状态
    isLoadingScript = false;
    
    // 删除回调函数
    if (window.initGoogleMaps) {
        delete window.initGoogleMaps;
    }
    
    // 移除现有脚本
    const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existingScript) {
        console.log('Removing existing Google Maps script tag');
        existingScript.remove();
    }
    
    // 清理Google Maps对象
    cleanupGoogleMapsObjects();
    
    console.log('Google Maps hard reset complete');
}

// 函数名不变，但内部实现改为强制重置
export function resetGoogleMapsPromise() {
    // 使用强制重置
    hardResetGoogleMapsPromise();
} 