import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMapsScript } from '../utils/googleMaps';

export default function PreviewMap({ latitude, longitude }) {
    const mapRef = useRef(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;

        const initMap = async () => {
            try {
                const maps = await loadGoogleMapsScript();
                if (!isMounted) return;

                const map = new maps.Map(mapRef.current, {
                    mapId: process.env.REACT_APP_GOOGLE_MAPS_MAP_ID,
                    center: { lat: latitude, lng: longitude },
                    zoom: 14,
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
                pin.innerHTML = '📍';
                pin.style.fontSize = '32px';
                pin.style.lineHeight = '1';
                pin.style.textAlign = 'center';
                pin.style.transform = 'translate(-50%, -50%)';
                pin.style.marginTop = '-8px'; // 微调位置

                const markerView = new maps.marker.AdvancedMarkerElement({
                    map,
                    position: { lat: latitude, lng: longitude },
                    content: pin
                });
            } catch (err) {
                if (isMounted) {
                    setError('地图加载失败');
                }
            }
        };

        initMap();

        return () => {
            isMounted = false;
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