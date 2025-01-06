import React, { useState, useCallback, useEffect, useRef, forwardRef } from 'react';
import '../styles/ExplorationPreference.css';

const ExplorationPreference = forwardRef(({ 
    onPreferenceChange, 
    onRandomExplore, 
    isSavingPreference, 
    error,
    onModeChange,
    explorationMode = 'random',
    explorationInterest: initialInterest
}, ref) => {
    const [preference, setPreference] = useState(initialInterest || '');
    const [showEffect, setShowEffect] = useState(false);
    const [lastSuccessInterest, setLastSuccessInterest] = useState(initialInterest || '');
    const inputRef = useRef(null);

    // 确保在组件挂载时设置为随机模式（如果没有保存的兴趣）
    useEffect(() => {
        if (!initialInterest && explorationMode !== 'random') {
            onModeChange?.('random');
        }
    }, []);

    // 添加空格键处理
    useEffect(() => {
        const handleKeyPress = (event) => {
            // 如果当前焦点在输入框或文本框上，不触发空格键探索
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }
            
            if (event.code === 'Space' && !isSavingPreference) {
                event.preventDefault();
                onRandomExplore();
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [isSavingPreference, onRandomExplore]);

    // 更新 preference 状态
    useEffect(() => {
        setPreference(initialInterest || '');
        setLastSuccessInterest(initialInterest || '');
    }, [initialInterest]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const trimmedPreference = preference.trim();
        if (trimmedPreference) {
            // 如果和上次成功的探索兴趣相同，直接刷新页面
            if (trimmedPreference === lastSuccessInterest) {
                onRandomExplore();
                return;
            }

            try {
                const result = await onPreferenceChange(trimmedPreference);
                if (result?.success) {
                    // 记录成功的探索兴趣
                    setLastSuccessInterest(trimmedPreference);
                    // 自动触发探索
                    onRandomExplore();
                }
            } catch (err) {
                console.error('Failed to save preference:', err);
            }
        }
    };

    const handleRandomClick = useCallback(() => {
        setShowEffect(true);
        onRandomExplore();
        
        // 动画结束后重置状态
        setTimeout(() => {
            setShowEffect(false);
        }, 600);
    }, [onRandomExplore]);

    // 切换标签时的处理
    const handleTabChange = (mode, e) => {
        // 阻止默认行为
        e?.preventDefault();
        
        if (mode === explorationMode) {
            return;
        }
        
        if (mode === 'random') {
            setPreference('');
        }
        onModeChange?.(mode);
    };

    return (
        <div className="exploration-preference">
            <div className="preference-tabs">
                <div className="tabs-container">
                    <button
                        className={`preference-tab ${explorationMode === 'random' ? 'active' : ''}`}
                        onClick={(e) => handleTabChange('random', e)}
                    >
                        <span className="tab-icon">🎲</span>
                        随机探索地球
                    </button>
                    <button
                        className={`preference-tab ${explorationMode === 'custom' ? 'active' : ''}`}
                        onClick={(e) => handleTabChange('custom', e)}
                    >
                        <span className="tab-icon">🎯</span>
                        探索特定兴趣
                    </button>
                    <div className={`tab-slider ${explorationMode === 'custom' ? 'right' : ''}`} />
                </div>
            </div>

            <div className="preference-content">
                <div className="preference-content-inner">
                    {explorationMode === 'random' ? (
                        <button 
                            className={`preference-submit random-explore ${showEffect ? 'effect' : ''}`}
                            onClick={handleRandomClick}
                            style={{ width: '100%' }}
                            disabled={isSavingPreference}
                        >
                            <span className="button-content">
                                <span className="explore-icon">🌍</span>
                                GO! (或按空格)
                            </span>
                            {showEffect && (
                                <div className="effect-container">
                                    <div className="effect-circle" />
                                    <div className="effect-circle" />
                                    <div className="effect-circle" />
                                </div>
                            )}
                        </button>
                    ) : (
                        <div className="preference-input-group">
                            <input
                                type="text"
                                value={preference}
                                onChange={(e) => setPreference(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && preference.trim() && !isSavingPreference) {
                                        e.preventDefault();
                                        handleSubmit(e);
                                    }
                                }}
                                placeholder="随意输入你想要探索的主题!"
                                className="preference-input"
                                disabled={isSavingPreference}
                            />
                            <button 
                                onClick={handleSubmit}
                                className="preference-submit"
                                disabled={!preference.trim() || isSavingPreference}
                            >
                                <span className="button-content">
                                    {isSavingPreference ? (
                                        <>
                                            <span className="thinking-dots">
                                                <span className="dot"></span>
                                                <span className="dot"></span>
                                                <span className="dot"></span>
                                            </span>
                                            理解中...
                                        </>
                                    ) : (
                                        <>
                                            <span className="explore-icon">🌍</span>
                                            GO!
                                        </>
                                    )}
                                </span>
                            </button>
                        </div>
                    )}
                    {error && <div className="preference-error">{error}</div>}
                </div>
            </div>
        </div>
    );
});

export default ExplorationPreference; 