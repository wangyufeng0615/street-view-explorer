import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { getOrCreateSessionId } from './utils/session';
import { testSentry } from './services/sentryLazy';

const AgentPage = lazy(() => import('./pages/AgentPage'));
const LetterPage = lazy(() => import('./pages/LetterPage'));

// Create router with future flags enabled
const router = {
    future: {
        v7_startTransition: true,
        v7_relativeSplatPath: true
    }
};

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
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/agent" element={
                        <Suspense fallback={
                            <div style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: '#0a0a0f',
                                color: '#d1d5db',
                                fontSize: '14px'
                            }}>
                                Loading agent journey...
                            </div>
                        }>
                            <AgentPage />
                        </Suspense>
                    } />
                    <Route path="/agent/letter/:id" element={
                        <Suspense fallback={null}>
                            <LetterPage />
                        </Suspense>
                    } />
                </Routes>
            </div>
        </Router>
    );
}

export default App;
