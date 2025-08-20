import { useRef, useCallback } from 'react';
import useStore from '../store/useStore';

export default function useLocationData() {
    // 从Zustand store获取状态和actions
    const location = useStore(state => state.location);
    const error = useStore(state => state.locationError);
    const isLoading = useStore(state => state.isLocationLoading);
    const loadRandomLocationFromStore = useStore(state => state.loadRandomLocation);
    const resetLocationError = useStore(state => state.resetLocationError);
    const lastRefreshTime = useStore(state => state.lastRefreshTime);
    const isLoadingLocation = useStore(state => state.isLoadingLocation);
    
    // 保持refs以保证向后兼容
    const loadingRef = useRef(false);
    const lastRefreshTimeRef = useRef(Date.now() - 1000);
    
    // 包装store的loadRandomLocation以保持兼容性
    const loadRandomLocation = useCallback(async (skipRateLimit = false) => {
        // 同步ref状态
        loadingRef.current = isLoadingLocation;
        lastRefreshTimeRef.current = lastRefreshTime;
        
        // 调用store的方法
        await loadRandomLocationFromStore(skipRateLimit);
    }, [loadRandomLocationFromStore, isLoadingLocation, lastRefreshTime]);
    
    // 为了向后兼容，提供setter函数（虽然现在不需要直接使用）
    const setLocation = useCallback((newLocation) => {
        // 这个函数现在是空的，因为状态由store管理
        // 但保留它以防有组件依赖这个接口
        console.log('setLocation called, but state is managed by Zustand store');
    }, []);
    
    const setError = useCallback((error) => {
        if (error === null) {
            resetLocationError();
        }
        // 其他错误设置由store内部处理
    }, [resetLocationError]);
    
    const setIsLoading = useCallback((loading) => {
        // 同样，这个现在由store管理
        console.log('setIsLoading called, but state is managed by Zustand store');
    }, []);

    return {
        location,
        setLocation,
        error,
        setError,
        isLoading,
        setIsLoading,
        loadRandomLocation,
        loadingRef,
        lastRefreshTimeRef
    };
}