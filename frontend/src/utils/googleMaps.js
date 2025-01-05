// 在组件外部维护一个加载状态
let googleMapsPromise = null;

export function loadGoogleMapsScript() {
    if (googleMapsPromise) {
        return googleMapsPromise;
    }

    googleMapsPromise = new Promise((resolve, reject) => {
        // 如果已经加载完成
        if (window.google && window.google.maps) {
            resolve(window.google.maps);
            return;
        }

        // 检查是否已经有script标签
        const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
        if (existingScript) {
            // 等待加载完成
            const checkGoogleMaps = () => {
                if (window.google && window.google.maps) {
                    resolve(window.google.maps);
                } else {
                    setTimeout(checkGoogleMaps, 100);
                }
            };
            checkGoogleMaps();
            return;
        }

        // 定义回调函数
        window.initGoogleMaps = () => {
            if (window.google && window.google.maps) {
                resolve(window.google.maps);
            } else {
                reject(new Error('Google Maps 加载失败'));
            }
        };

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}&callback=initGoogleMaps&loading=async&libraries=marker`;
        script.async = true;
        script.defer = true;
        script.onerror = () => {
            googleMapsPromise = null;
            reject(new Error('Google Maps 加载失败'));
        };

        document.head.appendChild(script);
    });

    return googleMapsPromise;
} 