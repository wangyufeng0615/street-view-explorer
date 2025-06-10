import React from 'react';
import { useTranslation } from 'react-i18next';

export default function ErrorDisplay({ error, onRetry }) {
    const { t } = useTranslation();
    return (
        <div className="error-container">
            <h2>{t('error.somethingWentWrong')}</h2>
            <p>{error}</p>
            <button onClick={onRetry} className="retry-button">
                {t('common.retry')}
            </button>
        </div>
    );
} 