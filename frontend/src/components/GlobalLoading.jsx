import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/GlobalLoading.css';

export default function GlobalLoading() {
    const { t } = useTranslation();
    const [message, setMessage] = useState('');

    useEffect(() => {
        const messages = t('globalLoadingMessages');
        if (Array.isArray(messages) && messages.length > 0) {
            const randomIndex = Math.floor(Math.random() * messages.length);
            setMessage(messages[randomIndex]);
        } else {
            setMessage("Loading...");
        }
    }, [t]);

    return (
        <div className="global-loading">
            <div className="loading-content">
                <div className="loading-spinner"></div>
                <div className="loading-text">{message}</div>
            </div>
        </div>
    );
} 