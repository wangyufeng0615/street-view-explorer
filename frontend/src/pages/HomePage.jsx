import React, { useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import GlobalLoading from '../components/GlobalLoading';
import ErrorDisplay from '../components/ErrorDisplay';
import HelpButton from '../components/HelpButton';
import StreetViewContainer from '../components/StreetViewContainer';
import { overlayStyle, sidebarWrapperStyle } from '../styles/HomePage.styles';
import '../styles/animations.css';
import '../styles/HomePage.css';

// 自定义钩子
import useLocationData from '../hooks/useLocationData';
import useLocationDescription from '../hooks/useLocationDescription';
import useExplorationMode, { EXPLORATION_MODES } from '../hooks/useExplorationMode';
import useUIHandlers from '../hooks/useUIHandlers';
import useKeyboardNavigation from '../hooks/useKeyboardNavigation';

// 防抖函数
const debounce = (fn, delay) => {
    let timeoutId;
    return (...args) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn(...args);
            timeoutId = null;
        }, delay);
    };
};

export default function HomePage() {
    // 使用自定义钩子
    const {
        location,
        error,
        isLoading,
        loadRandomLocation,
        loadingRef,
        lastRefreshTimeRef
    } = useLocationData();
    
    const {
        description,
        isLoadingDesc,
        descError,
        descRetries,
        loadLocationDescription,
        locationRef,
        networkStateRef
    } = useLocationDescription();
    
    const {
        explorationMode,
        explorationInterest,
        isSavingPreference,
        preferenceError,
        handleModeChange,
        handlePreferenceChange
    } = useExplorationMode(lastRefreshTimeRef, loadingRef);
    
    const {
        heading,
        setHeading,
        scale,
        handleCopyEmail,
        sidebarRef,
        contentRef,
        handleResize
    } = useUIHandlers();
    
    // 使用键盘导航钩子
    useKeyboardNavigation(loadRandomLocation, isLoading, loadingRef);

    // 创建防抖的 resize 处理函数
    const debouncedResize = useCallback(
        debounce(() => {
            handleResize();
        }, 300),
        [handleResize]
    );
    
    // 监听 location 变化
    useEffect(() => {
        let mounted = true;
        
        if (location?.pano_id) {
            locationRef.current = location;
            
            // 使用 setTimeout 代替 RAF，并添加防抖
            const timeoutId = setTimeout(() => {
                if (mounted && locationRef.current?.pano_id === location.pano_id) {
                    loadLocationDescription(location.pano_id);
                }
            }, 300);
            
            return () => {
                mounted = false;
                clearTimeout(timeoutId);
            };
        }
    }, [location?.pano_id, locationRef, loadLocationDescription]);
    
    // 监听网络状态变化，重新加载描述
    useEffect(() => {
        const handleOnline = () => {
            networkStateRef.current = true;
            // 如果有失败的请求，尝试重新加载
            if (descError && location?.pano_id) {
                loadLocationDescription(location.pano_id);
            }
        };

        window.addEventListener('online', handleOnline);
        
        return () => {
            window.removeEventListener('online', handleOnline);
        };
    }, [descError, location?.pano_id, loadLocationDescription, networkStateRef]);
    
    // 页面加载时根据当前模式加载位置
    useEffect(() => {
        if (explorationMode === EXPLORATION_MODES.CUSTOM && !explorationInterest) {
            // 如果是特定兴趣模式但没有兴趣，切换到随机模式
            handleModeChange(EXPLORATION_MODES.RANDOM);
        } else {
            // 首次加载时跳过限流检查
            loadRandomLocation(true);
        }
    }, [explorationMode, explorationInterest, handleModeChange, loadRandomLocation]);
    
    // 监听描述状态变化，调整UI大小
    useEffect(() => {
        if (description || isLoadingDesc || descError) {
            debouncedResize();
        }
        
        return () => {
            // 清理防抖的timeout
            debouncedResize.cancel && debouncedResize.cancel();
        };
    }, [description, isLoadingDesc, descError, debouncedResize]);
    
    // 如果有错误，显示错误页面
    if (error) {
        return <ErrorDisplay error={error} onRetry={loadRandomLocation} />;
    }

    return (
        <>
            {/* 街景容器 */}
            <StreetViewContainer 
                latitude={location?.latitude} 
                longitude={location?.longitude} 
                onPovChanged={setHeading}
            />
            
            {/* 问号按钮 */}
            <HelpButton onCopyEmail={handleCopyEmail} />
            
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
                            if (location?.pano_id) {
                                loadLocationDescription(location.pano_id);
                            }
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
