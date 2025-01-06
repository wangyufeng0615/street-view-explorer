import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMapsScript } from '../utils/googleMaps';

export default function GlobalMap({ latitude, longitude }) {
    const mapRef = useRef(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        let mapInstance = null;
        let markerInstance = null;

        const initMap = async () => {
            try {
                const maps = await loadGoogleMapsScript();
                if (!isMounted) return;

                // 确保坐标是数字类型
                const lat = parseFloat(latitude);
                const lng = parseFloat(longitude);

                if (isNaN(lat) || isNaN(lng)) {
                    throw new Error('无效的坐标');
                }

                mapInstance = new maps.Map(mapRef.current, {
                    mapId: process.env.REACT_APP_GOOGLE_MAPS_MAP_ID,
                    center: { lat, lng },
                    zoom: 3,
                    mapTypeId: 'terrain',
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: false,
                    zoomControl: false,
                    disableDefaultUI: true,
                    gestureHandling: 'none'  // 禁用地图拖动和缩放
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

                // 添加脉动动画
                dot.style.animation = 'pulse 2s infinite';
                const style = document.createElement('style');
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

                // 创建标记点
                markerInstance = new maps.marker.AdvancedMarkerElement({
                    map: mapInstance,
                    position: { lat, lng },
                    content: dot,
                    zIndex: 1000
                });

                // 确保地图中心点和标记位置一致
                mapInstance.setCenter({ lat, lng });
            } catch (err) {
                if (isMounted) {
                    setError('地图加载失败');
                }
            }
        };

        initMap();

        return () => {
            isMounted = false;
            // 清理标记点
            if (markerInstance) {
                markerInstance.map = null;
                markerInstance = null;
            }
            // 清理地图实例
            if (mapInstance) {
                mapInstance = null;
            }
        };
    }, [latitude, longitude]);

    if (error) {
        return (
            <div style={{
                width: '100%',
                height: '150px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f5f5f5',
                borderRadius: '5px',
                color: '#666',
                marginTop: '10px'
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
                height: '150px',
                borderRadius: '5px',
                overflow: 'hidden',
                marginTop: '10px'
            }}
        />
    );
} 