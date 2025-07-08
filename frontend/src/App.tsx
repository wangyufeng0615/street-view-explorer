import React, { useEffect } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { getOrCreateSessionId } from './utils/session';
import { testSentry } from './services/sentry';

// Create router with future flags enabled
const router = {
    future: {
        v7_startTransition: true,
        v7_relativeSplatPath: true
    }
};

// Make testSentry function available globally for manual testing
declare global {
    interface Window {
        testSentry: () => void;
    }
}

function App() {
    useEffect(() => {
        // 确保有会话ID
        getOrCreateSessionId();
        
        // Make testSentry available globally for manual testing
        window.testSentry = testSentry;
        
        console.log('🔍 Sentry integration loaded! You can test manually by running: window.testSentry()');
    }, []);

    return (
        <Router {...router}>
            <div style={{ 
                width: '100vw', 
                height: '100vh', 
                margin: 0, 
                padding: 0, 
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <HomePage />
            </div>
        </Router>
    );
}

export default App; 