import React, { useState, useEffect, useRef, useCallback } from 'react';
import StreetView from '../components/StreetView';
import Sidebar from '../components/Sidebar';
import GlobalLoading from '../components/GlobalLoading';
import { getRandomLocation, getLocationDescription, setExplorationPreference, deleteExplorationPreference } from '../services/api';
import { overlayStyle, sidebarWrapperStyle } from '../styles/HomePage.styles';
import '../styles/animations.css';
import '../styles/HomePage.css';

const MAX_RETRIES = 3;
const TIMEOUT_MS = 10000; // 10 seconds timeout
const RATE_LIMIT_MS = 1000; // 1秒限制

// 探索模式的存储键
const EXPLORATION_MODE_KEY = 'exploration_mode';
const EXPLORATION_INTEREST_KEY = 'exploration_interest';

// 探索模式枚举
const EXPLORATION_MODES = {
    RANDOM: 'random',
    CUSTOM: 'custom'
};

export default function HomePage() {
    const [location, setLocation] = useState(null);
    const [description, setDescription] = useState(null);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingDesc, setIsLoadingDesc] = useState(false);
    const [heading, setHeading] = useState(0);
    const [isSavingPreference, setIsSavingPreference] = useState(false);
    const [descError, setDescError] = useState(null);
    const [descRetries, setDescRetries] = useState(0);
    const [scale, setScale] = useState(1);
    const [preferenceError, setPreferenceError] = useState(null);
    
    // 新增：探索模式状态
    const [explorationMode, setExplorationMode] = useState(EXPLORATION_MODES.RANDOM);
    const [explorationInterest, setExplorationInterest] = useState('');

    // Refs
    const loadingRef = useRef(false);
    const sidebarRef = useRef(null);
    const contentRef = useRef(null);
    const abortControllerRef = useRef(null);
    const retryTimeoutRef = useRef(null);
    const locationRef = useRef(null);
    const loadingDescTimeoutRef = useRef(null);
    const networkStateRef = useRef(navigator.onLine);
    const timeoutRef = useRef(null);
    const lastRefreshTimeRef = useRef(Date.now() - RATE_LIMIT_MS);  // 初始化为当前时间减去限流时间，这样首次加载不会触发限流

    // 添加超时控制的 Promise
    const timeoutPromise = useCallback((ms) => {
        return new Promise((_, reject) => {
            timeoutRef.current = setTimeout(() => {
                timeoutRef.current = null;
                reject(new Error('请求超时'));
            }, ms);
        });
    }, []);

    // 增强清理函数
    const cleanup = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        if (loadingDescTimeoutRef.current) {
            clearTimeout(loadingDescTimeoutRef.current);
            loadingDescTimeoutRef.current = null;
        }
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    }, []);

    // 监听网络状态
    useEffect(() => {
        const handleOnline = () => {
            networkStateRef.current = true;
            // 如果有失败的请求，尝试重新加载
            if (descError && location?.pano_id) {
                loadLocationDescription(location.pano_id);
            }
        };

        const handleOffline = () => {
            networkStateRef.current = false;
            // 如果正在加载，设置错误状态
            if (isLoadingDesc) {
                setDescError('网络连接已断开');
                setIsLoadingDesc(false);
            }
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [descError, location]);

    // 监听 location 变化
    useEffect(() => {
        if (location?.pano_id) {
            locationRef.current = location;
            
            // 清理之前的超时
            if (loadingDescTimeoutRef.current) {
                clearTimeout(loadingDescTimeoutRef.current);
            }
            
            // 使用 RAF 代替 setTimeout
            loadingDescTimeoutRef.current = requestAnimationFrame(() => {
                loadingDescTimeoutRef.current = null;
                if (locationRef.current?.pano_id === location.pano_id) {
                    loadLocationDescription(location.pano_id);
                }
            });
        } else {
            // 清除描述相关状态
            setDescription(null);
            setDescError(null);
            setDescRetries(0);
        }
        
        return () => {
            if (loadingDescTimeoutRef.current) {
                cancelAnimationFrame(loadingDescTimeoutRef.current);
                loadingDescTimeoutRef.current = null;
            }
        };
    }, [location]);

    // 加载随机位置
    const loadRandomLocation = useCallback(async (skipRateLimit = false) => {
        // 检查限流（除非明确跳过）
        if (!skipRateLimit) {
            const now = Date.now();
            const timeSinceLastRefresh = now - lastRefreshTimeRef.current;
            if (timeSinceLastRefresh < RATE_LIMIT_MS) {
                const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastRefresh) / 1000);
                setError(`请等待 ${waitTime} 秒后再试`);
                return;
            }
        }

        if (loadingRef.current) return;
        
        // 更新最后刷新时间
        lastRefreshTimeRef.current = Date.now();
        
        // 设置加载状态
        loadingRef.current = true;
        setIsLoading(true);
        
        try {
            // 清理之前的描述相关状态
            cleanup();
            setDescription(null);
            setDescError(null);
            setDescRetries(0);
            setIsLoadingDesc(false);  // 重置描述加载状态
            setLocation(null);     // 清除旧的位置
            
            const resp = await getRandomLocation();
            
            // 检查是否仍在加载状态（防止用户已经取消）
            if (!loadingRef.current) return;

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
            } else {
                throw new Error(resp.error || '加载失败');
            }
        } catch (err) {
            if (loadingRef.current) {  // 只在仍在加载时设置错误
                setError(err.message || '网络请求失败');
                setLocation(null);
            }
        } finally {
            // 确保状态一致性
            if (loadingRef.current) {
                setIsLoading(false);
                loadingRef.current = false;
            }
        }
    }, [cleanup]);

    // 加载位置描述
    const loadLocationDescription = useCallback(async (panoId) => {
        if (!panoId) {
            return;
        }
        
        // 检查网络状态
        if (!networkStateRef.current) {
            setDescError('网络连接已断开');
            return;
        }
        
        // 检查是否是当前位置的请求
        if (locationRef.current?.pano_id !== panoId) {
            return;
        }
        
        // 如果已经在加载中，就不要重复加载
        if (isLoadingDesc) {
            return;
        }

        // 清理之前的请求和超时
        cleanup();
        
        try {
            setIsLoadingDesc(true);
            setDescError(null);
            setDescription(null);  // 清除旧的描述
            
            // 创建新的 AbortController
            abortControllerRef.current = new AbortController();
            
            // Get user's preferred language from browser or localStorage
            const userLang = localStorage.getItem('preferredLanguage') || navigator.language.split('-')[0] || 'zh';
            
            // 再次检查位置和网络状态
            if (locationRef.current?.pano_id !== panoId || !networkStateRef.current) {
                return;
            }
            
            // 使用 Promise.race 实现超时控制
            const resp = await Promise.race([
                getLocationDescription(panoId, userLang, abortControllerRef.current.signal),
                timeoutPromise(TIMEOUT_MS)
            ]);

            // 如果请求已经被取消或位置已改变，直接返回
            if (!abortControllerRef.current || locationRef.current?.pano_id !== panoId) {
                return;
            }

            if (resp.success) {
                setDescription(resp.data);
                setDescRetries(0); // 重置重试次数
            } else {
                throw new Error(resp.error || '获取描述失败');
            }
        } catch (err) {
            // 如果是取消的请求或组件已卸载，不处理错误
            if (err.name === 'AbortError' || !abortControllerRef.current) {
                return;
            }
            
            // 再次检查位置是否改变
            if (locationRef.current?.pano_id !== panoId) {
                return;
            }
            
            const errorMessage = err.message === '请求超时' ? '获取描述超时，正在重试...' : (err.message || '获取描述失败');
            setDescError(errorMessage);
            setDescription(null);  // 清除可能存在的旧描述
            
            // 只在网络正常时重试
            if (networkStateRef.current && descRetries < MAX_RETRIES) {
                setDescRetries(prev => prev + 1);
                retryTimeoutRef.current = setTimeout(() => {
                    // 最后一次检查位置是否改变和网络状态
                    if (locationRef.current?.pano_id === panoId && networkStateRef.current) {
                        loadLocationDescription(panoId);
                    }
                }, Math.min(2000 * (descRetries + 1), 5000)); // 递增重试间隔，最大5秒
            }
        } finally {
            // 只在请求未取消且位置未改变时更新状态
            if (abortControllerRef.current && locationRef.current?.pano_id === panoId) {
                setIsLoadingDesc(false);
            }
        }
    }, [isLoadingDesc, descRetries, cleanup, timeoutPromise]);

    // 初始化探索模式
    useEffect(() => {
        const savedMode = localStorage.getItem(EXPLORATION_MODE_KEY);
        const savedInterest = localStorage.getItem(EXPLORATION_INTEREST_KEY) || '';
        
        // 只有当同时存在保存的模式和兴趣时，才使用保存的模式
        if (savedMode === EXPLORATION_MODES.CUSTOM && savedInterest) {
            setExplorationMode(EXPLORATION_MODES.CUSTOM);
            setExplorationInterest(savedInterest);
            // 确保后端也有这个偏好，首次加载时跳过限流检查
            setExplorationPreference(savedInterest, true).catch(console.error);
        } else {
            // 否则默认使用随机模式
            setExplorationMode(EXPLORATION_MODES.RANDOM);
            setExplorationInterest('');
            // 清除可能存在的本地存储
            localStorage.removeItem(EXPLORATION_MODE_KEY);
            localStorage.removeItem(EXPLORATION_INTEREST_KEY);
        }
    }, []);

    // 切换探索模式
    const handleModeChange = useCallback(async (mode) => {
        if (mode === explorationMode) return;

        setExplorationMode(mode);
        localStorage.setItem(EXPLORATION_MODE_KEY, mode);

        if (mode === EXPLORATION_MODES.RANDOM) {
            // 清除本地存储的探索兴趣
            localStorage.removeItem(EXPLORATION_INTEREST_KEY);
            setExplorationInterest('');
            // 清除后端的探索偏好
            try {
                await deleteExplorationPreference();
            } catch (err) {
                console.error('Failed to delete exploration preference:', err);
            }
            // 让用户自己点击 GO 按钮来获取新位置
        } else if (mode === EXPLORATION_MODES.CUSTOM) {
            // 如果有保存的兴趣，恢复它
            const savedInterest = localStorage.getItem(EXPLORATION_INTEREST_KEY);
            if (savedInterest) {
                setExplorationInterest(savedInterest);
                await setExplorationPreference(savedInterest);
            }
        }
    }, [explorationMode]);

    // 页面加载时根据当前模式加载位置
    useEffect(() => {
        if (explorationMode === EXPLORATION_MODES.CUSTOM && !explorationInterest) {
            // 如果是特定兴趣模式但没有兴趣，切换到随机模式
            handleModeChange(EXPLORATION_MODES.RANDOM);
        } else {
            // 首次加载时跳过限流检查
            loadRandomLocation(true);
        }
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
    }, [isLoading, loadRandomLocation]);

    // Add handleResize function
    const handleResize = useCallback(() => {
        if (sidebarRef.current && contentRef.current) {
            // 给一个小延时确保DOM已经完全更新
            setTimeout(() => {
                const wrapperHeight = window.innerHeight - 40; // 上下各20px的可用空间
                const contentHeight = contentRef.current.offsetHeight;
                const padding = 24; // 上下padding各12px
                
                if (contentHeight + padding > wrapperHeight) {
                    const scale = Math.min(0.85, (wrapperHeight - padding) / contentHeight);
                    setScale(Math.max(0.6, scale)); // 设置最小缩放比例为0.6
                } else {
                    setScale(1);
                }
            }, 0);
        }
    }, []);

    // 处理保存探索兴趣
    const handlePreferenceChange = useCallback(async (preference, skipRateLimit = false) => {
        // 检查限流（除非明确跳过）
        if (!skipRateLimit) {
            const now = Date.now();
            const timeSinceLastRefresh = now - lastRefreshTimeRef.current;
            if (timeSinceLastRefresh < RATE_LIMIT_MS) {
                return { 
                    success: false, 
                    error: `请等待 ${Math.ceil((RATE_LIMIT_MS - timeSinceLastRefresh) / 1000)} 秒后再试` 
                };
            }
        }

        if (loadingRef.current) {
            return { success: false, error: '正在加载中，请稍后再试' };
        }
        
        try {
            setPreferenceError(null);
            setIsSavingPreference(true);
            loadingRef.current = true;
            setIsLoadingDesc(false);
            
            const resp = await setExplorationPreference(preference);
            
            if (resp.success) {
                // 更新最后刷新时间
                lastRefreshTimeRef.current = Date.now();
                
                localStorage.setItem(EXPLORATION_MODE_KEY, EXPLORATION_MODES.CUSTOM);
                localStorage.setItem(EXPLORATION_INTEREST_KEY, preference);
                setExplorationMode(EXPLORATION_MODES.CUSTOM);
                setExplorationInterest(preference);
                // 首次加载时跳过限流检查
                await loadRandomLocation(skipRateLimit);
                return { success: true };
            } else {
                throw new Error(resp.error || '保存兴趣失败');
            }
        } catch (err) {
            setPreferenceError(err.message);
            return { success: false, error: err.message };
        } finally {
            loadingRef.current = false;
            setIsLoading(false);
            setIsSavingPreference(false);
        }
    }, [loadRandomLocation]);

    // Add effect to handle description updates
    useEffect(() => {
        if (description || isLoadingDesc || descError) {
            handleResize();
        }
    }, [description, isLoadingDesc, descError, handleResize]);

    // Add resize observer effect
    useEffect(() => {
        const handleWindowResize = () => {
            requestAnimationFrame(handleResize);
        };

        window.addEventListener('resize', handleWindowResize);

        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(handleResize);
        });

        if (contentRef.current) {
            resizeObserver.observe(contentRef.current);
        }

        // 初始化时执行一次
        handleResize();

        return () => {
            window.removeEventListener('resize', handleWindowResize);
            resizeObserver.disconnect();
        };
    }, [handleResize]);

    // 删除探索兴趣
    const handleDeletePreference = useCallback(async () => {
        try {
            await deleteExplorationPreference();
        } catch (err) {
            console.error('Error deleting preference:', err);
        }
    }, []);

    if (error) {
        return (
            <div className="error-container">
                <h2>出错了</h2>
                <p>{error}</p>
                <button onClick={loadRandomLocation} className="retry-button">
                    重试
                </button>
            </div>
        );
    }

    return (
        <>
            {/* 街景容器 */}
            <div className="street-view-container">
                <StreetView 
                    latitude={location?.latitude} 
                    longitude={location?.longitude} 
                    onPovChanged={setHeading}
                />
            </div>
            
            {/* 侧边栏 */}
            <div style={overlayStyle}>
                <div style={sidebarWrapperStyle}>
                    <Sidebar
                        ref={sidebarRef}
                        contentRef={contentRef}
                        location={location}
                        heading={heading}
                        description={description}
                        isLoadingDesc={isLoadingDesc}
                        descError={descError}
                        descRetries={descRetries}
                        isLoading={isLoading}
                        isSavingPreference={isSavingPreference}
                        preferenceError={preferenceError}
                        onRetryDescription={() => {
                            setDescRetries(0);
                            loadLocationDescription(location?.pano_id);
                        }}
                        onExplore={loadRandomLocation}
                        onPreferenceChange={handlePreferenceChange}
                        scale={scale}
                        explorationMode={explorationMode}
                        explorationInterest={explorationInterest}
                        onModeChange={handleModeChange}
                    />
                </div>
            </div>

            {/* 全局加载动画 */}
            {isLoading && <GlobalLoading />}
        </>
    );
}
