import React from 'react';
import { captureException } from '../services/sentryLazy';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      errorInfo: null,
      isReporting: false,
      reportComplete: false
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error caught by boundary:', error, errorInfo);
    }

    // Report to Sentry asynchronously
    this.setState({ isReporting: true, errorInfo });
    
    captureException(error, { 
      errorInfo,
      componentStack: errorInfo.componentStack 
    }).then(() => {
      this.setState({ isReporting: false, reportComplete: true });
    }).catch((reportError) => {
      console.error('Failed to report error:', reportError);
      this.setState({ isReporting: false });
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.content}>
            <div style={styles.icon}>⚠️</div>
            <h1 style={styles.title}>Something went wrong</h1>
            <p style={styles.message}>
              We encountered an unexpected error. 
              {this.state.reportComplete && ' The error has been reported.'}
              {this.state.isReporting && ' Reporting error...'}
            </p>
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details style={styles.details}>
                <summary style={styles.summary}>Error Details (Dev Only)</summary>
                <pre style={styles.errorText}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}

            <button 
              style={styles.button}
              onClick={this.handleReload}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  content: {
    textAlign: 'center',
    padding: '40px',
    maxWidth: '500px',
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
  },
  icon: {
    fontSize: '64px',
    marginBottom: '20px'
  },
  title: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '16px'
  },
  message: {
    fontSize: '16px',
    color: '#666',
    lineHeight: '1.5',
    marginBottom: '32px'
  },
  button: {
    backgroundColor: '#4285F4',
    color: 'white',
    border: 'none',
    padding: '12px 32px',
    fontSize: '16px',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },
  details: {
    marginTop: '20px',
    marginBottom: '20px',
    textAlign: 'left',
    backgroundColor: '#f8f8f8',
    padding: '12px',
    borderRadius: '6px',
    border: '1px solid #e0e0e0'
  },
  summary: {
    cursor: 'pointer',
    fontWeight: '500',
    color: '#666',
    marginBottom: '8px'
  },
  errorText: {
    fontSize: '12px',
    color: '#d32f2f',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: '8px 0 0 0'
  }
};

export default AppErrorBoundary;