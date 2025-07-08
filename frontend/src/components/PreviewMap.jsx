import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { loadGoogleMapsScript } from '../utils/googleMaps';

export default function PreviewMap({ latitude, longitude }) {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markerInstanceRef = useRef(null);
    const [error, setError] = useState(null);
    const { t } = useTranslation();

    const initMap = useCallback(async () => {
        if (!mapRef.current) return;
        
        try {
            const maps = await loadGoogleMapsScript();
            if (!mapRef.current) return;

            // 清理之前的实例
            if (mapInstanceRef.current) {
                mapInstanceRef.current = null;
            }
            if (markerInstanceRef.current) {
                markerInstanceRef.current.map = null;
                markerInstanceRef.current = null;
            }

            // 创建地图实例
            mapInstanceRef.current = new maps.Map(mapRef.current, {
                mapId: process.env.REACT_APP_GOOGLE_MAPS_MAP_ID,
                center: { lat: latitude, lng: longitude },
                zoom: 13,
                mapTypeId: 'roadmap',
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                zoomControl: true,
                disableDefaultUI: true,
                zoomControlOptions: {
                    position: maps.ControlPosition.RIGHT_TOP
                }
            });

            // 只添加一次样式
            if (!document.querySelector('#previewmap-styles')) {
                const style = document.createElement('style');
                style.id = 'previewmap-styles';
                style.textContent = `
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

            // 创建图钉标记
            const pin = document.createElement('div');
            pin.innerHTML = `
                <svg width="32" height="32" viewBox="0 0 32 32" style="position: absolute; left: -16px; top: -32px;">
                    <path d="M16 0C10.477 0 6 4.477 6 10c0 7 10 22 10 22s10-15 10-22c0-5.523-4.477-10-10-10zm0 14a4 4 0 110-8 4 4 0 010 8z" 
                          fill="#FF4444" 
                          stroke="#FFFFFF" 
                          stroke-width="1.5"/>
                </svg>
            `;
            pin.style.position = 'relative';
            pin.style.width = '0';
            pin.style.height = '0';

            markerInstanceRef.current = new maps.marker.AdvancedMarkerElement({
                map: mapInstanceRef.current,
                position: { lat: latitude, lng: longitude },
                content: pin,
                zIndex: 1000
            });

            // 确保地图中心点和标记位置一致
            mapInstanceRef.current.setCenter({ lat: latitude, lng: longitude });
            
            // 清除错误状态
            setError(null);
        } catch (err) {
            console.error('PreviewMap initialization error:', err);
            setError(t('error.mapLoadFailed'));
        }
    }, [latitude, longitude, t]);

    useEffect(() => {
        let isMounted = true;
        
        // 延迟执行以避免与其他地图组件的竞态条件
        const timeoutId = setTimeout(() => {
            if (isMounted) {
                initMap();
            }
        }, 100); // 比GlobalMap稍微延迟一点

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