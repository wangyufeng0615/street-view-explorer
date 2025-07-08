import React, { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import GlobalMap from './GlobalMap';
import PreviewMap from './PreviewMap';

const MapSection = memo(function MapSection({ latitude, longitude, heading }) {
    const { i18n } = useTranslation();
    const [renderKey, setRenderKey] = useState(0);
    
    // Force remount when language changes
    useEffect(() => {
        setRenderKey(prev => prev + 1);
    }, [i18n.language]);

    // Force entire section to remount when language changes
    return (
        <div 
            style={{ marginBottom: '8px' }}
            key={`mapsection-wrapper-${i18n.language}-${renderKey}`}
        >
            <GlobalMap 
                key={`globalmap-${i18n.language}-${renderKey}`}
                latitude={latitude} 
                longitude={longitude} 
            />
            <PreviewMap 
                key={`previewmap-${i18n.language}-${renderKey}`}
                latitude={latitude} 
                longitude={longitude} 
                heading={heading}
            />
        </div>
    );
}, (prevProps, nextProps) => {
    // Only skip rendering if ALL of these are true:
    // 1. Coordinates are identical
    // 2. Heading is identical 
    // 3. We're not in the middle of a language change (which is handled by the hooks inside)
    return (
        prevProps.latitude === nextProps.latitude &&
        prevProps.longitude === nextProps.longitude &&
        prevProps.heading === nextProps.heading
        // We intentionally don't check for language here because we handle that with useEffect
    );
});

export default MapSection; 