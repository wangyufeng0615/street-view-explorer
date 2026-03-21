import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { loadBaiduMapsScript } from '../utils/baiduMaps';

export default function BaiduPreviewMap({ latitude, longitude }) {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markerRef = useRef(null);
    const [error, setError] = useState(null);
    const { t } = useTranslation();

    const initMap = useCallback(async () => {
        if (!mapRef.current) return;
        try {
            const BMapGL = await loadBaiduMapsScript();
            if (!mapRef.current) return;

            if (mapInstanceRef.current) {
                mapInstanceRef.current = null;
            }

            const map = new BMapGL.Map(mapRef.current);
            const point = new BMapGL.Point(longitude, latitude);
            map.centerAndZoom(point, 15);
            map.enableScrollWheelZoom();

            // Add zoom control
            const zoomCtrl = new BMapGL.ZoomControl({
                anchor: window.BMAP_ANCHOR_TOP_RIGHT,
            });
            map.addControl(zoomCtrl);

            // Add pin marker using SVG
            const pinDiv = document.createElement('div');
            pinDiv.innerHTML = `
                <svg width="32" height="32" viewBox="0 0 32 32" style="position: absolute; left: -16px; top: -32px;">
                    <path d="M16 0C10.477 0 6 4.477 6 10c0 7 10 22 10 22s10-15 10-22c0-5.523-4.477-10-10-10zm0 14a4 4 0 110-8 4 4 0 010 8z"
                          fill="#FF4444"
                          stroke="#FFFFFF"
                          stroke-width="1.5"/>
                </svg>
            `;
            pinDiv.style.position = 'relative';
            pinDiv.style.width = '0';
            pinDiv.style.height = '0';

            // Custom overlay for pin
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

            const pinOverlay = new CustomOverlay(point, pinDiv);
            map.addOverlay(pinOverlay);
            markerRef.current = pinOverlay;

            mapInstanceRef.current = map;
            setError(null);
        } catch (err) {
            console.error('BaiduPreviewMap initialization error:', err);
            setError(t('error.mapLoadFailed'));
        }
    }, [latitude, longitude, t]);

    useEffect(() => {
        let isMounted = true;
        const timeoutId = setTimeout(() => {
            if (isMounted) initMap();
        }, 100);
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
