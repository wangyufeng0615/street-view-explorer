import React from 'react';

const Toast = ({ message, visible }) => {
    if (!visible) return null;

    return (
        <div style={styles.toastContainer}>
            <div style={styles.toast}>
                {message}
            </div>
        </div>
    );
};

const styles = {
    toastContainer: {
        position: 'fixed',
        top: '70px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        pointerEvents: 'none'
    },
    toast: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        padding: '12px 20px',
        borderRadius: '8px',
        fontSize: '14px',
        fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontWeight: '500',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
        animation: 'fadeInOut 3s ease-in-out',
        whiteSpace: 'nowrap',
        backdropFilter: 'blur(8px)'
    }
};

export default Toast; 