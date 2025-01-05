import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMapsScript } from '../utils/googleMaps';

const styles = {
    container: {
        width: '100%',
        height: '100%',
        position: 'relative'
    },
    errorContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        padding: '20px',
        textAlign: 'center',
        zIndex: 1000
    },
    errorIcon: {
        fontSize: '40px',
        color: '#ff4d4f',
        marginBottom: '15px'
    },
    errorText: {
        fontSize: '16px',
        color: '#333',
        marginBottom: '10px',
        fontWeight: '500'
    },
    errorSubText: {
        fontSize: '14px',
        color: '#666',
        maxWidth: '80%'
    }
};

export default function StreetView({ latitude, longitude, onPovChanged }) {
    const panoramaRef = useRef(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        let panorama = null;

        const initStreetView = async () => {
            try {
                // 验证坐标
                const lat = Number(latitude);
                const lng = Number(longitude);
                
                if (isNaN(lat) || isNaN(lng)) {
                    throw new Error('无效的坐标值');
                }

                const maps = await loadGoogleMapsScript();
                if (!isMounted) return;

                if (!panoramaRef.current) return;

                // 创建街景实例
                panorama = new maps.StreetViewPanorama(panoramaRef.current, {
                    position: { lat, lng },
                    pov: {
                        heading: 0,
                        pitch: 0,
                    },
                    zoom: 1,
                    visible: true,
                    motionTracking: false,
                    motionTrackingControl: false,
                    showRoadLabels: false,
                    addressControl: false,
                });

                // 监听视角变化
                panorama.addListener('pov_changed', () => {
                    if (onPovChanged) {
                        onPovChanged(panorama.getPov().heading);
                    }
                });
            } catch (err) {
                if (isMounted) {
                    setError('街景加载失败');
                }
            }
        };

        if (latitude && longitude) {
            initStreetView();
        }

        return () => {
            isMounted = false;
        };
    }, [latitude, longitude, onPovChanged]);

    return (
        <div style={styles.container}>
            <div ref={panoramaRef} style={{ width: '100%', height: '100%' }} />
            
            {error && (
                <div style={styles.errorContainer}>
                    <div style={styles.errorIcon}>⚠️</div>
                    <div style={styles.errorText}>{error}</div>
                    <div style={styles.errorSubText}>
                        建议尝试附近其他位置，或稍后再试
                    </div>
                </div>
            )}
        </div>
    );
}
