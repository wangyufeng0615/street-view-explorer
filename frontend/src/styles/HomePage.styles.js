// 添加全局字体变量
const globalFontFamily = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 2,
    pointerEvents: 'none'
};

export const sidebarWrapperStyle = {
    position: 'fixed',
    top: '20px',
    right: '20px',
    bottom: '20px',
    width: '340px',
    pointerEvents: 'none',
    display: 'flex',
    overflow: 'visible'
};

export const sidebarStyle = {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: '12px',
    borderRadius: '16px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    transformOrigin: 'top right',
    pointerEvents: 'auto',
    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    overflow: 'visible'
};

export const sidebarContentStyle = {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    transformOrigin: 'top right'
};

export const buttonStyle = {
    padding: '8px 16px',
    fontSize: '14px',
    backgroundColor: '#FF7043',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    width: '100%',
    fontFamily: globalFontFamily,
    fontWeight: '500',
    transition: 'background-color 0.2s ease',
    boxShadow: '0 2px 8px rgba(255, 112, 67, 0.2)',
    ':hover': {
        backgroundColor: '#FF8A65'
    }
};

export const disabledButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#E0E0E0',
    cursor: 'not-allowed',
    boxShadow: 'none'
};

export const aiDescriptionStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: '12px',
    borderRadius: '12px',
    marginBottom: '8px',
    position: 'relative',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.05)',
    fontFamily: globalFontFamily,
    fontSize: '13px',
    lineHeight: '1.5',
    letterSpacing: '0.3px',
    color: '#2c3e50',
    fontWeight: '400'
};

export const aiIconStyle = {
    position: 'absolute',
    top: '-12px',
    left: '16px',
    backgroundColor: '#1a73e8',
    color: 'white',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: globalFontFamily,
    boxShadow: '0 2px 8px rgba(26, 115, 232, 0.2)',
    letterSpacing: '0.3px',
    border: '1px solid rgba(255, 255, 255, 0.2)'
};

export const addressStyle = {
    fontSize: '13px',
    color: '#555',
    marginBottom: '8px',
    lineHeight: '1.4',
    padding: '6px 10px',
    backgroundColor: 'rgba(240, 242, 245, 0.6)',
    borderRadius: '8px',
    border: '1px solid rgba(0, 0, 0, 0.05)',
    fontFamily: globalFontFamily
};

export const loadingStyles = {
    loadingContainer: {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '30px',
        borderRadius: '15px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        zIndex: 1000,
        fontFamily: globalFontFamily
    },
    loadingSpinner: {
        width: '40px',
        height: '40px',
        border: '3px solid #f3f3f3',
        borderTop: '3px solid #3498db',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        marginBottom: '15px'
    },
    loadingText: {
        fontSize: '16px',
        color: '#333',
        fontWeight: '500',
        textAlign: 'center',
        animation: 'fadeInOut 2s ease-in-out infinite',
        fontFamily: globalFontFamily
    },
    subText: {
        fontSize: '14px',
        color: '#666',
        marginTop: '8px',
        textAlign: 'center',
        fontFamily: globalFontFamily
    }
};

export const aiLoadingStyle = {
    container: {
        margin: '10px 0 0 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
        fontFamily: globalFontFamily
    },
    thinkingRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
    },
    dotsContainer: {
        display: 'flex',
        gap: '4px',
        alignItems: 'center'
    },
    dot: {
        width: '4px',
        height: '4px',
        backgroundColor: '#3498db',
        borderRadius: '50%',
        animation: 'pulse 1s ease-in-out infinite'
    },
    message: {
        fontSize: '14px',
        color: '#666',
        animation: 'fadeInOut 2s ease-in-out infinite',
        fontFamily: globalFontFamily
    }
};

// 添加关键帧动画
export const keyframes = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    @keyframes fadeInOut {
        0% { opacity: 0.6; }
        50% { opacity: 1; }
        100% { opacity: 0.6; }
    }
    @keyframes pulse {
        0%, 100% { transform: scale(0.8); opacity: 0.5; }
        50% { transform: scale(1.2); opacity: 1; }
    }
`; 