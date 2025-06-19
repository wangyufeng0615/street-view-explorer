import React, { useEffect, useCallback } from 'react';
import TopBar from '../components/TopBar';
import NewSidebar from '../components/NewSidebar';
import GlobalLoading from '../components/GlobalLoading';
import ErrorDisplay from '../components/ErrorDisplay';
import StreetViewContainer from '../components/StreetViewContainer';
import Toast from '../components/Toast';
import '../styles/animations.css';
import '../styles/HomePage.css';
import '../styles/responsive.css';

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
        handleCopyEmail,
        toastMessage,
        showToast
    } = useUIHandlers();
    
    // 使用键盘导航钩子
    useKeyboardNavigation(loadRandomLocation, isLoading, loadingRef);
    
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
    
    // 如果有错误，显示错误页面
    if (error) {
        return <ErrorDisplay error={error} onRetry={loadRandomLocation} />;
    }

    return (
        <div style={styles.container}>
            {/* 顶栏 */}
            <TopBar
                location={location}
                isLoading={isLoading}
                onExplore={loadRandomLocation}
                explorationMode={explorationMode}
                explorationInterest={explorationInterest}
                onModeChange={handleModeChange}
                onCopyEmail={handleCopyEmail}
                onPreferenceChange={handlePreferenceChange}
                isSavingPreference={isSavingPreference}
                preferenceError={preferenceError}
            />

            {/* 主要内容区域 */}
            <div style={styles.mainContent}>
                {/* 街景容器 */}
                <div style={styles.streetViewWrapper} className="street-view-wrapper">
                    <StreetViewContainer 
                        latitude={location?.latitude} 
                        longitude={location?.longitude} 
                        onPovChanged={setHeading}
                    />
                </div>

                {/* 侧边栏 */}
                <NewSidebar
                    location={location}
                    heading={heading}
                    description={description}
                    isLoadingDesc={isLoadingDesc}
                    descError={descError}
                    descRetries={descRetries}
                    onRetryDescription={() => {
                        if (location?.pano_id) {
                            loadLocationDescription(location.pano_id);
                        }
                    }}
                />
            </div>

            {/* 全局加载动画 */}
            {isLoading && <GlobalLoading />}
            
            {/* Toast 通知 */}
            <Toast message={toastMessage} visible={showToast} />
        </div>
    );
}

const styles = {
    container: {
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
    },
    mainContent: {
        flex: 1,
        display: 'flex',
        position: 'relative'
    },
    streetViewWrapper: {
        position: 'absolute',
        top: '50px', // 从顶栏下方开始
        left: 0,
        right: '320px', // 到侧边栏左边缘结束
        bottom: 0,
        width: 'auto', // 让浏览器自动计算宽度
        height: 'auto' // 让浏览器自动计算高度
    }
};
