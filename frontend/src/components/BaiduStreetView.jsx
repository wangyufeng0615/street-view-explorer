import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadBaiduMapsWhenVisible } from '../utils/baiduMaps';

const styles = {
    container: {
        width: '100%',
        height: '100%',
        position: 'relative'
    },
    interactionTip: {
        position: 'absolute',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        color: 'rgba(255, 255, 255, 0.95)',
        padding: '10px 18px',
        borderRadius: '24px',
        fontSize: '13px',
        fontWeight: '400',
        zIndex: 100,
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25), 0 2px 4px rgba(0, 0, 0, 0.1)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        userSelect: 'none',
        opacity: 0.9,
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        lineHeight: '1.4',
        textShadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        animation: 'tipFadeIn 0.6s ease-out',
        letterSpacing: '0.02em'
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

export default function BaiduStreetView({ latitude, longitude, onPovChanged }) {
    const panoramaRef = useRef(null);
    const panoramaInstanceRef = useRef(null);
    const autoRotateRef = useRef(null);
    const userInteractionTimerRef = useRef(null);
    const isAutoRotatingRef = useRef(false);
    const cleanupFunctionsRef = useRef([]);
    const mountedRef = useRef(true);
    const [error, setError] = useState(null);
    const [isNetworkError, setIsNetworkError] = useState(false);
    const [showInteractionTip, setShowInteractionTip] = useState(false);
    const { t } = useTranslation();

    // Auto-rotation using requestAnimationFrame (same logic as Google version)
    const startAutoRotate = (panorama) => {
        if (autoRotateRef.current) {
            stopAutoRotate();
        }

        let currentHeading = panorama.getPov().heading || 0;
        const rotateSpeed = 0.03;
        let lastTime = performance.now();
        let animationId;
        isAutoRotatingRef.current = true;

        const animate = (currentTime) => {
            if (!mountedRef.current || !panoramaInstanceRef.current || !isAutoRotatingRef.current) {
                stopAutoRotate();
                return;
            }

            const deltaTime = currentTime - lastTime;
            const speedMultiplier = deltaTime / 16.67;
            const actualRotateSpeed = rotateSpeed * speedMultiplier;
            currentHeading = (currentHeading + actualRotateSpeed) % 360;

            try {
                panorama.setPov({ heading: currentHeading, pitch: panorama.getPov().pitch || 0 });
                if (onPovChanged) {
                    onPovChanged(currentHeading);
                }
            } catch (err) {
                stopAutoRotate();
                return;
            }

            lastTime = currentTime;
            if (mountedRef.current && isAutoRotatingRef.current) {
                animationId = requestAnimationFrame(animate);
                autoRotateRef.current = animationId;
            }
        };

        animationId = requestAnimationFrame(animate);
        autoRotateRef.current = animationId;
    };

    const stopAutoRotate = () => {
        if (autoRotateRef.current) {
            cancelAnimationFrame(autoRotateRef.current);
            autoRotateRef.current = null;
        }
        isAutoRotatingRef.current = false;
    };

    const handleUserInteraction = () => {
        if (showInteractionTip) {
            setShowInteractionTip(false);
        }
        if (isAutoRotatingRef.current) {
            stopAutoRotate();
            if (userInteractionTimerRef.current) {
                clearTimeout(userInteractionTimerRef.current);
            }
            userInteractionTimerRef.current = setTimeout(() => {
                if (panoramaInstanceRef.current) {
                    startAutoRotate(panoramaInstanceRef.current);
                }
            }, 3000);
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            stopAutoRotate();
            if (userInteractionTimerRef.current) {
                clearTimeout(userInteractionTimerRef.current);
                userInteractionTimerRef.current = null;
            }
            cleanupFunctionsRef.current.forEach(fn => fn());
            cleanupFunctionsRef.current = [];
        };
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        let isMounted = true;
        let cleanup = null;
        let timeoutId = null;
        let loadTimeoutId = null;
        let tipTimeoutId = null;
        let autoRotateTimeoutId = null;

        const initStreetView = async () => {
            try {
                setError(null);
                setIsNetworkError(false);
                stopAutoRotate();

                const lat = Number(latitude);
                const lng = Number(longitude);
                if (isNaN(lat) || isNaN(lng)) {
                    throw new Error(t('error.invalidCoordinateValues'));
                }

                const BMapGL = await loadBaiduMapsWhenVisible(panoramaRef.current);
                if (!isMounted || !panoramaRef.current) return;

                // Set load timeout
                loadTimeoutId = setTimeout(() => {
                    if (isMounted && mountedRef.current) {
                        setError(t('error.networkConnectionFailed'));
                        setIsNetworkError(true);
                        stopAutoRotate();
                    }
                }, 15000);

                // Use PanoramaService to find nearest panorama
                const point = new BMapGL.Point(lng, lat);
                const panoService = new BMapGL.PanoramaService();

                panoService.getPanoramaByLocation(point, function(data) {
                    if (!isMounted || !mountedRef.current) return;

                    if (loadTimeoutId) {
                        clearTimeout(loadTimeoutId);
                        loadTimeoutId = null;
                    }

                    if (!data || !data.id) {
                        setError(t('error.streetViewNotAvailable'));
                        setIsNetworkError(false);
                        return;
                    }

                    // Create panorama viewer
                    const panorama = new BMapGL.Panorama(panoramaRef.current, {
                        albumsControl: false,
                        linksControl: true,
                    });

                    panorama.setId(data.id);
                    panorama.setPov({ heading: 0, pitch: 0 });

                    panoramaInstanceRef.current = panorama;

                    // Start auto-rotation after delay
                    autoRotateTimeoutId = setTimeout(() => {
                        if (isMounted && mountedRef.current && panoramaInstanceRef.current) {
                            startAutoRotate(panorama);
                        }
                    }, 2000);

                    // Show interaction tip
                    tipTimeoutId = setTimeout(() => {
                        if (isMounted && mountedRef.current) {
                            setShowInteractionTip(true);
                            const hideTipTimeoutId = setTimeout(() => {
                                if (isMounted && mountedRef.current) {
                                    setShowInteractionTip(false);
                                }
                            }, 8000);
                            cleanupFunctionsRef.current.push(() => clearTimeout(hideTipTimeoutId));
                        }
                    }, 3000);

                    // Listen for POV changes
                    panorama.addEventListener('pov_changed', function() {
                        if (onPovChanged && panoramaInstanceRef.current) {
                            const pov = panoramaInstanceRef.current.getPov();
                            onPovChanged(pov.heading);
                        }
                    });

                    // DOM interaction events
                    const el = panoramaRef.current;
                    if (el) {
                        el.addEventListener('mousedown', handleUserInteraction);
                        el.addEventListener('wheel', handleUserInteraction);
                        el.addEventListener('touchstart', handleUserInteraction);
                    }

                    cleanup = () => {
                        if (el) {
                            el.removeEventListener('mousedown', handleUserInteraction);
                            el.removeEventListener('wheel', handleUserInteraction);
                            el.removeEventListener('touchstart', handleUserInteraction);
                        }
                        if (loadTimeoutId) clearTimeout(loadTimeoutId);
                        if (tipTimeoutId) clearTimeout(tipTimeoutId);
                        if (autoRotateTimeoutId) clearTimeout(autoRotateTimeoutId);
                        if (userInteractionTimerRef.current) {
                            clearTimeout(userInteractionTimerRef.current);
                            userInteractionTimerRef.current = null;
                        }
                        stopAutoRotate();
                        panoramaInstanceRef.current = null;
                    };
                });
            } catch (err) {
                if (isMounted) {
                    console.error('BaiduStreetView initialization error:', err);
                    stopAutoRotate();
                    const isNetworkIssue = err.message?.includes('network') ||
                                          err.message?.includes('timeout') ||
                                          err.message?.includes('Baidu Maps') ||
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
            timeoutId = setTimeout(() => {
                if (isMounted && mountedRef.current) {
                    initStreetView();
                }
            }, 200);
        }

        return () => {
            isMounted = false;
            mountedRef.current = false;
            stopAutoRotate();
            if (timeoutId) clearTimeout(timeoutId);
            if (loadTimeoutId) clearTimeout(loadTimeoutId);
            if (tipTimeoutId) clearTimeout(tipTimeoutId);
            if (autoRotateTimeoutId) clearTimeout(autoRotateTimeoutId);
            if (userInteractionTimerRef.current) {
                clearTimeout(userInteractionTimerRef.current);
                userInteractionTimerRef.current = null;
            }
            setShowInteractionTip(false);
            panoramaInstanceRef.current = null;
            if (cleanup) cleanup();
            cleanupFunctionsRef.current.forEach(fn => fn());
            cleanupFunctionsRef.current = [];
        };
    }, [latitude, longitude, t]);

    return (
        <div style={styles.container}>
            <div ref={panoramaRef} style={{ width: '100%', height: '100%' }} />
            {showInteractionTip && !error && (
                <div style={styles.interactionTip}>
                    {t('streetview.interactionTip')}
                </div>
            )}
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
                                t('error.tryOtherLocationOrLater') : ''
                            )
                        }
                    </div>
                </div>
            )}
        </div>
    );
}
