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
                    center: { lat: latitude, lng: longitude },
                    zoom: 14,
                    mapTypeId: 'roadmap',
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: false,
                    zoomControl: true,
                    zoomControlOptions: {
                        position: maps.ControlPosition.RIGHT_TOP
                    }
                });

                // 添加位置标记
                const marker = new maps.Marker({
                    position: { lat: latitude, lng: longitude },
                    map: map
                });
            } catch (err) {
                if (isMounted) {
                    setError('地图加载失败');
                    console.error('地图加载错误:', err);
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