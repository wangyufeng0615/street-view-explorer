import React, { useEffect } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { getOrCreateSessionId } from './utils/session';

// Create router with future flags enabled
const router = {
    future: {
        v7_startTransition: true,
        v7_relativeSplatPath: true
    }
};

function App() {
    useEffect(() => {
        // 确保有会话ID
        getOrCreateSessionId();
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