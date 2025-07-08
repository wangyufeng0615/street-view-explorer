import * as Sentry from "@sentry/react";
import React from 'react';

/**
 * Initializes Sentry for error tracking and performance monitoring.
 */
export const initSentry = () => {
  // The following block can be uncommented to disable Sentry in development
  /*
  if (process.env.NODE_ENV !== 'production') {
    console.log('Sentry is disabled in development mode.');
    return;
  }
  */

  Sentry.init({
    dsn: process.env.REACT_APP_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: `my-streetview-project@${process.env.REACT_APP_VERSION || 'unknown'}`,
    integrations: [
      // Automatically instrument React components to measure performance
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect: React.useEffect,
      }),
      // Send console.error and console.warn calls as logs to Sentry
      Sentry.consoleLoggingIntegration({ levels: ["error", "warn"] }),
    ],
    // Set tracesSampleRate to 1.0 to capture 100%
    // of transactions for performance monitoring.
    tracesSampleRate: 1.0,
    // Send default PII data to Sentry
    sendDefaultPii: true,
    // Enable experimental features for logging
    _experiments: {
      enableLogs: true,
    },
    
    // BeforeSend hook to add frontend-specific metadata
    beforeSend: function(event, hint) {
      // Add frontend metadata
      if (!event.contexts) {
        event.contexts = {};
      }
      event.contexts.app = {
        name: "streetview-frontend",
        version: process.env.REACT_APP_VERSION || 'unknown',
        type: "react-spa"
      };
      
      return event;
    },
  });

  console.log(`Sentry initialized for ${process.env.NODE_ENV} environment.`);
};

/**
 * Runs a suite of tests to confirm Sentry is capturing events correctly.
 * This function can be called from the browser console via `window.testSentry()`.
 */
export const testSentry = () => {
    console.log('Running Sentry integration test...');
    
    // Test 1: Capture a simple message
    const messageId = Sentry.captureMessage('Sentry test message: Manual trigger.', 'info');
    console.log(`Sentry message captured, ID: ${messageId}`);
    
    // Test 2: Capture an exception
    try {
        throw new Error('Sentry test error: This is a test exception from a manual trigger.');
    } catch (error) {
        const eventId = Sentry.captureException(error);
        console.log(`Sentry exception captured, ID: ${eventId}`);
    }
    
    // Test 3: Create a custom span for performance tracking
    Sentry.startSpan(
        {
            op: "test.manual.operation",
            name: "Manual Sentry Test Span",
        },
        (span) => {
            span.setAttribute("test_type", "manual_trigger");
            span.setAttribute("version", process.env.REACT_APP_VERSION || "1.0.0");
            console.log('Sentry span test completed.');
        },
    );
    
    console.log('Sentry tests finished. Check your Sentry dashboard for the events.');
}; 