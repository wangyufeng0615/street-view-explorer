import React, { useEffect, useRef } from 'react';
import { loadGoogleMapsScript } from '../utils/googleMaps';

export default function StreetView({ latitude, longitude, onPovChanged }) {
    const panoramaRef = useRef(null);
    const [error, setError] = React.useState(null);

    useEffect(() => {
        let isMounted = true;

        const initStreetView = async () => {
            try {
                const maps = await loadGoogleMapsScript();
                if (!isMounted) return;

                const panorama = new maps.StreetViewPanorama(
                    panoramaRef.current,
                    {
                        position: { lat: latitude, lng: longitude },
                        pov: { heading: 0, pitch: 0 },
                        zoom: 1,
                        addressControl: false,
                        showRoadLabels: false,
                        zoomControl: false,
                        panControl: false,
                        fullscreenControl: false,
                        motionTracking: false,
                        motionTrackingControl: false,
                        enableCloseButton: false,
                        linksControl: false
                    }
                );

                // 监听视角变化
                panorama.addListener('pov_changed', () => {
                    const pov = panorama.getPov();
                    onPovChanged && onPovChanged(pov.heading);
                });

                // 检查街景是否可用
                const service = new maps.StreetViewService();
                service.getPanorama({
                    location: { lat: latitude, lng: longitude },
                    radius: 50,
                    source: maps.StreetViewSource.OUTDOOR
                }, (data, status) => {
                    if (!isMounted) return;
                    if (status !== 'OK') {
                        setError('该位置没有街景数据');
                    }
                });
            } catch (err) {
                if (isMounted) {
                    setError('加载街景失败');
                    console.error('街景加载错误:', err);
                }
            }
        };

        initStreetView();

        return () => {
            isMounted = false;
        };
    }, [latitude, longitude, onPovChanged]);

    if (error) {
        return (
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f5f5f5',
                color: '#666',
                fontSize: '18px'
            }}>
                {error}
            </div>
        );
    }

    return (
        <div 
            ref={panoramaRef} 
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1
            }}
        />
    );
}
