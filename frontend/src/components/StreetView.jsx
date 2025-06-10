import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '30px 20px',
        textAlign: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)'
    },
    errorIcon: {
        fontSize: '48px',
        marginBottom: '20px',
        animation: 'pulse 2s infinite'
    },
    errorText: {
        fontSize: '18px',
        color: '#333',
        marginBottom: '12px',
        fontWeight: '600',
        lineHeight: '1.4',
        maxWidth: '400px'
    },
    errorSubText: {
        fontSize: '14px',
        color: '#666',
        maxWidth: '300px',
        lineHeight: '1.5'
    }
};

export default function StreetView({ latitude, longitude, onPovChanged }) {
    const panoramaRef = useRef(null);
    const [error, setError] = useState(null);
    const [isNetworkError, setIsNetworkError] = useState(false);
    const { t } = useTranslation();

    useEffect(() => {
        let isMounted = true;
        let panorama = null;

        const initStreetView = async () => {
            try {
                setError(null);
                setIsNetworkError(false);
                
                // 验证坐标
                const lat = Number(latitude);
                const lng = Number(longitude);
                
                if (isNaN(lat) || isNaN(lng)) {
                    throw new Error(t('error.invalidCoordinateValues'));
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

                // 监听街景状态变化
                panorama.addListener('status_changed', () => {
                    if (!isMounted) return;
                    
                    const status = panorama.getStatus();
                    if (status !== 'OK') {
                        // 街景数据不可用
                        setError(t('error.streetViewNotAvailable'));
                        setIsNetworkError(false);
                    }
                });

                // 监听视角变化
                panorama.addListener('pov_changed', () => {
                    if (onPovChanged) {
                        onPovChanged(panorama.getPov().heading);
                    }
                });

                // 设置加载超时
                const timeoutId = setTimeout(() => {
                    if (isMounted) {
                        setError(t('error.networkConnectionFailed'));
                        setIsNetworkError(true);
                    }
                }, 10000); // 10秒超时

                // 监听成功加载
                panorama.addListener('pano_changed', () => {
                    clearTimeout(timeoutId);
                    if (isMounted) {
                        setError(null);
                        setIsNetworkError(false);
                    }
                });

            } catch (err) {
                if (isMounted) {
                    console.error('StreetView initialization error:', err);
                    
                    // 判断是否为网络相关错误
                    const isNetworkIssue = err.message?.includes('network') || 
                                          err.message?.includes('timeout') || 
                                          err.message?.includes('fetch') ||
                                          err.message?.includes('Google Maps') ||
                                          err.name === 'NetworkError' ||
                                          !navigator.onLine;
                    
                    if (isNetworkIssue) {
                        setError(t('error.networkConnectionFailed'));
                        setIsNetworkError(true);
                    } else {
                        setError(t('error.streetViewLoadFailed'));
                        setIsNetworkError(false);
                    }
                }
            }
        };

        if (latitude && longitude) {
            initStreetView();
        }

        return () => {
            isMounted = false;
        };
    }, [latitude, longitude, onPovChanged, t]);

    return (
        <div style={styles.container}>
            <div ref={panoramaRef} style={{ width: '100%', height: '100%' }} />
            
            {error && (
                <div style={styles.errorContainer}>
                    <div style={styles.errorIcon}>
                        {isNetworkError ? '🌐' : '⚠️'}
                    </div>
                    <div style={styles.errorText}>{error}</div>
                    <div style={styles.errorSubText}>
                        {isNetworkError ? 
                            t('error.checkNetworkConnection') : 
                            (error === t('error.streetViewNotAvailable') ? 
                                t('error.tryOtherLocationOrLater') : 
                                ''
                            )
                        }
                    </div>
                </div>
            )}
        </div>
    );
}
