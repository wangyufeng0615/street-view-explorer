import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import './i18n'; // Import i18n configuration
import { initSentry } from './services/sentry';

// Initialize Sentry
initSentry();

const container = document.getElementById('root');
if (!container) throw new Error('Failed to find the root element');
const root = createRoot(container);
root.render(
    <React.StrictMode>
        <Suspense fallback="Loading..."> {/* Add Suspense for loading translations */}
            <App />
        </Suspense>
    </React.StrictMode>
); 