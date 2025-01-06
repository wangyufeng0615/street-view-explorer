import React from 'react';
import '../styles/animations.css';

export default function GlobalLoading({ message }) {
    return (
        <div className="global-loading-overlay">
            <div className="loading-spinner" />
            <div className="loading-text">{message}</div>
        </div>
    );
} 