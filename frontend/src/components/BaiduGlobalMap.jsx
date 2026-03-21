import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { loadBaiduMapsScript } from '../utils/baiduMaps';

export default function BaiduGlobalMap({ latitude, longitude }) {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markerRef = useRef(null);
    const [error, setError] = useState(null);
    const { t } = useTranslation();

    if (latitude === undefined || longitude === undefined) {
        return (
            <div style={{
                width: '100%', height: '100%', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#f5f5f5', borderRadius: '8px',
                color: '#666', minHeight: '200px'
            }}>
                {t('loading_location')}
            </div>
        );
    }

    const initMap = useCallback(async () => {
        if (!mapRef.current) return;
        try {
            const BMapGL = await loadBaiduMapsScript();
            if (!mapRef.current) return;

            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);
            if (isNaN(lat) || isNaN(lng)) {
                throw new Error(t('error.invalidCoordinates'));
            }

            // Clean previous instance
            if (mapInstanceRef.current) {
                mapInstanceRef.current = null;
            }

            const map = new BMapGL.Map(mapRef.current, {
                enableMapClick: false,
            });

            // Note: Baidu Maps uses BD09 coordinates
            // Our coordinates are WGS84, but for display purposes the offset is acceptable
            const point = new BMapGL.Point(lng, lat);
            map.centerAndZoom(point, 5);
            map.disableDragging();
            map.disableScrollWheelZoom();
            map.disableDoubleClickZoom();
            map.disablePinchToZoom();

            // Create pulsing dot marker
            const dot = document.createElement('div');
            dot.style.width = '8px';
            dot.style.height = '8px';
            dot.style.borderRadius = '50%';
            dot.style.backgroundColor = '#FF4444';
            dot.style.border = '2px solid #FFFFFF';
            dot.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
            dot.style.animation = 'pulse 2s infinite';
            dot.style.transform = 'translate(-50%, -50%)';

            // Add pulse animation style if not exists
            if (!document.querySelector('#baidumap-pulse-styles')) {
                const style = document.createElement('style');
                style.id = 'baidumap-pulse-styles';
                style.textContent = `
                    @keyframes pulse {
                        0% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4); }
                        70% { box-shadow: 0 0 0 6px rgba(255, 68, 68, 0); }
                        100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0); }
                    }
                `;
                document.head.appendChild(style);
            }

            // Custom overlay for the pulsing dot
            const CustomOverlay = function(point, content) {
                this._point = point;
                this._content = content;
            };
            CustomOverlay.prototype = new BMapGL.Overlay();
            CustomOverlay.prototype.initialize = function(map) {
                this._map = map;
                const div = document.createElement('div');
                div.style.position = 'absolute';
                div.style.zIndex = '1000';
                div.appendChild(this._content);
                map.getPanes().markerPane.appendChild(div);
                this._div = div;
                return div;
            };
            CustomOverlay.prototype.draw = function() {
                const pixel = this._map.pointToOverlayPixel(this._point);
                this._div.style.left = pixel.x + 'px';
                this._div.style.top = pixel.y + 'px';
            };

            const customMarker = new CustomOverlay(point, dot);
            map.addOverlay(customMarker);
            markerRef.current = customMarker;

            mapInstanceRef.current = map;
            setError(null);
        } catch (err) {
            console.error('BaiduGlobalMap initialization error:', err);
            setError(t('error.mapLoadFailed'));
        }
    }, [latitude, longitude, t]);

    useEffect(() => {
        let isMounted = true;
        const timeoutId = setTimeout(() => {
            if (isMounted) initMap();
        }, 0);
        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            if (mapInstanceRef.current) {
                mapInstanceRef.current = null;
            }
            markerRef.current = null;
        };
    }, [initMap]);

    if (error) {
        return (
            <div style={{
                width: '100%', height: '100%', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#f5f5f5', borderRadius: '8px',
                color: '#666', minHeight: '200px'
            }}>
                {error}
            </div>
        );
    }

    return (
        <div ref={mapRef} style={{
            width: '100%', height: '100%',
            borderRadius: '8px', overflow: 'hidden', minHeight: '200px'
        }} />
    );
}
