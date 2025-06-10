import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadGoogleMapsScript } from '../utils/googleMaps';

export default function PreviewMap({ latitude, longitude }) {
    const mapRef = useRef(null);
    const [error, setError] = useState(null);
    const { t } = useTranslation();

    useEffect(() => {
        let isMounted = true;

        const initMap = async () => {
            try {
                const maps = await loadGoogleMapsScript();
                if (!isMounted) return;

                const map = new maps.Map(mapRef.current, {
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

                // 隐藏 Google logo 和版权信息
                const style = document.createElement('style');
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

                const markerView = new maps.marker.AdvancedMarkerElement({
                    map,
                    position: { lat: latitude, lng: longitude },
                    content: pin,
                    zIndex: 1000
                });

                // 确保地图中心点和标记位置一致
                map.setCenter({ lat: latitude, lng: longitude });
            } catch (err) {
                if (isMounted) {
                    setError(t('error.mapLoadFailed'));
                }
            }
        };

        initMap();

        return () => {
            isMounted = false;
        };
    }, [latitude, longitude, t]);

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