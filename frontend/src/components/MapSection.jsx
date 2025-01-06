import React, { memo } from 'react';
import GlobalMap from './GlobalMap';
import PreviewMap from './PreviewMap';

const MapSection = memo(function MapSection({ latitude, longitude, heading }) {
    return (
        <div style={{ marginBottom: '8px' }}>
            <GlobalMap latitude={latitude} longitude={longitude} />
            <PreviewMap 
                latitude={latitude} 
                longitude={longitude} 
                heading={heading}
            />
        </div>
    );
}, (prevProps, nextProps) => {
    return (
        prevProps.latitude === nextProps.latitude &&
        prevProps.longitude === nextProps.longitude &&
        prevProps.heading === nextProps.heading
    );
});

export default MapSection; 