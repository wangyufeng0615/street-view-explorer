import React, { useState, useEffect, useRef } from 'react';
import StreetView from '../components/StreetView';
import PreviewMap from '../components/PreviewMap';
import GlobalMap from '../components/GlobalMap';
import ExplorationPreference from '../components/ExplorationPreference';
import { getRandomLocation, getLocationDescription } from '../services/api';

// 添加全局字体变量
const globalFontFamily = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';

const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 2,
    pointerEvents: 'none'
};

const sidebarWrapperStyle = {
    position: 'fixed',
    top: '20px',
    right: '20px',
    bottom: '20px',
    width: '340px',
    pointerEvents: 'none',
};

const sidebarStyle = {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: '12px',
    borderRadius: '15px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    transformOrigin: 'top right',
    pointerEvents: 'auto',
};

const sidebarContentStyle = {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
};

const buttonStyle = {
    padding: '10px 20px',
    fontSize: '16px',
    backgroundColor: '#FF7043',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    width: '100%',
    fontFamily: globalFontFamily,
    fontWeight: '500',
    transition: 'background-color 0.2s ease',
    boxShadow: '0 2px 8px rgba(255, 112, 67, 0.2)',
    ':hover': {
        backgroundColor: '#FF8A65'
    }
};

const disabledButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#E0E0E0',
    cursor: 'not-allowed',
    boxShadow: 'none'
};

const aiDescriptionStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: '16px',
    borderRadius: '12px',
    marginBottom: '12px',
    position: 'relative',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.05)',
    fontFamily: globalFontFamily,
    fontSize: '14px',
    lineHeight: '1.6',
    letterSpacing: '0.3px',
    color: '#2c3e50',
    fontWeight: '400'
};

const aiIconStyle = {
    position: 'absolute',
    top: '-12px',
    left: '16px',
    backgroundColor: '#1a73e8',
    color: 'white',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: globalFontFamily,
    boxShadow: '0 2px 8px rgba(26, 115, 232, 0.2)',
    letterSpacing: '0.3px',
    border: '1px solid rgba(255, 255, 255, 0.2)'
};

const addressStyle = {
    fontSize: '14px',
    color: '#555',
    marginBottom: '12px',
    lineHeight: '1.4',
    padding: '8px 12px',
    backgroundColor: 'rgba(240, 242, 245, 0.6)',
    borderRadius: '8px',
    border: '1px solid rgba(0, 0, 0, 0.05)',
    fontFamily: globalFontFamily
};

// 添加一个函数来格式化地址显示
const formatAddress = (location) => {
    if (!location) return '';
    
    if (location.formatted_address) {
        return location.formatted_address;
    }

    // 如果没有 formatted_address，尝试组合其他地址信息
    const parts = [];
    if (location.city) parts.push(location.city);
    if (location.country) parts.push(location.country);
    
    // 如果连城市和国家都没有，显示坐标
    if (parts.length === 0) {
        return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
    }

    return parts.join(', ');
};

