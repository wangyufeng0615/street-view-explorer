import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAddress } from '../utils/addressUtils';
import { EXPLORATION_MODES } from '../hooks/useExplorationMode';
import { resetGoogleMapsPromise } from '../utils/googleMaps';

const TopBar = memo(function TopBar({
    location,
    isLoading,
    onExplore,
    explorationMode,
    explorationInterest,
    onModeChange,
    onCopyEmail,
    onPreferenceChange,
    isSavingPreference
}) {
    const { t, i18n } = useTranslation();
    const [showDropdown, setShowDropdown] = useState(false);
    const [showInterestModal, setShowInterestModal] = useState(false);
    const [tempInterest, setTempInterest] = useState(explorationInterest || '');

    const changeLanguage = (lng) => {
        if (i18n.language === lng) return;
        resetGoogleMapsPromise();
        i18n.changeLanguage(lng).then(() => {
            // 清理地图元素
            const mapElements = document.querySelectorAll('.gm-style');
            mapElements.forEach(elem => {
                if (elem.parentNode) {
                    elem.parentNode.removeChild(elem);
                }
            });
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
            }, 300);
        });
        setShowDropdown(false);
    };

    const handleGoClick = () => {
        if (!isLoading) {
            onExplore();
        }
    };

    const handleContactClick = () => {
        onCopyEmail();
        setShowDropdown(false);
    };

    const handleModeClick = (mode) => {
        if (mode === EXPLORATION_MODES.RANDOM) {
            onModeChange(mode);
        } else if (mode === EXPLORATION_MODES.CUSTOM) {
            setTempInterest(explorationInterest || '');
            setShowInterestModal(true);
        }
    };

    const handleInterestSubmit = async () => {
        const trimmedInterest = tempInterest.trim();
        if (trimmedInterest) {
            try {
                const result = await onPreferenceChange(trimmedInterest);
                if (result?.success) {
                    setShowInterestModal(false);
                    // 自动加载新位置
                    onExplore(result.skipRateLimit);
                }
            } catch (err) {
                console.error('Failed to save preference:', err);
            }
        }
    };

    const handleInterestCancel = () => {
        setShowInterestModal(false);
        setTempInterest(explorationInterest || '');
    };

    return (
        <>
            <div style={styles.topBar} className="top-bar">
                {/* 左侧网站主旨 */}
                <div style={styles.leftSection} className="left-section">
                    <h1 style={styles.siteTagline}>
                        {t('site_tagline')}
                    </h1>
                </div>

                {/* 中间地址显示 */}
                <div style={styles.centerSection} className="center-section">
                    <div style={styles.addressContainer} className="address-container">
                        {location ? (
                            <span style={styles.address} className="address">
                                📍 {formatAddress(location)}
                            </span>
                        ) : (
                            <span style={styles.addressPlaceholder}>
                                📍 {t('loading_location')}
                            </span>
                        )}
                    </div>
                </div>

                {/* 右侧控制组 */}
                <div style={styles.rightSection} className="right-section">
                    {/* 模式切换 */}
                    <div style={styles.modeToggle}>
                        <button
                            style={{
                                ...styles.modeButton,
                                ...(explorationMode === EXPLORATION_MODES.RANDOM ? styles.activeModeButton : {})
                            }}
                            className="hover-scale mode-button"
                            onClick={() => handleModeClick(EXPLORATION_MODES.RANDOM)}
                        >
                            🎲 {t('random_mode')}
                        </button>
                        <button
                            style={{
                                ...styles.modeButton,
                                ...(explorationMode === EXPLORATION_MODES.CUSTOM ? styles.activeModeButton : {})
                            }}
                            className="hover-scale mode-button"
                            onClick={() => handleModeClick(EXPLORATION_MODES.CUSTOM)}
                        >
                            🎯 {explorationInterest || t('custom_mode')}
                        </button>
                    </div>

                    {/* GO按钮 */}
                    <button
                        style={{
                            ...styles.goButton,
                            ...(isLoading || isSavingPreference ? styles.goButtonDisabled : {})
                        }}
                        className={`go-button-animated ${isLoading || isSavingPreference ? 'go-button' : 'hover-glow go-button'}`}
                        onClick={handleGoClick}
                        disabled={isLoading || isSavingPreference}
                    >
                        <span>
                            {isLoading || isSavingPreference ? '⏳' : t('go_explore')}
                        </span>
                    </button>

                    {/* 设置菜单 */}
                    <div style={styles.dropdownContainer}>
                        <button
                            style={styles.settingsButton}
                            className="hover-scale"
                            onClick={() => setShowDropdown(!showDropdown)}
                        >
                            ⚙️
                        </button>
                        
                        {showDropdown && (
                            <div style={styles.dropdown}>
                                <div style={styles.dropdownItem}>
                                    <span style={styles.dropdownLabel}>{t('language')}</span>
                                    <div style={styles.languageButtons}>
                                        <button
                                            style={{
                                                ...styles.langButton,
                                                ...(i18n.resolvedLanguage === 'en' ? styles.activeLangButton : {})
                                            }}
                                            className="lang-button"
                                            onClick={() => changeLanguage('en')}
                                            disabled={i18n.resolvedLanguage === 'en'}
                                        >
                                            EN
                                        </button>
                                        <button
                                            style={{
                                                ...styles.langButton,
                                                ...(i18n.resolvedLanguage === 'zh' ? styles.activeLangButton : {})
                                            }}
                                            className="lang-button"
                                            onClick={() => changeLanguage('zh')}
                                            disabled={i18n.resolvedLanguage === 'zh'}
                                        >
                                            中
                                        </button>
                                    </div>
                                </div>
                                
                                <button
                                    style={styles.dropdownButton}
                                    onClick={handleContactClick}
                                >
                                    📧 {t('contact_info')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* 点击外部关闭下拉菜单 */}
                {showDropdown && (
                    <div 
                        style={styles.overlay} 
                        onClick={() => setShowDropdown(false)}
                    />
                )}
            </div>

            {/* 兴趣输入模态窗口 */}
            {showInterestModal && (
                <div style={styles.modalOverlay} onClick={handleInterestCancel}>
                    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <h3 style={styles.modalTitle}>🎯 {t('set_interest_title')}</h3>
                        <p style={styles.modalDescription}>
                            {t('set_interest_description')}
                        </p>
                        <input
                            type="text"
                            value={tempInterest}
                            onChange={(e) => setTempInterest(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && tempInterest.trim() && !isSavingPreference) {
                                    handleInterestSubmit();
                                } else if (e.key === 'Escape') {
                                    handleInterestCancel();
                                }
                            }}
                            placeholder={t('interest_placeholder')}
                            style={styles.modalInput}
                            autoFocus
                            disabled={isSavingPreference}
                        />
                        <div style={styles.modalButtons}>
                            <button
                                style={styles.modalCancelButton}
                                onClick={handleInterestCancel}
                                disabled={isSavingPreference}
                            >
                                {t('cancel')}
                            </button>
                            <button
                                style={{
                                    ...styles.modalSaveButton,
                                    ...((!tempInterest.trim() || isSavingPreference) ? styles.modalSaveButtonDisabled : {})
                                }}
                                onClick={handleInterestSubmit}
                                disabled={!tempInterest.trim() || isSavingPreference}
                            >
                                {isSavingPreference ? '⏳ ' + t('saving') : t('save_and_explore')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
});

const styles = {
    topBar: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '50px',
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        zIndex: 1000,
        boxShadow: '0 1px 20px rgba(0, 0, 0, 0.08)',
        fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'
    },
    leftSection: {
        flex: '0 0 auto',
        minWidth: 'max-content',
        marginRight: '20px'
    },
    siteTagline: {
        fontSize: '16px',
        fontWeight: '600',
        color: '#333',
        margin: 0,
        fontFamily: '"Comfortaa", "PingFang SC", "Hiragino Sans GB", sans-serif',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap'
    },
    centerSection: {
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
    },
    addressContainer: {
        maxWidth: '400px'
    },
    address: {
        fontSize: '14px',
        color: '#333',
        fontWeight: '500',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'block',
        lineHeight: '1.2'
    },
    addressPlaceholder: {
        fontSize: '14px',
        color: '#999',
        fontStyle: 'italic',
        opacity: 0.8
    },
    rightSection: {
        flex: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '16px'
    },
    modeToggle: {
        display: 'flex',
        backgroundColor: '#f5f5f5',
        borderRadius: '12px',
        padding: '3px',
        gap: '2px',
        border: '1px solid rgba(0, 0, 0, 0.05)'
    },
    modeButton: {
        padding: '8px 16px',
        border: 'none',
        borderRadius: '8px',
        fontSize: '13px',
        cursor: 'pointer',
        backgroundColor: 'transparent',
        color: '#666',
        fontFamily: 'inherit',
        fontWeight: '500',
        transition: 'all 0.3s ease',
        whiteSpace: 'nowrap',
        position: 'relative'
    },
    activeModeButton: {
        backgroundColor: '#ffffff',
        color: '#333',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        transform: 'scale(1.02)'
    },
    dropdownContainer: {
        position: 'relative'
    },
    settingsButton: {
        padding: '8px 10px',
        border: '1px solid #ddd',
        borderRadius: '8px',
        backgroundColor: '#f8f8f8',
        cursor: 'pointer',
        fontSize: '14px',
        transition: 'all 0.2s ease',
        fontFamily: 'inherit'
    },
    dropdown: {
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: '4px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        padding: '8px',
        minWidth: '160px',
        zIndex: 1001
    },
    dropdownItem: {
        marginBottom: '8px',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(0, 0, 0, 0.1)'
    },
    dropdownLabel: {
        fontSize: '12px',
        color: '#666',
        marginBottom: '4px',
        display: 'block'
    },
    languageButtons: {
        display: 'flex',
        backgroundColor: '#f0f0f0',
        borderRadius: '6px',
        padding: '2px',
        gap: '1px',
        width: 'fit-content'
    },
    langButton: {
        padding: '3px 6px',
        border: 'none',
        borderRadius: '4px',
        fontSize: '11px',
        cursor: 'pointer',
        backgroundColor: 'transparent',
        color: '#666',
        fontFamily: 'inherit',
        fontWeight: '500',
        transition: 'all 0.2s ease',
        minWidth: '18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    },
    activeLangButton: {
        backgroundColor: '#ffffff',
        color: '#333',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
    },
    dropdownButton: {
        width: '100%',
        padding: '8px 12px',
        border: 'none',
        borderRadius: '6px',
        backgroundColor: '#f8f8f8',
        cursor: 'pointer',
        fontSize: '12px',
        fontFamily: 'inherit',
        color: '#333',
        transition: 'all 0.2s ease',
        textAlign: 'left'
    },
    goButton: {
        padding: '8px 32px',
        color: 'white',
        border: 'none',
        borderRadius: '10px',
        fontSize: '15px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        fontFamily: 'inherit',
        minWidth: '120px',
        position: 'relative',
        whiteSpace: 'nowrap'
    },
    goButtonDisabled: {
        opacity: 0.6
    },
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 999
    },
    modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1100,
        animation: 'fadeIn 0.2s ease-out'
    },
    modal: {
        backgroundColor: 'white',
        padding: '24px',
        borderRadius: '16px',
        maxWidth: '400px',
        width: 'calc(100% - 40px)',
        margin: '20px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        animation: 'slideUp 0.3s ease-out',
        fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif'
    },
    modalTitle: {
        fontSize: '20px',
        fontWeight: '600',
        marginBottom: '8px',
        color: '#333',
        textAlign: 'center'
    },
    modalDescription: {
        fontSize: '14px',
        color: '#666',
        marginBottom: '20px',
        lineHeight: '1.5',
        textAlign: 'center'
    },
    modalInput: {
        width: '100%',
        padding: '12px 16px',
        marginBottom: '24px',
        border: '2px solid #e0e0e0',
        borderRadius: '12px',
        fontSize: '14px',
        fontFamily: 'inherit',
        outline: 'none',
        transition: 'border-color 0.2s ease',
        boxSizing: 'border-box',
        ':focus': {
            borderColor: '#FF7043'
        }
    },
    modalButtons: {
        display: 'flex',
        gap: '12px',
        justifyContent: 'flex-end'
    },
    modalCancelButton: {
        padding: '10px 20px',
        border: '2px solid #e0e0e0',
        borderRadius: '12px',
        backgroundColor: 'transparent',
        cursor: 'pointer',
        fontSize: '14px',
        fontFamily: 'inherit',
        color: '#666',
        fontWeight: '500',
        transition: 'all 0.2s ease'
    },
    modalSaveButton: {
        padding: '10px 20px',
        border: 'none',
        borderRadius: '12px',
        backgroundColor: '#FF7043',
        cursor: 'pointer',
        fontSize: '14px',
        fontFamily: 'inherit',
        color: 'white',
        fontWeight: '600',
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 8px rgba(255, 112, 67, 0.3)'
    },
    modalSaveButtonDisabled: {
        backgroundColor: '#ccc',
        cursor: 'not-allowed',
        boxShadow: 'none'
    }
};

export default TopBar; 