/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_SENTRY_DSN: string;
  readonly VITE_SENTRY_ENVIRONMENT: string;
  // Support for legacy REACT_APP_ prefix
  readonly REACT_APP_GOOGLE_MAPS_API_KEY: string;
  readonly REACT_APP_API_BASE_URL: string;
  readonly REACT_APP_SENTRY_DSN: string;
  readonly REACT_APP_SENTRY_ENVIRONMENT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
