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
    const panoramaInstanceRef = useRef(null); // 存储街景实例的引用
    const autoRotateRef = useRef(null); // 存储自动旋转定时器的引用
    const userInteractionTimerRef = useRef(null); // 存储用户交互恢复定时器
    const isAutoRotatingRef = useRef(false); // 标记是否正在自动旋转
    const lastUserInteractionRef = useRef(0); // 记录最后一次用户交互时间
    const [error, setError] = useState(null);
    const [isNetworkError, setIsNetworkError] = useState(false);
    const { t } = useTranslation();

    // 自动旋转函数 - 使用 requestAnimationFrame 实现丝滑效果
    const startAutoRotate = (panorama) => {
        if (autoRotateRef.current) {
            stopAutoRotate(); // 先停止现有的旋转
        }
        
        let currentHeading = panorama.getPov().heading; // 从当前角度开始
        const rotateSpeed = 0.1; // 每帧旋转0.1度，更细腻的增量
        let lastTime = performance.now();
        let animationId;

        isAutoRotatingRef.current = true;
        
        const animate = (currentTime) => {
            if (!panorama || !panoramaInstanceRef.current || !isAutoRotatingRef.current) {
                stopAutoRotate();
                return;
            }

            // 计算时间差，确保旋转速度在不同设备上保持一致
            const deltaTime = currentTime - lastTime;

            // 根据实际帧率调整旋转速度
            const speedMultiplier = deltaTime / 16.67; // 16.67ms约等于60fps
            const actualRotateSpeed = rotateSpeed * speedMultiplier;
            
            currentHeading = (currentHeading + actualRotateSpeed) % 360;
            
            // 使用更平滑的设置方式
            try {
                panorama.setPov({
                    heading: currentHeading,
                    pitch: panorama.getPov().pitch
                });
                
                // 通知父组件视角变化
                if (onPovChanged) {
                    onPovChanged(currentHeading);
                }
            } catch (error) {
                // 如果街景实例出现问题，停止旋转
                console.warn('街景旋转时出现错误:', error);
                stopAutoRotate();
                return;
            }
            
            lastTime = currentTime;
            
            // 继续下一帧
            if (isAutoRotatingRef.current) {
                animationId = requestAnimationFrame(animate);
                autoRotateRef.current = animationId;
            }
        };
        
        // 开始动画
        animationId = requestAnimationFrame(animate);
        autoRotateRef.current = animationId;
    };

    // 停止自动旋转
    const stopAutoRotate = () => {
        if (autoRotateRef.current) {
            cancelAnimationFrame(autoRotateRef.current);
            autoRotateRef.current = null;
        }
        isAutoRotatingRef.current = false;
    };

    // 处理用户交互
    const handleUserInteraction = () => {
        if (isAutoRotatingRef.current) {
            stopAutoRotate();
            
            // 清除之前的恢复定时器
            if (userInteractionTimerRef.current) {
                clearTimeout(userInteractionTimerRef.current);
            }
            
            // 3秒后恢复自动旋转
            userInteractionTimerRef.current = setTimeout(() => {
                if (panoramaInstanceRef.current) {
                    startAutoRotate(panoramaInstanceRef.current);
                }
            }, 3000);
        }
    };

    useEffect(() => {
        let isMounted = true;
        let panorama = null;
        let cleanup = null;

        const initStreetView = async () => {
            try {
                setError(null);
                setIsNetworkError(false);
                
                // 停止之前的自动旋转
                stopAutoRotate();
                
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

                // 存储街景实例引用
                panoramaInstanceRef.current = panorama;

                // 存储所有的监听器以便清理
                const listeners = [];
                
                // 设置加载超时
                const timeoutId = setTimeout(() => {
                    if (isMounted) {
                        setError(t('error.networkConnectionFailed'));
                        setIsNetworkError(true);
                        stopAutoRotate();
                    }
                }, 10000); // 10秒超时

                // 监听街景状态变化
                const statusListener = panorama.addListener('status_changed', () => {
                    if (!isMounted) return;
                    
                    const status = panorama.getStatus();
                    if (status !== 'OK') {
                        // 街景数据不可用
                        setError(t('error.streetViewNotAvailable'));
                        setIsNetworkError(false);
                        stopAutoRotate(); // 如果街景加载失败，停止自动旋转
                    }
                });
                listeners.push(statusListener);

                // 监听街景成功加载 - 统一处理
                const panoListener = panorama.addListener('pano_changed', () => {
                    if (!isMounted) return;
                    
                    // 清除加载超时
                    clearTimeout(timeoutId);
                    
                    // 重置错误状态
                    setError(null);
                    setIsNetworkError(false);
                    
                    // 延迟启动自动旋转，让街景先完全加载
                    setTimeout(() => {
                        if (isMounted && panoramaInstanceRef.current) {
                            startAutoRotate(panorama);
                        }
                    }, 2000); // 街景加载完成后等待2秒再开始旋转
                });
                listeners.push(panoListener);

                // 监听视角变化，只用于通知父组件
                const povListener = panorama.addListener('pov_changed', () => {
                    if (onPovChanged && panorama) {
                        const currentPov = panorama.getPov();
                        onPovChanged(currentPov.heading);
                    }
                });
                listeners.push(povListener);

                // 监听DOM事件（鼠标和触摸）
                const streetViewElement = panoramaRef.current;
                streetViewElement.addEventListener('mousedown', handleUserInteraction);
                streetViewElement.addEventListener('wheel', handleUserInteraction);
                streetViewElement.addEventListener('touchstart', handleUserInteraction);

                // 清理函数
                cleanup = () => {
                    // 清理Google Maps监听器
                    listeners.forEach(listener => {
                        if (listener && listener.remove) {
                            listener.remove();
                        }
                    });
                    
                    // 清理DOM事件监听器
                    if (streetViewElement) {
                        streetViewElement.removeEventListener('mousedown', handleUserInteraction);
                        streetViewElement.removeEventListener('wheel', handleUserInteraction);
                        streetViewElement.removeEventListener('touchstart', handleUserInteraction);
                    }
                    
                    // 清理定时器
                    clearTimeout(timeoutId);
                    if (userInteractionTimerRef.current) {
                        clearTimeout(userInteractionTimerRef.current);
                        userInteractionTimerRef.current = null;
                    }
                };

            } catch (err) {
                if (isMounted) {
                    console.error('StreetView initialization error:', err);
                    stopAutoRotate();
                    
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
            stopAutoRotate();
            // 清理用户交互定时器
            if (userInteractionTimerRef.current) {
                clearTimeout(userInteractionTimerRef.current);
                userInteractionTimerRef.current = null;
            }
            panoramaInstanceRef.current = null;
            // 调用清理函数（如果存在）
            if (cleanup) {
                cleanup();
            }
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
