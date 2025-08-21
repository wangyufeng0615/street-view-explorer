import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import './i18nOptimized'; // Import optimized i18n configuration
import { initErrorHandlers } from './services/sentryLazy';

// Initialize lightweight error handlers (Sentry loads on-demand)
initErrorHandlers();

const container = document.getElementById('root');
if (!container) throw new Error('Failed to find the root element');
const root = createRoot(container);
root.render(
    <React.StrictMode>
        <AppErrorBoundary>
            <Suspense fallback={<div>Loading...</div>}>
                <App />
            </Suspense>
        </AppErrorBoundary>
    </React.StrictMode>
); 