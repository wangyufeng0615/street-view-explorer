import React, { useEffect, useRef, useState } from 'react';

// 在组件外部维护一个加载状态
let googleMapsPromise = null;

function loadGoogleMapsScript() {
    if (googleMapsPromise) {
        return googleMapsPromise;
    }

    googleMapsPromise = new Promise((resolve, reject) => {
        if (window.google && window.google.maps) {
            console.log('Google Maps 已经加载，直接使用');
            resolve(window.google.maps);
            return;
        }

        // 检查是否已经有script标签
        const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
        if (existingScript) {
            console.log('发现已存在的 Google Maps 脚本标签');
            // 如果已经有script标签，等待它加载完成
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

        console.log('创建新的 Google Maps 脚本标签');
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.REACT_APP_GOOGLE_MAPS_API_KEY}`;
        script.async = true;
        script.defer = true;
        script.onerror = (e) => {
            console.error('Google Maps 脚本加载失败:', e);
            googleMapsPromise = null;
            reject(new Error('Google Maps 加载失败'));
        };
        script.onload = () => {
            console.log('Google Maps 脚本加载完成');
            if (window.google && window.google.maps) {
                resolve(window.google.maps);
            } else {
                console.error('Google Maps API 未能正确初始化');
                googleMapsPromise = null;
                reject(new Error('Google Maps 加载失败'));
            }
        };
        document.head.appendChild(script);
    });

    return googleMapsPromise;
}

export default function StreetView({ latitude, longitude }) {
    // 验证位置是否有效
    const isValidLocation = typeof latitude === 'number' && 
                          typeof longitude === 'number' && 
                          !isNaN(latitude) && 
                          !isNaN(longitude) && 
                          latitude !== 0 && 
                          longitude !== 0;

    console.log('StreetView 组件渲染，位置:', { latitude, longitude, isValidLocation });

    const mapRef = useRef(null);
    const panoRef = useRef(null);
    const [error, setError] = useState(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [maps, setMaps] = useState(null);
    const [isInitialized, setIsInitialized] = useState(false);

    // 重置初始化状态当位置改变时
    useEffect(() => {
        if (isInitialized) {
            console.log('位置改变，重置初始化状态');
            setIsInitialized(false);
            setIsLoaded(false);
            setError(null);
        }
    }, [latitude, longitude]);

    // 加载 Google Maps API
    useEffect(() => {
        console.log('加载 Maps API useEffect 触发');
        let isMounted = true;

        const loadMaps = async () => {
            if (!isValidLocation) {
                console.log('位置无效，跳过加载');
                return;
            }

            try {
                console.log('开始加载 Google Maps API');
                const mapsInstance = await loadGoogleMapsScript();
                console.log('Google Maps API 加载成功');
                if (isMounted) {
                    setMaps(mapsInstance);
                }
            } catch (err) {
                console.error('加载 Google Maps API 时出错:', err);
                if (isMounted) {
                    setError('Google Maps API 加载失败: ' + err.message);
                }
            }
        };

        if (!maps) {
            loadMaps();
        } else {
            console.log('Maps API 已加载，跳过');
        }

        return () => {
            console.log('Maps API useEffect 清理');
            isMounted = false;
        };
    }, [isValidLocation]);

    // 初始化地图和街景
    useEffect(() => {
        console.log('初始化 useEffect 触发，状态:', {
            hasMaps: !!maps,
            hasMapRef: !!mapRef.current,
            hasPanoRef: !!panoRef.current,
            isInitialized,
            isValidLocation
        });

        if (!maps || !mapRef.current || !panoRef.current || isInitialized || !isValidLocation) {
            return;
        }

        let isMounted = true;
        console.log('开始初始化地图和街景视图');

        try {
            const position = { lat: latitude, lng: longitude };
            console.log('使用位置:', position);

            // 创建地图实例
            const map = new maps.Map(mapRef.current, {
                center: position,
                zoom: 14,
                fullscreenControl: false,
                streetViewControl: false
            });
            console.log('地图实例创建成功');

            // 创建街景实例
            const panorama = new maps.StreetViewPanorama(panoRef.current, {
                position: position,
                pov: {
                    heading: 34,
                    pitch: 10
                },
                fullscreenControl: false,
                showRoadLabels: false,
                motionTracking: false
            });
            console.log('街景实例创建成功');

            // 将地图和街景关联
            map.setStreetView(panorama);
            console.log('地图和街景关联成功');

            // 检查街景是否可用
            const service = new maps.StreetViewService();
            service.getPanorama({ 
                location: position,
                radius: 50,
                source: maps.StreetViewSource.OUTDOOR
            }, (data, status) => {
                if (!isMounted) return;
                
                console.log('街景数据状态:', status);
                if (status === 'OK') {
                    setIsInitialized(true);
                    setIsLoaded(true);
                    setError(null);
                } else {
                    console.error('无法加载街景数据:', status);
                    setError('该位置没有街景数据');
                    setIsLoaded(true);
                }
            });
        } catch (err) {
            console.error('初始化地图和街景时出错:', err);
            if (isMounted) {
                setError('初始化失败: ' + err.message);
                setIsLoaded(true);
            }
        }

        return () => {
            console.log('初始化 useEffect 清理');
            isMounted = false;
        };
    }, [maps, latitude, longitude, isInitialized, isValidLocation]);

    if (!isValidLocation) {
        return (
            <div style={{ 
                width: '100%',
                height: '400px',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                border: '1px solid #ccc',
                backgroundColor: '#f5f5f5',
                flexDirection: 'column',
                padding: '20px',
                textAlign: 'center'
            }}>
                <div>等待位置数据...</div>
            </div>
        );
    }

    // 始终渲染容器，即使在加载状态下
    return (
        <div style={{ display: 'flex', width: '100%', height: '400px', gap: '10px' }}>
            <div 
                ref={mapRef} 
                style={{ 
                    flex: 1,
                    border: '1px solid #ccc'
                }} 
            />
            <div 
                ref={panoRef} 
                style={{ 
                    flex: 1,
                    border: '1px solid #ccc'
                }} 
            />
            {(error || !isLoaded) && (
                <div style={{ 
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(245, 245, 245, 0.9)',
                    flexDirection: 'column',
                    padding: '20px',
                    textAlign: 'center'
                }}>
                    <div>{error || '加载中...'}</div>
                    <div style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
                        位置: {latitude}, {longitude}
                    </div>
                </div>
            )}
        </div>
    );
}
