import React, { useState, useEffect } from 'react';
import { setExplorationPreference, deleteExplorationPreference } from '../services/api';

const styles = {
    container: {
        marginBottom: '20px',
        padding: '15px',
        backgroundColor: 'rgba(240, 242, 245, 0.8)',
        borderRadius: '10px',
        border: '1px solid rgba(0, 0, 0, 0.05)'
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '10px'
    },
    switch: {
        position: 'relative',
        display: 'inline-block',
        width: '50px',
        height: '24px'
    },
    switchInput: {
        opacity: 0,
        width: 0,
        height: 0
    },
    switchSlider: {
        position: 'absolute',
        cursor: 'pointer',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#ccc',
        transition: '.4s',
        borderRadius: '24px'
    },
    switchSliderChecked: {
        backgroundColor: '#4CAF50'
    },
    switchKnob: {
        position: 'absolute',
        content: '""',
        height: '16px',
        width: '16px',
        left: '4px',
        bottom: '4px',
        backgroundColor: 'white',
        transition: '.4s',
        borderRadius: '50%'
    },
    switchKnobChecked: {
        transform: 'translateX(26px)'
    },
    input: {
        width: 'calc(100% - 16px)',
        padding: '8px',
        marginTop: '10px',
        borderRadius: '5px',
        border: '1px solid #ddd',
        fontSize: '14px',
        boxSizing: 'border-box',
        maxWidth: '100%'
    },
    hint: {
        fontSize: '12px',
        color: '#666',
        marginTop: '5px'
    },
    error: {
        fontSize: '12px',
        color: '#ff4d4f',
        marginTop: '5px'
    },
    saveButton: {
        padding: '8px 16px',
        fontSize: '14px',
        backgroundColor: '#4CAF50',
        color: 'white',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        marginTop: '10px',
        width: '100%',
        transition: 'all 0.3s ease',
        position: 'relative',
        overflow: 'hidden'
    },
    saveButtonDisabled: {
        backgroundColor: '#f5f5f5',
        color: '#bbb',
        cursor: 'not-allowed',
        border: '1px solid #ddd'
    },
    saveButtonSuccess: {
        backgroundColor: '#52c41a',
        boxShadow: '0 2px 8px rgba(82, 196, 26, 0.3)'
    },
    saveButtonLoading: {
        backgroundColor: '#40a9ff',
        cursor: 'wait'
    },
    successIcon: {
        position: 'absolute',
        right: '10px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        backgroundColor: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        color: '#52c41a'
    }
};

export default function ExplorationPreference() {
    const [enabled, setEnabled] = useState(false);
    const [interest, setInterest] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isDirty, setIsDirty] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const MAX_INTEREST_LENGTH = 50;

    // 加载保存的探索兴趣
    useEffect(() => {
        const savedInterest = localStorage.getItem('explorationInterest');
        const isEnabled = localStorage.getItem('explorationEnabled') === 'true';
        if (savedInterest && isEnabled) {
            setInterest(savedInterest);
            setEnabled(true);
        }
    }, []);

    const handleToggle = async (e) => {
        const newEnabled = e.target.checked;
        setEnabled(newEnabled);
        
        if (!newEnabled) {
            try {
                setIsLoading(true);
                const result = await deleteExplorationPreference();
                if (!result.success) {
                    setError(result.error || '删除探索偏好失败');
                    setEnabled(true);
                } else {
                    localStorage.removeItem('explorationInterest');
                    localStorage.removeItem('explorationEnabled');
                    setInterest('');
                }
            } catch (err) {
                setError('网络请求失败');
                setEnabled(true);
            } finally {
                setIsLoading(false);
            }
        }
    };

    const handleInterestChange = (e) => {
        const value = e.target.value;
        if (value.length <= MAX_INTEREST_LENGTH) {
            setInterest(value);
            setError(null);
            setIsDirty(true);
        }
    };

    const handleInterestSubmit = async () => {
        const trimmedInterest = interest.trim();
        
        if (!trimmedInterest) {
            setError('请输入探索兴趣');
            return;
        }
        
        if (trimmedInterest.length < 2) {
            setError('探索兴趣太短，请至少输入2个字符');
            return;
        }

        if (trimmedInterest.length > MAX_INTEREST_LENGTH) {
            setError(`探索兴趣太长，请不要超过${MAX_INTEREST_LENGTH}个字符`);
            return;
        }

        try {
            setIsLoading(true);
            const result = await setExplorationPreference(trimmedInterest);
            if (!result.success) {
                setError(result.error);
            } else {
                localStorage.setItem('explorationInterest', trimmedInterest);
                localStorage.setItem('explorationEnabled', 'true');
                setIsDirty(false);
                setError(null);
                setSaveSuccess(true);
                
                // 显示成功状态 1 秒后刷新页面
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        } catch (err) {
            setError('网络请求失败');
            setEnabled(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !isLoading) {
            e.preventDefault(); // 防止表单提交
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <span>指定探索兴趣</span>
                <label style={styles.switch}>
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={handleToggle}
                        disabled={isLoading}
                        style={styles.switchInput}
                    />
                    <span style={{
                        ...styles.switchSlider,
                        ...(enabled ? styles.switchSliderChecked : {})
                    }}>
                        <span style={{
                            ...styles.switchKnob,
                            ...(enabled ? styles.switchKnobChecked : {})
                        }} />
                    </span>
                </label>
            </div>

            {enabled && (
                <>
                    <input
                        type="text"
                        value={interest}
                        onChange={handleInterestChange}
                        onKeyPress={handleKeyPress}
                        placeholder="输入地点或主题"
                        disabled={isLoading}
                        style={styles.input}
                        maxLength={MAX_INTEREST_LENGTH}
                    />
                    <div style={styles.hint}>
                        您可以输入地点（如：日本传统建筑、欧洲古堡）或主题（如：火山、沼泽、古寺庙、热带雨林、极地风光）
                    </div>
                    {error && (
                        <div style={styles.error}>
                            {error}
                        </div>
                    )}
                    <button
                        onClick={handleInterestSubmit}
                        disabled={isLoading || !isDirty || !interest.trim()}
                        style={{
                            ...styles.saveButton,
                            ...(isLoading ? styles.saveButtonLoading : {}),
                            ...(saveSuccess ? styles.saveButtonSuccess : {}),
                            ...(!isDirty || !interest.trim() ? styles.saveButtonDisabled : {})
                        }}
                    >
                        {isLoading ? '保存中...' : (saveSuccess ? '保存成功' : '保存')}
                        {saveSuccess && (
                            <span style={styles.successIcon}>✓</span>
                        )}
                    </button>
                </>
            )}
        </div>
    );
} 