import { useEffect, useCallback } from 'react';
import useStore from '../store/useStore';

// 探索模式枚举
const EXPLORATION_MODES = {
    RANDOM: 'random',
    CUSTOM: 'custom'
};

export { EXPLORATION_MODES };

export default function useExplorationMode(lastRefreshTimeRef, loadingRef) {
    // 从Zustand store获取状态和actions
    const explorationMode = useStore(state => state.explorationMode);
    const explorationInterest = useStore(state => state.explorationInterest);
    const isSavingPreference = useStore(state => state.isSavingPreference);
    const preferenceError = useStore(state => state.preferenceError);
    const isInitialized = useStore(state => state.isExplorationInitialized);
    const handleModeChangeFromStore = useStore(state => state.handleModeChange);
    const handlePreferenceChangeFromStore = useStore(state => state.handlePreferenceChange);
    const initializeExplorationMode = useStore(state => state.initializeExplorationMode);
    const lastRefreshTime = useStore(state => state.lastRefreshTime);
    const isLoadingLocation = useStore(state => state.isLoadingLocation);
    
    // 同步refs（为了向后兼容）
    useEffect(() => {
        if (lastRefreshTimeRef) {
            lastRefreshTimeRef.current = lastRefreshTime;
        }
        if (loadingRef) {
            loadingRef.current = isLoadingLocation;
        }
    }, [lastRefreshTime, isLoadingLocation, lastRefreshTimeRef, loadingRef]);
    
    // 初始化探索模式
    useEffect(() => {
        if (!isInitialized) {
            initializeExplorationMode();
        }
    }, [isInitialized, initializeExplorationMode]);
    
    // 包装store的actions以保持兼容性
    const handleModeChange = useCallback(async (mode) => {
        await handleModeChangeFromStore(mode);
    }, [handleModeChangeFromStore]);
    
    const handlePreferenceChange = useCallback(async (interest) => {
        await handlePreferenceChangeFromStore(interest);
    }, [handlePreferenceChangeFromStore]);
    
    return {
        explorationMode,
        explorationInterest,
        isSavingPreference,
        preferenceError,
        isInitialized,
        handleModeChange,
        handlePreferenceChange
    };
}