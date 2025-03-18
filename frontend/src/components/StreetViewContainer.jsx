import React from 'react';
import StreetView from './StreetView';

export default function StreetViewContainer({ latitude, longitude, onPovChanged }) {
    return (
        <div className="street-view-container">
            <StreetView 
                latitude={latitude} 
                longitude={longitude} 
                onPovChanged={onPovChanged}
            />
        </div>
    );
} 