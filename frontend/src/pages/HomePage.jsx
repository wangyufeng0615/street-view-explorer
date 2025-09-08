import React, { useEffect, useCallback, useMemo, useReducer, memo } from 'react';
import TopBar from '../components/TopBar';
import Sidebar from '../components/Sidebar';
import GlobalLoading from '../components/GlobalLoading';
import ErrorDisplay from '../components/ErrorDisplay';
import StreetView from '../components/StreetView';
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

// Memoized StreetViewContainer wrapper
const StreetViewContainer = memo(({ latitude, longitude, onPovChanged }) => {
    return (
        <div className="street-view-container">
            <StreetView 
                latitude={latitude} 
                longitude={longitude} 
                onPovChanged={onPovChanged}
            />
        </div>
    );
}, (prevProps, nextProps) => {
    return prevProps.latitude === nextProps.latitude && 
           prevProps.longitude === nextProps.longitude;
});

StreetViewContainer.displayName = 'StreetViewContainer';

// State reducer to batch updates
const pageStateReducer = (state, action) => {
    switch (action.type) {
        case 'SET_LOCATION':
            return { ...state, location: action.payload };
        case 'SET_HEADING':
            return { ...state, heading: action.payload };
        case 'SET_DESCRIPTION':
            return { ...state, description: action.payload };
        case 'SET_LOADING':
            return { ...state, isLoading: action.payload };
        case 'SET_ERROR':
            return { ...state, error: action.payload };
        case 'BATCH_UPDATE':
            return { ...state, ...action.payload };
        default:
            return state;
    }
};

export default function HomePage() {
    // Use reducer for batched state updates
    const [pageState, dispatch] = useReducer(pageStateReducer, {
        heading: 0,
        location: null,
        description: null,
        isLoading: false,
        error: null
    });
    
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
        isInitialized,
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
    
    // Memoized callbacks to prevent re-renders
    const handlePovChanged = useCallback((newHeading) => {
        // Throttle heading updates
        setHeading(Math.round(newHeading));
    }, [setHeading]);
    
    const handleRetryDescription = useCallback(() => {
        if (location?.pano_id) {
            loadLocationDescription(location.pano_id);
        }
    }, [location?.pano_id, loadLocationDescription]);
    
    const handleExplore = useCallback(() => {
        loadRandomLocation();
    }, [loadRandomLocation]);
    
    // Debounced location description loading
    useEffect(() => {
        let mounted = true;
        let timeoutId = null;
        
        if (location?.pano_id) {
            locationRef.current = location;
            
            // Debounce description loading
            timeoutId = setTimeout(() => {
                if (mounted && locationRef.current?.pano_id === location.pano_id) {
                    loadLocationDescription(location.pano_id);
                }
            }, 300);
        }
        
        return () => {
            mounted = false;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
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
    
    // 页面加载时根据当前模式加载位置 - 等待状态初始化完成
    useEffect(() => {
        // 等待状态完全初始化
        if (!isInitialized) {
            return;
        }
        
        if (explorationMode === EXPLORATION_MODES.CUSTOM && !explorationInterest) {
            // 如果是特定兴趣模式但没有兴趣，切换到随机模式
            handleModeChange(EXPLORATION_MODES.RANDOM);
        } else {
            // 首次加载时跳过限流检查
            loadRandomLocation(true);
        }
    }, [isInitialized]); // Reduced dependencies
    
    // Memoized styles to prevent re-creation
    const styles = useMemo(() => ({
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
            top: '50px',
            left: 0,
            right: '320px',
            bottom: 0,
            width: 'auto',
            height: 'auto'
        }
    }), []);
    
    // 如果有错误，显示错误页面
    if (error) {
        return <ErrorDisplay error={error} onRetry={handleExplore} />;
    }

    return (
        <div style={styles.container}>
            {/* 顶栏 */}
            <TopBar
                location={location}
                isLoading={isLoading}
                onExplore={handleExplore}
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
                        onPovChanged={handlePovChanged}
                    />
                </div>

                {/* 侧边栏 */}
                <Sidebar
                    location={location}
                    heading={heading}
                    description={description}
                    isLoadingDesc={isLoadingDesc}
                    descError={descError}
                    descRetries={descRetries}
                    onRetryDescription={handleRetryDescription}
                />
            </div>

            {/* 全局加载动画 */}
            {isLoading && <GlobalLoading />}
            
            {/* Toast 通知 */}
            <Toast message={toastMessage} visible={showToast} />
        </div>
    );
}
