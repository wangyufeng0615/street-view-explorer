import React from 'react';
import '../styles/HelpButton.css';

export default function HelpButton({ onCopyEmail }) {
    return (
        <div className="help-button">
            ?
            <div className="help-tooltip">
                <span className="email" onClick={onCopyEmail}>
                    如有任何需求或建议：alanwang424@gmail.com
                </span>
                <a href="https://wangyufeng.org" target="_blank" rel="noopener noreferrer">
                    blog
                </a>
            </div>
        </div>
    );
} 