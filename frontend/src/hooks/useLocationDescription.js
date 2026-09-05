import { useRef, useCallback, useEffect } from 'react';
import useStore from '../store/useStore';

export default function useLocationDescription() {
    // 从Zustand store获取状态和actions
    const description = useStore(state => state.description);
    const descriptionCitations = useStore(state => state.descriptionCitations);
    const descriptionResearchStatus = useStore(state => state.descriptionResearchStatus);
    const isLoadingDesc = useStore(state => state.isDescriptionLoading);
    const descError = useStore(state => state.descriptionError);
    const descRetries = useStore(state => state.descriptionRetries);
    const loadLocationDescriptionFromStore = useStore(state => state.loadLocationDescription);
    const cancelLocationDescription = useStore(state => state.cancelLocationDescription);
    const resetDescriptionError = useStore(state => state.resetDescriptionError);
    const setNetworkState = useStore(state => state.setNetworkState);
    const networkState = useStore(state => state.networkState);
    const currentLocationRef = useStore(state => state.currentLocationRef);
    
    // 保持refs以保证向后兼容
    const locationRef = useRef(null);
    const networkStateRef = useRef(navigator.onLine);
    const abortControllerRef = useRef(null);
    const retryTimeoutRef = useRef(null);
    const loadingDescTimeoutRef = useRef(null);
    const timeoutRef = useRef(null);
    const isLoadingRef = useRef(false);
    
    // 同步store状态到refs
    useEffect(() => {
        locationRef.current = currentLocationRef;
        networkStateRef.current = networkState;
        isLoadingRef.current = isLoadingDesc;
    }, [currentLocationRef, networkState, isLoadingDesc]);
    
    // 清理函数
    const cleanup = useCallback(() => {
        cancelLocationDescription();
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
    }, [cancelLocationDescription]);
    
    // 包装store的loadLocationDescription
    const loadLocationDescription = useCallback((panoId) => {
        // 调用store的方法
        loadLocationDescriptionFromStore(panoId);
    }, [loadLocationDescriptionFromStore]);
    
    // 监听网络状态
    useEffect(() => {
        const handleOnline = () => {
            setNetworkState(true);
            networkStateRef.current = true;
        };

        const handleOffline = () => {
            setNetworkState(false);
            networkStateRef.current = false;
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [setNetworkState]);
    
    // 组件卸载时清理资源
    useEffect(() => {
        return () => {
            cleanup();
        };
    }, [cleanup]);
    
    // 为了向后兼容，提供setter函数
    const setDescription = useCallback((_desc) => {
        // 由store管理
        console.log('setDescription called, but state is managed by Zustand store');
    }, []);
    
    const setIsLoadingDesc = useCallback((_loading) => {
        // 由store管理
        console.log('setIsLoadingDesc called, but state is managed by Zustand store');
    }, []);
    
    const setDescError = useCallback((error) => {
        if (error === null) {
            resetDescriptionError();
        }
        // 其他错误设置由store内部处理
    }, [resetDescriptionError]);
    
    const setDescRetries = useCallback((_retries) => {
        // 由store管理
        console.log('setDescRetries called, but state is managed by Zustand store');
    }, []);
    
    return {
        description,
        descriptionCitations,
        descriptionResearchStatus,
        setDescription,
        isLoadingDesc,
        setIsLoadingDesc,
        descError,
        setDescError,
        descRetries,
        setDescRetries,
        loadLocationDescription,
        cleanup,
        locationRef,
        networkStateRef
    };
}
