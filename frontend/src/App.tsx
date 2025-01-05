import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import HomePage from './pages/HomePage';

// Create router with future flags enabled
const router = {
    future: {
        v7_startTransition: true,
        v7_relativeSplatPath: true
    }
};

const App: React.FC = () => {
    return (
        <Router {...router}>
            <div style={{ 
                width: '100vw', 
                height: '100vh', 
                margin: 0, 
                padding: 0, 
                overflow: 'hidden' 
            }}>
                <HomePage />
            </div>
        </Router>
    );
}

export default App; 