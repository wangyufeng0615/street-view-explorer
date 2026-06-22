import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { loadGoogleMapsScript } from '../utils/googleMaps';

function removeMapListener(listenerRef) {
    if (listenerRef.current) {
        listenerRef.current.remove();
        listenerRef.current = null;
    }
}

function removeMarker(markerRef) {
    if (!markerRef.current) return;

    if (typeof markerRef.current.setMap === 'function') {
        markerRef.current.setMap(null);
    } else {
        markerRef.current.map = null;
    }
    markerRef.current = null;
}

function setMarkerPosition(marker, position) {
    if (!marker) return;

    if (typeof marker.setPosition === 'function') {
        marker.setPosition(position);
        return;
    }
    marker.position = position;
}

function createLocationDot() {
    const dot = document.createElement('div');
    dot.className = 'atlas-location-dot-marker';
    return dot;
}

function PickStatusOverlay({ status, message }) {
    if (!message || status === 'idle') {
        return null;
    }

    const isError = status === 'error';
    const isSuccess = status === 'success';

    return (
        <div style={{
            position: 'absolute',
            left: '50%',
            bottom: '10px',
            transform: 'translateX(-50%)',
            maxWidth: 'calc(100% - 24px)',
            padding: '6px 10px',
            borderRadius: '999px',
            background: isError
                ? 'rgba(127, 29, 29, 0.9)'
                : isSuccess
                    ? 'rgba(20, 83, 45, 0.9)'
                    : 'rgba(15, 23, 42, 0.88)',
            color: '#fff',
            fontSize: '12px',
            lineHeight: 1.3,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            pointerEvents: 'none',
            zIndex: 2,
            boxShadow: '0 8px 20px rgba(15, 23, 42, 0.25)'
        }}>
            {message}
        </div>
    );
}

