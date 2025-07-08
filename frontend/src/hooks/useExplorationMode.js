import { useState, useCallback, useEffect } from 'react';
import { setExplorationPreference, deleteExplorationPreference } from '../services/api';

// 探索模式的存储键
const EXPLORATION_MODE_KEY = 'exploration_mode';
const EXPLORATION_INTEREST_KEY = 'exploration_interest';

// 探索模式枚举
const EXPLORATION_MODES = {
    RANDOM: 'random',
    CUSTOM: 'custom'
};

export { EXPLORATION_MODES };

export default function useExplorationMode(lastRefreshTimeRef, loadingRef) {
    const [explorationMode, setExplorationMode] = useState(EXPLORATION_MODES.RANDOM);
    const [explorationInterest, setExplorationInterest] = useState('');
    const [isSavingPreference, setIsSavingPreference] = useState(false);
    const [preferenceError, setPreferenceError] = useState(null);
    const [isInitialized, setIsInitialized] = useState(false); // 添加初始化标志
    
    const RATE_LIMIT_MS = 1000; // 1秒限制

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
        
        // 状态恢复完成，设置初始化标志
        setIsInitialized(true);
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
            
            const resp = await setExplorationPreference(preference);
            
            if (resp.success) {
                // 更新最后刷新时间
                lastRefreshTimeRef.current = Date.now();
                
                localStorage.setItem(EXPLORATION_MODE_KEY, EXPLORATION_MODES.CUSTOM);
                localStorage.setItem(EXPLORATION_INTEREST_KEY, preference);
                setExplorationMode(EXPLORATION_MODES.CUSTOM);
                setExplorationInterest(preference);
                return { success: true, skipRateLimit: true };
            } else {
                throw new Error(resp.error || '保存兴趣失败');
            }
        } catch (err) {
            setPreferenceError(err.message);
            return { success: false, error: err.message };
        } finally {
            loadingRef.current = false;
            setIsSavingPreference(false);
        }
    }, [lastRefreshTimeRef, loadingRef]);

    // 删除探索兴趣
    const handleDeletePreference = useCallback(async () => {
        try {
            await deleteExplorationPreference();
            localStorage.removeItem(EXPLORATION_MODE_KEY);
            localStorage.removeItem(EXPLORATION_INTEREST_KEY);
            setExplorationMode(EXPLORATION_MODES.RANDOM);
            setExplorationInterest('');
        } catch (err) {
            console.error('Error deleting preference:', err);
        }
    }, []);

    return {
        explorationMode,
        explorationInterest,
        isSavingPreference,
        preferenceError,
        isInitialized,
        handleModeChange,
        handlePreferenceChange,
        handleDeletePreference
    };
} 