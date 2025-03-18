import React from 'react';

export default function ErrorDisplay({ error, onRetry }) {
    return (
        <div className="error-container">
            <h2>出错了</h2>
            <p>{error}</p>
            <button onClick={onRetry} className="retry-button">
                重试
            </button>
        </div>
    );
} 