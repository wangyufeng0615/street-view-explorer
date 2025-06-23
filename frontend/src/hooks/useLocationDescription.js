import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getLocationDescription } from '../services/api';

const MAX_RETRIES = 3;
const TIMEOUT_MS = 10000; // 10 seconds timeout

// 简单的防抖函数
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

export default function useLocationDescription() {
    const [description, setDescription] = useState(null);
    const [isLoadingDesc, setIsLoadingDesc] = useState(false);
    const [descError, setDescError] = useState(null);
    const [descRetries, setDescRetries] = useState(0);
    
    // Refs
    const abortControllerRef = useRef(null);
    const retryTimeoutRef = useRef(null);
    const locationRef = useRef(null);
    const loadingDescTimeoutRef = useRef(null);
    const networkStateRef = useRef(navigator.onLine);
    const timeoutRef = useRef(null);
    const isLoadingRef = useRef(false);  // 新增：用ref跟踪加载状态
    
    const { i18n } = useTranslation();
    
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
    
    // 加载位置描述的核心逻辑
    const fetchLocationDescription = useCallback(async (panoId) => {
        if (!panoId || isLoadingRef.current) {
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

        // 清理之前的请求和超时
        cleanup();

        try {
            isLoadingRef.current = true;
            setIsLoadingDesc(true);
            setDescError(null);
            setDescription(null);  // 清除旧的描述
            setDescRetries(0);     // 重置重试次数

            // 创建新的 AbortController
            abortControllerRef.current = new AbortController();

            // Get user's preferred language from i18next
            const userLang = i18n.language || 'en';

            // 再次检查位置和网络状态
            if (locationRef.current?.pano_id !== panoId || !networkStateRef.current) {
                return;
            }

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
                setDescRetries(0);
            } else {
                throw new Error(resp.error || '获取描述失败');
            }
        } catch (err) {
            if (err.name === 'AbortError' || !abortControllerRef.current) {
                return;
            }

            if (locationRef.current?.pano_id !== panoId) {
                return;
            }

            const errorMessage = err.message === '请求超时' ? '获取描述超时，正在重试...' : (err.message || '获取描述失败');
            setDescError(errorMessage);
            setDescription(null);

            if (networkStateRef.current && descRetries < MAX_RETRIES) {
                setDescRetries(prev => prev + 1);
                retryTimeoutRef.current = setTimeout(() => {
                    if (locationRef.current?.pano_id === panoId && networkStateRef.current) {
                        fetchLocationDescription(panoId);
                    }
                }, Math.min(2000 * (descRetries + 1), 5000));
            }
        } finally {
            // 确保loading状态始终被正确重置，即使在竞争条件下
            if (locationRef.current?.pano_id === panoId) {
                isLoadingRef.current = false;
                // 使用 setTimeout 确保状态更新在下一个事件循环中执行
                setTimeout(() => {
                    if (locationRef.current?.pano_id === panoId) {
                        setIsLoadingDesc(false);
                    }
                }, 0);
            }
        }
    }, [cleanup, timeoutPromise, i18n.language]);

    // 使用防抖包装 fetchLocationDescription
    const loadLocationDescription = useCallback(
        debounce((panoId) => {
            fetchLocationDescription(panoId);
        }, 300),
        [fetchLocationDescription]
    );
    
    // 监听网络状态
    useEffect(() => {
        const handleOnline = () => {
            networkStateRef.current = true;
        };

        const handleOffline = () => {
            networkStateRef.current = false;
            if (isLoadingRef.current) {
                setDescError('网络连接已断开');
                isLoadingRef.current = false;
                // 使用 setTimeout 确保状态更新在下一个事件循环中执行
                setTimeout(() => {
                    setIsLoadingDesc(false);
                }, 0);
            }
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);
    
    // 组件卸载时清理资源
    useEffect(() => {
        return () => {
            cleanup();
        };
    }, [cleanup]);
    
    return {
        description,
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