const styles = {
    loadingContainer: {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '30px',
        borderRadius: '15px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        zIndex: 1000,
        fontFamily: globalFontFamily
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
        fontSize: '16px',
        color: '#333',
        fontWeight: '500',
        textAlign: 'center',
        animation: 'fadeInOut 2s ease-in-out infinite',
        fontFamily: globalFontFamily
    },
    subText: {
        fontSize: '14px',
        color: '#666',
        marginTop: '8px',
        textAlign: 'center',
        fontFamily: globalFontFamily
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
    @keyframes pulse {
        0%, 100% { transform: scale(0.8); opacity: 0.5; }
        50% { transform: scale(1.2); opacity: 1; }
    }
`;

const loadingMessages = [
    "正在挑选降落地点...",
    "正在清空地图迷雾...",
    "正在挑选自驾游地点...",
    "正在寻找有趣的街道...",
    "正在规划环球旅行路线...",
    "正在穿越时空隧道...",
    "正在打开任意门...",
    "正在搜寻世界奇观...",
    "正在寻找美食街区...",
    "正在探索城市角落...",
    "正在解锁新地图...",
    "正在启动随机传送...",
    "正在翻阅世界地图...",
    "正在寻找风景绝佳处...",
    "正在开启探索模式...",
    "正在计算最佳路线...",
    "正在搜寻文化地标...",
    "正在定位城市热点...",
    "正在寻找隐藏景点...",
    "正在解析地理坐标...",
    "正在打开时光相机...",
    "正在搜寻城市故事...",
    "正在定位街景视角...",
    "正在寻找城市灵魂...",
    "正在探索未知领域...",
    "正在开启冒险之旅...",
    "正在寻找生活气息...",
    "正在解读地域文化...",
    "正在搜寻城市记忆...",
    "正在启动漫游模式..."
];

// AI 思考文案数组
const aiThinkingMessages = [
    "正在观察周边建筑风格...",
    "正在分析地理环境特征...",
    "正在解读文化历史痕迹...",
    "正在感受当地生活氛围...",
    "正在探索独特地标建筑...",
    "正在解析城市规划特色...",
    "正在品味街区人文气息...",
    "正在捕捉季节性特征...",
    "正在分析建筑年代特征...",
    "正在解读城市肌理纹路..."
];

// AI 加载动画样式
const aiLoadingStyle = {
    container: {
        margin: '10px 0 0 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
        fontFamily: globalFontFamily
    },
    thinkingRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
    },
    dotsContainer: {
        display: 'flex',
        gap: '4px',
        alignItems: 'center'
    },
    dot: {
        width: '4px',
        height: '4px',
        backgroundColor: '#3498db',
        borderRadius: '50%',
        animation: 'pulse 1s ease-in-out infinite'
    },
    message: {
        fontSize: '14px',
        color: '#666',
        animation: 'fadeInOut 2s ease-in-out infinite',
        fontFamily: globalFontFamily
    }
};

export default function HomePage() {
    const [location, setLocation] = useState(null);
    const [description, setDescription] = useState(null);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingDesc, setIsLoadingDesc] = useState(false);
    const [heading, setHeading] = useState(0);
    const [isSavingPreference, setIsSavingPreference] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState(
        loadingMessages[Math.floor(Math.random() * loadingMessages.length)]
    );
    const loadingRef = useRef(false);
    const sidebarRef = useRef(null);
    const contentRef = useRef(null);
    const [scale, setScale] = useState(1);
    const [aiThinkingMessage, setAiThinkingMessage] = useState(
        aiThinkingMessages[Math.floor(Math.random() * aiThinkingMessages.length)]
    );

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

    // 更新加载文案
    useEffect(() => {
        if (isLoading) {
            const interval = setInterval(() => {
                setLoadingMessage(loadingMessages[Math.floor(Math.random() * loadingMessages.length)]);
            }, 2000);
            return () => clearInterval(interval);
        }
    }, [isLoading]);

    // 更新 AI 思考文案
    useEffect(() => {
        if (isLoadingDesc) {
            const interval = setInterval(() => {
                setAiThinkingMessage(aiThinkingMessages[Math.floor(Math.random() * aiThinkingMessages.length)]);
            }, 3000);
            return () => clearInterval(interval);
        }
    }, [isLoadingDesc]);

    // 加载位置描述
    const loadLocationDescription = async (panoId) => {
        if (!panoId) return;
        
        // 如果已经在加载中，就不要重复加载
        if (isLoadingDesc) {
            console.log('Description is already loading, skipping...');
            return;
        }
        
        try {
            setIsLoadingDesc(true);
            // Get user's preferred language from browser or localStorage
            const userLang = localStorage.getItem('preferredLanguage') || navigator.language.split('-')[0] || 'zh';
            const resp = await getLocationDescription(panoId, userLang);
            if (resp.success) {
                setDescription(resp.data);
            }
        } catch (err) {
            console.error('Error getting location description:', err);
        } finally {
            setIsLoadingDesc(false);
        }
    };

    // 加载随机位置
    const loadRandomLocation = async () => {
        if (loadingRef.current) return;
        
        try {
            loadingRef.current = true;
            setIsLoading(true);
            setDescription(null);  // 清除旧的描述
            setLocation(null);     // 清除旧的位置
            
            const resp = await getRandomLocation();

            if (resp.success && resp.data) {
                // 确保数据格式正确
                const lat = Number(resp.data.latitude);
                const lng = Number(resp.data.longitude);

                if (isNaN(lat) || isNaN(lng)) {
                    throw new Error('服务器返回了无效的坐标数据');
                }

                const locationData = {
                    latitude: lat,
                    longitude: lng,
                    pano_id: resp.data.pano_id,
                    formatted_address: resp.data.formatted_address,
                    country: resp.data.country,
                    city: resp.data.city
                };
                
                setLocation(locationData);
                setError(null);
                
                // 获取到位置后，异步加载描述
                if (locationData.pano_id) {
                    loadLocationDescription(locationData.pano_id);
                }
            } else {
                setError(resp.error || '加载失败');
            }
        } catch (err) {
            setError(err.message || '网络请求失败');
        } finally {
            setIsLoading(false);
            loadingRef.current = false;
        }
    };

    // 页面加载时自动获取随机位置
    useEffect(() => {
        loadRandomLocation();
    }, []);

    // 监听空格键
    useEffect(() => {
        const handleKeyPress = (event) => {
            // 如果当前焦点在输入框或文本框上，不触发空格键探索
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }
            
            if (event.code === 'Space' && !isLoading && !loadingRef.current) {
                event.preventDefault();
                loadRandomLocation();
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [isLoading]);

    // Add handleResize function
    const handleResize = () => {
        if (sidebarRef.current && contentRef.current) {
            const wrapperHeight = window.innerHeight - 40; // 上下各20px的可用空间
            const contentHeight = contentRef.current.offsetHeight;
            const paddingHeight = 40; // 上下padding各20px
            
            if (contentHeight + paddingHeight > wrapperHeight) {
                setScale((wrapperHeight) / (contentHeight + paddingHeight));
            } else {
                setScale(1);
            }
        }
    };

    // Add resize observer effect
    useEffect(() => {
        window.addEventListener('resize', handleResize);

        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });

        if (contentRef.current) {
            resizeObserver.observe(contentRef.current);
        }

        handleResize();

        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
        };
    }, []);

    // Add effect to handle description updates
    useEffect(() => {
        if (description) {
            handleResize();
        }
    }, [description]);

    if (error) {
        return (
            <div style={{ 
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                backgroundColor: 'white',
                padding: '20px',
                borderRadius: '10px',
                boxShadow: '0 0 20px rgba(0, 0, 0, 0.1)',
                zIndex: 3
            }}>
                <h2>出错了</h2>
                <p>{error}</p>
                <button onClick={loadRandomLocation} style={buttonStyle}>
                    重试
                </button>
            </div>
        );
    }

    // 始终渲染主框架
    return (
        <>
            {/* 街景容器 */}
            <div style={{ width: '100vw', height: '100vh', backgroundColor: '#f0f2f5' }}>
                <StreetView 
                    latitude={location?.latitude} 
                    longitude={location?.longitude} 
                    onPovChanged={setHeading}
                />
            </div>
            
            {/* 侧边栏 */}
            <div style={overlayStyle}>
                <div style={sidebarWrapperStyle}>
                    <div
                        ref={sidebarRef}
                        style={{
                            ...sidebarStyle,
                            transform: `scale(${scale})`,
                            transition: 'transform 0.3s ease-out',
                        }}
                    >
                        <div ref={contentRef} style={sidebarContentStyle}>
                            {location && (
                                <>
                                    <div style={{ marginBottom: '8px' }}>
                                        <GlobalMap latitude={location.latitude} longitude={location.longitude} />
                                        <PreviewMap 
                                            latitude={location.latitude} 
                                            longitude={location.longitude} 
                                            heading={heading}
                                        />
                                    </div>

                                    <div style={addressStyle}>
                                        {formatAddress(location)}
                                    </div>

                                    <div style={aiDescriptionStyle}>
                                        <div style={aiIconStyle}>Dr. Atlas (AI)</div>
                                        {isLoadingDesc ? (
                                            <div style={aiLoadingStyle.container}>
                                                <div style={aiLoadingStyle.thinkingRow}>
                                                    <div style={aiLoadingStyle.dotsContainer}>
                                                        <div style={{ ...aiLoadingStyle.dot, animationDelay: '0s' }} />
                                                        <div style={{ ...aiLoadingStyle.dot, animationDelay: '0.2s' }} />
                                                        <div style={{ ...aiLoadingStyle.dot, animationDelay: '0.4s' }} />
                                                    </div>
                                                    <div style={aiLoadingStyle.message}>{aiThinkingMessage}</div>
                                                </div>
                                            </div>
                                        ) : description ? (
                                            <p style={{ margin: '10px 0 0 0' }}>{description}</p>
                                        ) : location?.pano_id ? (
                                            <div style={aiLoadingStyle.container}>
                                                <div style={aiLoadingStyle.thinkingRow}>
                                                    <div style={aiLoadingStyle.dotsContainer}>
                                                        <div style={{ ...aiLoadingStyle.dot, animationDelay: '0s' }} />
                                                        <div style={{ ...aiLoadingStyle.dot, animationDelay: '0.2s' }} />
                                                        <div style={{ ...aiLoadingStyle.dot, animationDelay: '0.4s' }} />
                                                    </div>
                                                    <div style={aiLoadingStyle.message}>正在等待 AI 分析...</div>
                                                </div>
                                            </div>
                                        ) : (
                                            <p style={{ margin: '10px 0 0 0', color: '#666' }}>
                                                无法获取此位置的街景信息，请尝试继续探索其他位置。
                                            </p>
                                        )}
                                    </div>

                                    <ExplorationPreference 
                                        onSaveStart={() => setIsSavingPreference(true)}
                                        onSaveEnd={() => setIsSavingPreference(false)}
                                    />

                                    <button 
                                        onClick={loadRandomLocation} 
                                        disabled={isLoading || isSavingPreference}
                                        style={isLoading || isSavingPreference ? disabledButtonStyle : buttonStyle}
                                    >
                                        {isLoading ? '加载中...' : isSavingPreference ? '保存中...' : '继续探索(空格)'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 全局加载动画 */}
            {isLoading && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    backdropFilter: 'blur(5px)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999
                }}>
                    <div style={styles.loadingSpinner} />
                    <div style={styles.loadingText}>{loadingMessage}</div>
                </div>
            )}
        </>
    );
}
