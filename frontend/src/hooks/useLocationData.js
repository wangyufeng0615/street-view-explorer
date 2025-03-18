import { useState, useRef, useCallback } from 'react';
import { getRandomLocation } from '../services/api';

const RATE_LIMIT_MS = 1000; // 1秒限制

export default function useLocationData() {
    const [location, setLocation] = useState(null);
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    
    // Refs
    const loadingRef = useRef(false);
    const lastRefreshTimeRef = useRef(Date.now() - RATE_LIMIT_MS);
    
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