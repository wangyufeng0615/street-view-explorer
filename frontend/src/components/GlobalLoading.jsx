import React, { useState, useEffect } from 'react';
import { globalLoadingMessages } from '../constants/loadingMessages';
import '../styles/GlobalLoading.css';

export default function GlobalLoading() {
    const [message, setMessage] = useState('');

    useEffect(() => {
        // 随机选择一条加载文案
        const randomIndex = Math.floor(Math.random() * globalLoadingMessages.length);
        setMessage(globalLoadingMessages[randomIndex]);
    }, []);

    return (
        <div className="global-loading">
            <div className="loading-content">
                <div className="loading-spinner"></div>
                <div className="loading-text">{message}</div>
            </div>
        </div>
    );
} 