export default function GlobalMap({
    latitude,
    longitude,
    mapId = 'global',
    onLocationPick,
    isPickingLocation = false,
    pickStatus = 'idle',
    pickMessage = ''
}) {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markerInstanceRef = useRef(null);
    const mapsApiRef = useRef(null);
    const clickListenerRef = useRef(null);
    const dragEndListenerRef = useRef(null);
    const onLocationPickRef = useRef(onLocationPick);
    const isPickingLocationRef = useRef(isPickingLocation);
    const [error, setError] = useState(null);
    const { t } = useTranslation();

    useEffect(() => {
        onLocationPickRef.current = onLocationPick;
    }, [onLocationPick]);

    useEffect(() => {
        isPickingLocationRef.current = isPickingLocation;
    }, [isPickingLocation]);

    const pickFromLatLng = useCallback((latLng, inputType) => {
        const handler = onLocationPickRef.current;
        if (!handler || !latLng || isPickingLocationRef.current) return;

        const lat = latLng.lat();
        const lng = latLng.lng();
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        handler({
            lat,
            lng,
            mapId,
            inputType
        });
    }, [mapId]);

    const syncMapToPosition = useCallback(() => {
        const map = mapInstanceRef.current;
        if (!map) return;

        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        const position = { lat, lng };
        if (mapsApiRef.current?.event) {
            mapsApiRef.current.event.trigger(map, 'resize');
        }
        map.setCenter(position);
        setMarkerPosition(markerInstanceRef.current, position);
    }, [latitude, longitude]);

    // 参数验证
    if (latitude === undefined || longitude === undefined) {
        console.warn('GlobalMap: Missing coordinates', { latitude, longitude });
        return (
            <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f5f5f5',
                borderRadius: '8px',
                color: '#666'
            }}>
                {t('loading_location')}
            </div>
        );
    }

    // 使用useCallback确保initMap函数引用稳定
    const initMap = useCallback(async () => {
        if (!mapRef.current) return;
        
        try {
            const maps = await loadGoogleMapsScript();
            mapsApiRef.current = maps;
            
            // 再次检查组件是否仍然挂载且DOM元素存在
            if (!mapRef.current) return;

            // 确保坐标是数字类型
            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);

            if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
                console.error('Invalid coordinates for GlobalMap:', { latitude, longitude, lat, lng });
                throw new Error(t('error.invalidCoordinates'));
            }

            // 如果已经有地图实例，清理它
            if (mapInstanceRef.current) {
                mapInstanceRef.current = null;
            }
            removeMarker(markerInstanceRef);
            removeMapListener(clickListenerRef);
            removeMapListener(dragEndListenerRef);

            const position = { lat, lng };

            // 创建新的地图实例
            mapInstanceRef.current = new maps.Map(mapRef.current, {
                mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
                center: position,
                zoom: 3,
                mapTypeId: 'terrain',
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                zoomControl: false,
                disableDefaultUI: true,
                gestureHandling: onLocationPickRef.current ? 'greedy' : 'none',
                scrollwheel: false,
                draggableCursor: onLocationPickRef.current ? 'crosshair' : undefined,
                draggingCursor: 'grabbing'
            });

            if (onLocationPickRef.current) {
                clickListenerRef.current = mapInstanceRef.current.addListener('click', (event) => {
                    pickFromLatLng(event.latLng, 'click');
                });
                dragEndListenerRef.current = mapInstanceRef.current.addListener('dragend', () => {
                    pickFromLatLng(mapInstanceRef.current?.getCenter(), 'drag');
                });
            }

            // 创建自定义红点标记
            const dot = createLocationDot();

            // 只添加一次样式
            if (!document.querySelector('#globalmap-styles')) {
                const style = document.createElement('style');
                style.id = 'globalmap-styles';
                style.textContent = `
                    @keyframes atlasLocationPulse {
                        0% {
                            opacity: 0.65;
                            transform: scale(0.45);
                        }
                        70% {
                            opacity: 0;
                            transform: scale(1.25);
                        }
                        100% {
                            opacity: 0;
                            transform: scale(1.25);
                        }
                    }
                    .atlas-location-dot-marker {
                        position: relative;
                        width: 20px;
                        height: 20px;
                        pointer-events: none;
                        overflow: visible;
                    }
                    .atlas-location-dot-marker::before {
                        content: "";
                        position: absolute;
                        inset: 0;
                        border-radius: 999px;
                        background: rgba(255, 68, 68, 0.34);
                        animation: atlasLocationPulse 1.8s ease-out infinite;
                    }
                    .atlas-location-dot-marker::after {
                        content: "";
                        position: absolute;
                        left: 50%;
                        top: 50%;
                        width: 9px;
                        height: 9px;
                        border-radius: 999px;
                        background: #ff4444;
                        border: 2px solid #ffffff;
                        box-shadow: 0 2px 6px rgba(15, 23, 42, 0.36);
                        transform: translate(-50%, -50%);
                    }
                    .gm-style-cc { display: none; }
                    a[href^="http://maps.google.com/maps"]{display:none !important}
                    a[href^="https://maps.google.com/maps"]{display:none !important}
                    .gmnoprint a, .gmnoprint span, .gm-style-cc {
                        display:none;
                    }
                    .gmnoprint div {
                        background:none !important;
                    }
                `;
                document.head.appendChild(style);
            }

            // 创建标记点
            if (maps.marker?.AdvancedMarkerElement) {
                markerInstanceRef.current = new maps.marker.AdvancedMarkerElement({
                    map: mapInstanceRef.current,
                    position,
                    content: dot,
                    zIndex: 1000,
                    anchorLeft: '-50%',
                    anchorTop: '-50%'
                });
            } else if (maps.Marker) {
                markerInstanceRef.current = new maps.Marker({
                    map: mapInstanceRef.current,
                    position,
                    icon: {
                        path: maps.SymbolPath.CIRCLE,
                        scale: 6,
                        fillColor: '#ff4444',
                        fillOpacity: 1,
                        strokeColor: '#ffffff',
                        strokeWeight: 2
                    },
                    zIndex: 1000
                });
            }

            // 确保地图中心点和标记位置一致
            mapInstanceRef.current.setCenter(position);
            
            // 清除错误状态
            setError(null);
        } catch (err) {
            console.error('GlobalMap initialization error:', err);
            setError(t('error.mapLoadFailed'));
        }
    }, [latitude, longitude, pickFromLatLng, t]);

    useEffect(() => {
        let isMounted = true;
        
        // 延迟执行以避免React Strict Mode的重复调用
        const timeoutId = setTimeout(() => {
            if (isMounted) {
                initMap();
            }
        }, 0);

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            
            // 清理地图实例
            removeMarker(markerInstanceRef);
            removeMapListener(clickListenerRef);
            removeMapListener(dragEndListenerRef);
            if (mapInstanceRef.current) {
                mapInstanceRef.current = null;
            }
        };
    }, [initMap]);

    useEffect(() => {
        if (!mapRef.current) return undefined;

        let frameId = 0;
        const requestSync = () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            frameId = requestAnimationFrame(syncMapToPosition);
        };

        const ResizeObserverCtor = window.ResizeObserver;
        const resizeObserver = ResizeObserverCtor
            ? new ResizeObserverCtor(requestSync)
            : null;

        resizeObserver?.observe(mapRef.current);
        window.addEventListener('resize', requestSync);
        window.addEventListener('orientationchange', requestSync);
        requestSync();

        return () => {
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            resizeObserver?.disconnect();
            window.removeEventListener('resize', requestSync);
            window.removeEventListener('orientationchange', requestSync);
        };
    }, [syncMapToPosition]);

    if (error) {
        return (
            <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f5f5f5',
                borderRadius: '8px',
                color: '#666'
            }}>
                {error}
            </div>
        );
    }

    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                borderRadius: '8px',
                overflow: 'hidden'
            }}
        >
            <div
                ref={mapRef}
                style={{
                    width: '100%',
                    height: '100%',
                    cursor: isPickingLocation ? 'progress' : undefined
                }}
            />
            <PickStatusOverlay status={pickStatus} message={pickMessage} />
        </div>
    );
}
