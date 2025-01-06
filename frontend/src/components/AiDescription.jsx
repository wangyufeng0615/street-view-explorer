import React, { memo, useMemo, useEffect, useState, useRef } from 'react';
import { aiThinkingMessages } from '../constants/loadingMessages';
import { buttonStyle } from '../styles/HomePage.styles';
import '../styles/AiDescription.css';

const MAX_RETRIES = 3;
const INITIAL_PROGRESS_DURATION = 3500; // 3.5秒
const SLOW_PROGRESS_SPEED = 0.1; // 每秒增加的百分比

const AiDescription = memo(function AiDescription({
    isLoading,
    error,
    description,
    retries,
    panoId,
    onRetry
}) {
    const [progress, setProgress] = useState(0);
    const progressTimer = useRef(null);
    const slowProgressTimer = useRef(null);

    const thinkingMessage = useMemo(() => {
        return aiThinkingMessages[Math.floor(Math.random() * aiThinkingMessages.length)];
    }, [isLoading]);

    useEffect(() => {
        if (isLoading) {
            // 重置进度
            setProgress(0);
            
            // 清除之前的定时器
            if (progressTimer.current) clearInterval(progressTimer.current);
            if (slowProgressTimer.current) clearInterval(slowProgressTimer.current);

            // 设置主要进度动画
            const startTime = Date.now();
            progressTimer.current = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const calculatedProgress = Math.min((elapsed / INITIAL_PROGRESS_DURATION) * 100, 95);
                
                if (calculatedProgress >= 95) {
                    clearInterval(progressTimer.current);
                    // 开始缓慢进度
                    slowProgressTimer.current = setInterval(() => {
                        setProgress(prev => {
                            const newProgress = prev + SLOW_PROGRESS_SPEED;
                            return newProgress >= 99 ? 99 : newProgress;
                        });
                    }, 1000);
                } else {
                    setProgress(calculatedProgress);
                }
            }, 50);
        } else {
            // 清除定时器
            if (progressTimer.current) clearInterval(progressTimer.current);
            if (slowProgressTimer.current) clearInterval(slowProgressTimer.current);
            
            // 如果加载完成，将进度设置为100%
            if (!error && description) {
                setProgress(100);
            }
        }

        return () => {
            if (progressTimer.current) clearInterval(progressTimer.current);
            if (slowProgressTimer.current) clearInterval(slowProgressTimer.current);
        };
    }, [isLoading, error, description]);

    return (
        <div className="ai-description">
            <div className="ai-icon">Dr. Atlas (AI)</div>
            {isLoading ? (
                <div className="ai-loading-container">
                    <div className="ai-loading-row">
                        <div className="loading-message">
                            {retries > 0 ? `重试中(${retries}/${MAX_RETRIES})...` : thinkingMessage}
                        </div>
                    </div>
                    <div className="ai-progress-container">
                        <div 
                            className="ai-progress-bar"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            ) : error ? (
                <div className="ai-error">
                    <p>{error}</p>
                    <button 
                        onClick={onRetry}
                        style={{
                            ...buttonStyle,
                            fontSize: '14px',
                            padding: '6px 12px',
                            marginTop: '8px'
                        }}
                    >
                        重试获取描述
                    </button>
                </div>
            ) : description ? (
                <p className="ai-content">{description}</p>
            ) : panoId ? (
                <div className="ai-loading-container">
                    <div className="ai-loading-row">
                        <div className="ai-thinking-icon">
                            <span>AI</span>
                        </div>
                        <div className="loading-message">正在等待 AI 分析...</div>
                    </div>
                    <div className="ai-progress-container">
                        <div 
                            className="ai-progress-bar"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            ) : (
                <p className="ai-no-data">
                    无法获取此位置的街景信息，请尝试继续探索其他位置。
                </p>
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.isLoading === nextProps.isLoading &&
        prevProps.error === nextProps.error &&
        prevProps.description === nextProps.description &&
        prevProps.retries === nextProps.retries &&
        prevProps.panoId === nextProps.panoId
    );
});

export default AiDescription; 