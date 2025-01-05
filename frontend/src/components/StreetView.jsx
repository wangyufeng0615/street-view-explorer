import React, { useEffect, useRef } from 'react';
import { loadGoogleMapsScript } from '../utils/googleMaps';

// 加载提示文案数组
const loadingMessages = [
    "正在消除迷雾...",
    "正在探索地球...",
    "正在传送到目的地...",
    "正在寻找有趣的地方...",
    "正在启动时空穿梭机...",
    "正在打开任意门...",
    "正在解锁新世界...",
    "正在规划冒险路线...",
    "正在为您开启新视角...",
    "正在准备惊喜..."
];

// 随机获取一条提示文案
const getRandomLoadingMessage = () => {
    const randomIndex = Math.floor(Math.random() * loadingMessages.length);
    return loadingMessages[randomIndex];
};

const styles = {
    container: {
        width: '100%',
        height: '100%',
        position: 'relative'
    },
    loadingContainer: {
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
        backdropFilter: 'blur(5px)',
        zIndex: 1000
    },
    loadingSpinner: {
        width: '40px',
        height: '40px',
        border: '3px solid #f3f3f3',
        borderTop: '3px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        marginBottom: '15px'
    },
    loadingText: {
        fontSize: '18px',
        color: '#333',
        fontWeight: '500',
        textAlign: 'center',
        animation: 'fadeInOut 2s ease-in-out infinite'
    },
    subText: {
        fontSize: '14px',
        color: '#666',
        marginTop: '8px',
        maxWidth: '80%',
        textAlign: 'center'
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
        textAlign: 'center'
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

// 添加关键帧动画
const keyframes = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    @keyframes fadeInOut {
        0% { opacity: 0.6; }
        50% { opacity: 1; }
        100% { opacity: 0.6; }
    }
`;

export default function StreetView({ latitude, longitude, onPovChanged }) {
    const panoramaRef = useRef(null);
    const [error, setError] = React.useState(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [loadingMessage] = React.useState(getRandomLoadingMessage);

    // 添加动画样式到文档
    useEffect(() => {
        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = keyframes;
        document.head.appendChild(styleSheet);

        return () => {
            document.head.removeChild(styleSheet);
        };
    }, []);

    useEffect(() => {
        let isMounted = true;

        const initStreetView = async () => {
            try {
                setIsLoading(true);
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
                        setError('该位置暂无街景数据');
                    }
                    setIsLoading(false);
                });
            } catch (err) {
                if (isMounted) {
                    setError('街景加载失败');
                    console.error('街景加载错误:', err);
                    setIsLoading(false);
                }
            }
        };

        initStreetView();

        return () => {
            isMounted = false;
        };
    }, [latitude, longitude, onPovChanged]);

    return (
        <div style={styles.container}>
            <div ref={panoramaRef} style={{ width: '100%', height: '100%' }} />
            
            {isLoading && (
                <div style={styles.loadingContainer}>
                    <div style={styles.loadingSpinner} />
                    <div style={styles.loadingText}>{loadingMessage}</div>
                </div>
            )}

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
