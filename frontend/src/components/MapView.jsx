import React, { useEffect, useRef, useState } from 'react';

export default function MapView({ locations }) {
    const ref = useRef(null);
    const [error, setError] = useState(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (!window.google) {
            setError('Google Maps API未加载');
            return;
        }

        try {
            const map = new window.google.maps.Map(ref.current, {
                center: { lat: 0, lng: 0 },
                zoom: 2,
                minZoom: 2, // 限制最小缩放级别
                maxZoom: 18,
                mapTypeControl: true,
                fullscreenControl: true,
            });

            // 清除旧的标记
            const markers = [];
            locations.forEach(loc => {
                const marker = new window.google.maps.Marker({
                    position: { lat: loc.latitude, lng: loc.longitude },
                    map: map,
                    title: `点赞数: ${loc.likes}`
                });
                markers.push(marker);
            });

            setIsLoaded(true);
        } catch (err) {
            setError('地图加载失败');
            console.error(err);
        }
    }, [locations]);

    if (error) {
        return <div style={{ width: '600px', height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            错误: {error}
        </div>;
    }

    if (!isLoaded) {
        return <div style={{ width: '600px', height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            加载中...
        </div>;
    }

    return <div style={{ width: '600px', height: '400px' }} ref={ref}></div>;
}
