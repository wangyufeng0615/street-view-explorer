import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { loadGoogleMapsScript } from '../utils/googleMaps';

export default function GlobalMap({ latitude, longitude }) {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markerInstanceRef = useRef(null);
    const [error, setError] = useState(null);
    const { t } = useTranslation();

    // 参数验证
    if (latitude === undefined || longitude === undefined) {
        console.warn('GlobalMap: Missing coordinates', { latitude, longitude });
        return (
            <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f5f5f5',
                borderRadius: '8px',
                color: '#666',
                minHeight: '200px'
            }}>
                {t('loading_location')}
            </div>
        );
    }

    // 使用useCallback确保initMap函数引用稳定
    const initMap = useCallback(async () => {
        if (!mapRef.current) return;
        
        try {
            const maps = await loadGoogleMapsScript();
            
            // 再次检查组件是否仍然挂载且DOM元素存在
            if (!mapRef.current) return;

            // 确保坐标是数字类型
            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);

            if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
                console.error('Invalid coordinates for GlobalMap:', { latitude, longitude, lat, lng });
                throw new Error(t('error.invalidCoordinates'));
            }

            // 如果已经有地图实例，清理它
            if (mapInstanceRef.current) {
                mapInstanceRef.current = null;
            }
            if (markerInstanceRef.current) {
                markerInstanceRef.current.map = null;
                markerInstanceRef.current = null;
            }

            // 创建新的地图实例
            mapInstanceRef.current = new maps.Map(mapRef.current, {
                mapId: process.env.REACT_APP_GOOGLE_MAPS_MAP_ID,
                center: { lat, lng },
                zoom: 3,
                mapTypeId: 'terrain',
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                zoomControl: false,
                disableDefaultUI: true,
                gestureHandling: 'none'
            });

            // 创建自定义红点标记
            const dot = document.createElement('div');
            dot.style.width = '8px';
            dot.style.height = '8px';
            dot.style.borderRadius = '50%';
            dot.style.backgroundColor = '#FF4444';
            dot.style.border = '2px solid #FFFFFF';
            dot.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
            dot.style.position = 'absolute';
            dot.style.left = '-4px';
            dot.style.top = '-4px';
            dot.style.animation = 'pulse 2s infinite';

            // 只添加一次样式
            if (!document.querySelector('#globalmap-styles')) {
                const style = document.createElement('style');
                style.id = 'globalmap-styles';
                style.textContent = `
                    @keyframes pulse {
                        0% {
                            box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4);
                        }
                        70% {
                            box-shadow: 0 0 0 6px rgba(255, 68, 68, 0);
                        }
                        100% {
                            box-shadow: 0 0 0 0 rgba(255, 68, 68, 0);
                        }
                    }
                    .gm-style-cc { display: none; }
                    a[href^="http://maps.google.com/maps"]{display:none !important}
                    a[href^="https://maps.google.com/maps"]{display:none !important}
                    .gmnoprint a, .gmnoprint span, .gm-style-cc {
                        display:none;
                    }
                    .gmnoprint div {
                        background:none !important;
                    }
                `;
                document.head.appendChild(style);
            }

            // 创建标记点
            markerInstanceRef.current = new maps.marker.AdvancedMarkerElement({
                map: mapInstanceRef.current,
                position: { lat, lng },
                content: dot,
                zIndex: 1000
            });

            // 确保地图中心点和标记位置一致
            mapInstanceRef.current.setCenter({ lat, lng });
            
            // 清除错误状态
            setError(null);
        } catch (err) {
            console.error('GlobalMap initialization error:', err);
            setError(t('error.mapLoadFailed'));
        }
    }, [latitude, longitude, t]);

    useEffect(() => {
        let isMounted = true;
        
        // 延迟执行以避免React Strict Mode的重复调用
        const timeoutId = setTimeout(() => {
            if (isMounted) {
                initMap();
            }
        }, 0);

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            
            // 清理地图实例
            if (markerInstanceRef.current) {
                markerInstanceRef.current.map = null;
                markerInstanceRef.current = null;
            }
            if (mapInstanceRef.current) {
                mapInstanceRef.current = null;
            }
        };
    }, [initMap]);

    if (error) {
        return (
            <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f5f5f5',
                borderRadius: '8px',
                color: '#666',
                minHeight: '200px'
            }}>
                {error}
            </div>
        );
    }

    return (
        <div 
            ref={mapRef} 
            style={{
                width: '100%',
                height: '100%',
                borderRadius: '8px',
                overflow: 'hidden',
                minHeight: '200px'
            }}
        />
    );
} 