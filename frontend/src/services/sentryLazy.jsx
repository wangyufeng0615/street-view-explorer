/**
 * Lazy-loaded Sentry integration
 * Only loads Sentry when an error occurs to reduce initial bundle size
 */

let sentryLoaded = false;
let sentryLoadPromise = null;
let errorQueue = [];
let Sentry = null;

const sensitiveParamRegex = /(\b(?:key|api[_-]?key|apikey|token|access[_-]?token|secret|client[_-]?secret|password|dsn|authorization|app[_-]?id|appid|access[_-]?key)=)([^&\s"'<>]+)/gi;
const sensitiveAuthorizationRegex = /(authorization[:=]\s*(?:bearer\s+)?)([^&\s"'<>]+)/gi;

function getTracesSampleRate() {
  const raw = import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE;
  if (raw !== undefined && raw !== '') {
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return import.meta.env.PROD ? 0.1 : 1.0;
}

function isSensitiveKey(key) {
  const normalized = String(key).toLowerCase().replace(/[-\s]/g, '_');
  return ['authorization', 'cookie', 'key', 'password', 'secret', 'session', 'token', 'dsn']
    .some((part) => normalized.includes(part));
}

function redactSensitiveString(value) {
  if (typeof value !== 'string' || value === '') {
    return value;
  }

  let redacted = value.replace(sensitiveAuthorizationRegex, '$1[redacted]');
  redacted = redacted.replace(sensitiveParamRegex, '$1[redacted]');
  [
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    import.meta.env.VITE_SENTRY_DSN,
  ].forEach((secret) => {
    if (secret && secret.length >= 6) {
      redacted = redacted.split(secret).join('[redacted]');
    }
  });
  return redacted;
}

function redactSensitiveValue(value) {
  if (typeof value === 'string') {
    return redactSensitiveString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactSensitiveValue);
  }
  if (value && typeof value === 'object') {
    const redacted = {};
    Object.entries(value).forEach(([key, item]) => {
      redacted[key] = isSensitiveKey(key) ? '[redacted]' : redactSensitiveValue(item);
    });
    return redacted;
  }
  return value;
}

// Store configuration
const sentryConfig = {
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
  release: `my-streetview-project@${import.meta.env.VITE_VERSION || 'unknown'}`,
  tracesSampleRate: getTracesSampleRate(),
  sendDefaultPii: false,
  _experiments: {
    enableLogs: true,
  },
};

/**
 * Load Sentry dynamically
 */
async function loadSentry() {
  if (sentryLoaded) {
    return Sentry;
  }

  if (sentryLoadPromise) {
    return sentryLoadPromise;
  }

  sentryLoadPromise = import('@sentry/react').then((SentryModule) => {
    Sentry = SentryModule;
    
    // Initialize Sentry with stored config
    Sentry.init({
      ...sentryConfig,
      integrations: [
        // Console logging integration
        Sentry.consoleLoggingIntegration({ levels: ["error", "warn"] }),
      ],
      beforeSend: function(event) {
        const sanitizedEvent = redactSensitiveValue(event);
        // Add frontend metadata
        if (!sanitizedEvent.contexts) {
          sanitizedEvent.contexts = {};
        }
        sanitizedEvent.contexts.app = {
          name: "streetview-frontend",
          version: import.meta.env.VITE_VERSION || 'unknown',
          type: "react-spa"
        };
        
        return sanitizedEvent;
      },
    });

    sentryLoaded = true;

    // Process queued errors
    if (errorQueue.length > 0) {
      console.log(`Processing ${errorQueue.length} queued errors for Sentry`);
      errorQueue.forEach(({ type, data }) => {
        if (type === 'exception') {
          Sentry.captureException(data.error, data.context);
        } else if (type === 'message') {
          Sentry.captureMessage(data.message, data.level);
        }
      });
      errorQueue = [];
    }

    return Sentry;
  }).catch((error) => {
    console.error('Failed to load Sentry:', error);
    sentryLoadPromise = null;
    throw error;
  });

  return sentryLoadPromise;
}

/**
 * Capture an exception
 */
export async function captureException(error, context) {
  // Skip in development unless explicitly enabled
  if (import.meta.env.DEV && !import.meta.env.VITE_SENTRY_DSN) {
    console.error('Error captured (Sentry disabled in dev):', error);
    return null;
  }

  if (!sentryLoaded) {
    // Queue the error
    errorQueue.push({ type: 'exception', data: { error, context } });
    
    // Start loading Sentry
    try {
      const loadedSentry = await loadSentry();
      return loadedSentry.captureException(error, context);
    } catch (loadError) {
      console.error('Failed to load Sentry for error reporting:', loadError);
      return null;
    }
  }

  return Sentry.captureException(error, context);
}

/**
 * Capture a message
 */
export async function captureMessage(message, level = 'info') {
  // Skip in development unless explicitly enabled
  if (import.meta.env.DEV && !import.meta.env.VITE_SENTRY_DSN) {
    console.log('Message captured (Sentry disabled in dev):', message);
    return null;
  }

  if (!sentryLoaded) {
    // Queue the message
    errorQueue.push({ type: 'message', data: { message, level } });
    
    // Start loading Sentry
    try {
      const loadedSentry = await loadSentry();
      return loadedSentry.captureMessage(message, level);
    } catch (loadError) {
      console.error('Failed to load Sentry for message reporting:', loadError);
      return null;
    }
  }

  return Sentry.captureMessage(message, level);
}

/**
 * Create an error boundary component
 */
export function withErrorBoundary(Component, fallback) {
  return class ErrorBoundaryWrapper extends React.Component {
    constructor(props) {
      super(props);
      this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
      return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
      // Capture exception asynchronously
      captureException(error, { errorInfo });
    }

    render() {
      if (this.state.hasError) {
        if (fallback) {
          return fallback(this.state.error);
        }
        return (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <h2>Something went wrong</h2>
            <p>The error has been reported. Please refresh the page.</p>
          </div>
        );
      }

      return <Component {...this.props} />;
    }
  };
}

/**
 * Test Sentry integration
 */
export async function testSentry() {
  console.log('Running Sentry lazy load test...');
  
  // This will trigger Sentry to load
  await captureMessage('Sentry lazy load test: Manual trigger', 'info');
  
  try {
    throw new Error('Sentry lazy load test: Test exception');
  } catch (error) {
    await captureException(error);
  }
  
  console.log('Sentry test completed. Check your dashboard for events.');
}

/**
 * Initialize error handlers (lightweight, no Sentry loading)
 */
export function initErrorHandlers() {
  // Global error handler
  window.addEventListener('error', (event) => {
    captureException(event.error || new Error(event.message), {
      source: 'window.onerror',
      lineno: event.lineno,
      colno: event.colno,
      filename: event.filename,
    });
  });

  // Unhandled promise rejection handler
  window.addEventListener('unhandledrejection', (event) => {
    captureException(new Error(event.reason || 'Unhandled Promise Rejection'), {
      source: 'unhandledrejection',
      promise: event.promise,
    });
  });
}

// React import for error boundary
import React from 'react';
