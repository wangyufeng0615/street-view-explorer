// 在组件外部维护一个加载状态
let googleMapsPromise = null;

export function loadGoogleMapsScript() {
    if (googleMapsPromise) {
        return googleMapsPromise;
    }

    googleMapsPromise = new Promise((resolve, reject) => {
        if (window.google && window.google.maps) {
            resolve(window.google.maps);
            return;
        }

        // 检查是否已经有script标签
        const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => {
                if (window.google && window.google.maps) {
                    resolve(window.google.maps);
                } else {
                    reject(new Error('Google Maps 加载失败'));
                }
            });
            existingScript.addEventListener('error', () => {
                reject(new Error('Google Maps 加载失败'));
            });
            return;
        }

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}`;
        script.async = true;
        script.defer = true;
        script.onerror = () => {
            googleMapsPromise = null;
            reject(new Error('Google Maps 加载失败'));
        };
        script.onload = () => {
            if (window.google && window.google.maps) {
                resolve(window.google.maps);
            } else {
                googleMapsPromise = null;
                reject(new Error('Google Maps 加载失败'));
            }
        };
        document.head.appendChild(script);
    });

    return googleMapsPromise;
} 