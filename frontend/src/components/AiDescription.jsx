import React, { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
// import { aiThinkingMessages } from '../constants/loadingMessages'; // Remove this import
import { buttonStyle } from '../styles/HomePage.styles';
import { getLocationDetailedDescription } from '../services/api';
import '../styles/AiDescription.css';

const AiDescription = memo(function AiDescription({
    isLoading,
    error,
    description,
    retries,
    panoId,
    onRetry
}) {
    const { t, i18n } = useTranslation();
    
    // 详细介绍的状态管理
    const [detailedDescription, setDetailedDescription] = useState(null);
    const [isLoadingDetailed, setIsLoadingDetailed] = useState(false);
    const [detailedError, setDetailedError] = useState(null);
    const [hasRequestedDetailed, setHasRequestedDetailed] = useState(false);
    
    // 判断是否应该显示loading状态
    const shouldShowLoading = isLoading || (panoId && !description && !error);
    
    // 检测文本语言（简单的中英文检测）
    const detectLanguage = (text) => {
        if (!text) return 'en';
        // 检测中文字符的比例
        const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
        const totalChars = text.replace(/\s/g, '').length;
        return chineseChars.length / totalChars > 0.3 ? 'zh' : 'en';
    };

    // 添加装饰性的思考图标
    const ThinkingIcon = () => (
        <div className="thinking-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
        </div>
    );

    // 处理"为我介绍更多"按钮点击
    const handleTellMeMore = useCallback(async () => {
        if (!panoId || isLoadingDetailed || hasRequestedDetailed) return;
        
        // 确保基础描述已存在
        if (!description) {
            setDetailedError(t('ai.needBasicDescriptionFirst'));
            return;
        }
        
        setIsLoadingDetailed(true);
        setDetailedError(null);
        setHasRequestedDetailed(true);
        
        try {
            const result = await getLocationDetailedDescription(panoId, i18n.language);
            if (result.success) {
                setDetailedDescription(result.data);
            } else {
                setDetailedError(result.error);
            }
        } catch (err) {
            setDetailedError(err.message || '获取详细介绍失败');
        } finally {
            setIsLoadingDetailed(false);
        }
    }, [panoId, i18n.language, isLoadingDetailed, hasRequestedDetailed, description, t]);

    // 重试详细介绍
    const handleRetryDetailed = useCallback(async () => {
        if (!panoId || isLoadingDetailed) return;
        
        setIsLoadingDetailed(true);
        setDetailedError(null);
        
        try {
            const result = await getLocationDetailedDescription(panoId, i18n.language);
            if (result.success) {
                setDetailedDescription(result.data);
                setDetailedError(null);
            } else {
                setDetailedError(result.error);
            }
        } catch (err) {
            setDetailedError(err.message || '获取详细介绍失败');
        } finally {
            setIsLoadingDetailed(false);
        }
    }, [panoId, i18n.language, isLoadingDetailed]);

    // 当panoId改变时重置状态
    React.useEffect(() => {
        setDetailedDescription(null);
        setDetailedError(null);
        setHasRequestedDetailed(false);
        setIsLoadingDetailed(false);
    }, [panoId]);

    return (
        <div className="ai-description">
            {shouldShowLoading ? (
                <div className="ai-loading-container">
                    <ThinkingIcon />
                    <div className="loading-message">
                        {retries > 0 ? t('ai.retrying', { retries: retries }) : t('ai.waitingForAnalysis')}
                    </div>
                </div>
            ) : error ? (
                <div className="ai-error">
                    <div style={{ marginBottom: '8px' }}>{error}</div>
                    <button 
                        onClick={onRetry}
                        style={{
                            ...buttonStyle,
                            fontSize: '13px',
                            padding: '6px 12px',
                            backgroundColor: '#ef4444',
                            borderColor: '#ef4444',
                            borderRadius: '8px'
                        }}
                    >
                        {t('ai.retryGetDescription')}
                    </button>
                </div>
            ) : description ? (
                <div className="ai-content-container">
                    {/* 基础描述 */}
                    <div 
                        className="ai-content" 
                        lang={detectLanguage(description)}
                        style={{
                            // 根据当前界面语言动态调整样式
                            textAlign: i18n.language === 'zh' ? 'justify' : 'left'
                        }}
                    >
                        {/* 将长文本分段显示，提高可读性 */}
                        {description.split('\n').map((paragraph, index) => {
                            if (paragraph.trim() === '') return null;
                            return (
                                <div key={index} style={{ 
                                    marginBottom: index < description.split('\n').length - 1 ? '12px' : '0' 
                                }}>
                                    {paragraph}
                                </div>
                            );
                        })}
                    </div>

                    {/* "为我介绍更多"按钮 */}
                    {!hasRequestedDetailed && !detailedDescription && (
                        <div className="tell-me-more-container">
                            <button 
                                className="tell-me-more-button"
                                onClick={handleTellMeMore}
                                disabled={isLoadingDetailed}
                            >
                                <span className="button-icon">🔍</span>
                                <span className="button-text">
                                    {isLoadingDetailed ? t('ai.loadingDetailedDescription') : t('ai.tellMeMore')}
                                </span>
                            </button>
                        </div>
                    )}

                    {/* 详细介绍加载状态 */}
                    {isLoadingDetailed && (
                        <div className="detailed-loading-container">
                            <ThinkingIcon />
                            <div className="loading-message">
                                {t('ai.loadingDetailedDescription')}
                            </div>
                        </div>
                    )}

                    {/* 详细介绍错误状态 */}
                    {detailedError && (
                        <div className="detailed-error-container">
                            <div className="error-message">{detailedError}</div>
                            <button 
                                className="retry-detailed-button"
                                onClick={handleRetryDetailed}
                                disabled={isLoadingDetailed}
                            >
                                {t('ai.retryDetailedDescription')}
                            </button>
                        </div>
                    )}

                    {/* 详细介绍内容 */}
                    {detailedDescription && (
                        <div className="detailed-description">
                            <div className="detailed-description-header">
                                <div className="detailed-title">✨ {t('ai.detailedAnalysisRequested')}</div>
                            </div>
                            <div 
                                className="detailed-content"
                                lang={detectLanguage(detailedDescription)}
                                style={{
                                    textAlign: i18n.language === 'zh' ? 'justify' : 'left'
                                }}
                            >
                                {detailedDescription.split('\n').map((paragraph, index) => {
                                    if (paragraph.trim() === '') return null;
                                    return (
                                        <div key={index} style={{ 
                                            marginBottom: index < detailedDescription.split('\n').length - 1 ? '16px' : '0' 
                                        }}>
                                            {paragraph}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="ai-no-data">
                    {t('ai.cannotGetStreetView')}
                </div>
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

const styles = {
    container: {
        fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize: '13px',
        lineHeight: '1.5',
        color: '#333'
    }
};

export default AiDescription; 