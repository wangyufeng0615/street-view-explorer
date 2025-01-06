import React, { memo, forwardRef } from 'react';
import MapSection from './MapSection';
import AiDescription from './AiDescription';
import ExplorationPreference from './ExplorationPreference';
import { formatAddress } from '../utils/addressUtils';
import {
    sidebarStyle,
    sidebarContentStyle,
    addressStyle,
} from '../styles/HomePage.styles';
import '../styles/animations.css';

// 创建基础组件
const SidebarComponent = forwardRef(function Sidebar({
    location,
    heading,
    description,
    isLoadingDesc,
    descError,
    descRetries,
    isLoading,
    onRetryDescription,
    onExplore,
    scale,
    contentRef,
    onPreferenceChange,
    isSavingPreference,
    preferenceError,
    explorationMode,
    explorationInterest,
    onModeChange
}, ref) {
    return (
        <div
            ref={ref}
            style={{
                ...sidebarStyle,
                transform: `scale(${scale})`,
                transition: 'transform 0.3s ease-out',
            }}
        >
            <div ref={contentRef} style={sidebarContentStyle}>
                {location && (
                    <>
                        <MapSection 
                            latitude={location.latitude}
                            longitude={location.longitude}
                            heading={heading}
                        />

                        <div style={addressStyle}>
                            {formatAddress(location)}
                        </div>

                        <AiDescription 
                            isLoading={isLoadingDesc}
                            error={descError}
                            description={description}
                            retries={descRetries}
                            panoId={location.pano_id}
                            onRetry={onRetryDescription}
                        />

                        <ExplorationPreference 
                            onPreferenceChange={onPreferenceChange}
                            onRandomExplore={onExplore}
                            isSavingPreference={isSavingPreference}
                            error={preferenceError}
                            explorationMode={explorationMode}
                            explorationInterest={explorationInterest}
                            onModeChange={onModeChange}
                        />
                    </>
                )}
            </div>
        </div>
    );
});

// 添加记忆化
const Sidebar = memo(SidebarComponent, (prevProps, nextProps) => {
    // 自定义比较函数，只在必要时重新渲染
    if (!prevProps.location || !nextProps.location) {
        return prevProps.location === nextProps.location;
    }
    
    return (
        prevProps.heading === nextProps.heading &&
        prevProps.description === nextProps.description &&
        prevProps.isLoadingDesc === nextProps.isLoadingDesc &&
        prevProps.descError === nextProps.descError &&
        prevProps.descRetries === nextProps.descRetries &&
        prevProps.isLoading === nextProps.isLoading &&
        prevProps.scale === nextProps.scale &&
        prevProps.isSavingPreference === nextProps.isSavingPreference &&
        prevProps.preferenceError === nextProps.preferenceError &&
        prevProps.location.pano_id === nextProps.location.pano_id &&
        prevProps.location.latitude === nextProps.location.latitude &&
        prevProps.location.longitude === nextProps.location.longitude &&
        prevProps.explorationMode === nextProps.explorationMode &&
        prevProps.explorationInterest === nextProps.explorationInterest
    );
});

export default Sidebar; 