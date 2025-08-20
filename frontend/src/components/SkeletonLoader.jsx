import React from 'react';
import '../styles/SkeletonLoader.css';

const SkeletonLoader = ({ type = 'default' }) => {
    if (type === 'streetview') {
        return (
            <div className="skeleton-streetview">
                <div className="skeleton-pulse skeleton-streetview-main">
                    <div className="skeleton-streetview-center">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                            <circle cx="12" cy="9" r="2.5" />
                        </svg>
                        <div className="skeleton-text">Loading Street View...</div>
                    </div>
                </div>
            </div>
        );
    }
    
    if (type === 'sidebar') {
        return (
            <div className="skeleton-sidebar">
                <div className="skeleton-pulse skeleton-map"></div>
                <div className="skeleton-content">
                    <div className="skeleton-pulse skeleton-title"></div>
                    <div className="skeleton-pulse skeleton-line"></div>
                    <div className="skeleton-pulse skeleton-line"></div>
                    <div className="skeleton-pulse skeleton-line skeleton-line-short"></div>
                </div>
            </div>
        );
    }
    
    if (type === 'description') {
        return (
            <div className="skeleton-description">
                <div className="skeleton-pulse skeleton-line"></div>
                <div className="skeleton-pulse skeleton-line"></div>
                <div className="skeleton-pulse skeleton-line skeleton-line-short"></div>
            </div>
        );
    }
    
    // Default full page skeleton
    return (
        <div className="skeleton-page">
            <div className="skeleton-header">
                <div className="skeleton-pulse skeleton-logo"></div>
                <div className="skeleton-pulse skeleton-nav"></div>
            </div>
            <div className="skeleton-main">
                <div className="skeleton-streetview">
                    <div className="skeleton-pulse skeleton-streetview-main"></div>
                </div>
                <div className="skeleton-sidebar">
                    <div className="skeleton-pulse skeleton-map"></div>
                    <div className="skeleton-content">
                        <div className="skeleton-pulse skeleton-title"></div>
                        <div className="skeleton-pulse skeleton-line"></div>
                        <div className="skeleton-pulse skeleton-line"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SkeletonLoader;