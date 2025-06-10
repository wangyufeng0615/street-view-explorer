import React from 'react';
import { useTranslation } from 'react-i18next';
import '../styles/HelpButton.css';

export default function HelpButton({ onCopyEmail }) {
    const { t } = useTranslation();
    const email = "alanwang424@gmail.com";
    return (
        <div className="help-button">
            ?
            <div className="help-tooltip">
                <span className="email" onClick={onCopyEmail}>
                    {t('help.contactPrefix')}{email}
                </span>
                <a href="https://wangyufeng.org" target="_blank" rel="noopener noreferrer">
                    blog
                </a>
            </div>
        </div>
    );
} 