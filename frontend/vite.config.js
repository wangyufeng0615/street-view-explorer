import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      // Support JSX in .js files
      include: "**/*.{jsx,tsx,js,ts}",
    }),
  ],
  
  // Server configuration
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_DEV_PORT || 3100),
    strictPort: true,
    open: true,
    // Proxy API requests to backend
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  
  // Build configuration
  build: {
    outDir: 'build',
    // Keep production source code out of the public static bundle.
    sourcemap: false,
    // Enable module preload polyfill for older browsers
    modulePreload: {
      polyfill: true,
    },
    // Rollup options
    rollupOptions: {
      output: {
        // Manual chunks for better caching
        // Note: sentry is excluded to enable true lazy loading via dynamic import
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          zustand: ['zustand'],
        },
      },
    },
    // Set chunk size warning limit
    chunkSizeWarningLimit: 1000,
    // Minify options for smaller bundle
    minify: 'esbuild',
    // Target modern browsers for smaller output
    target: 'es2020',
  },
  
  // Resolve configuration
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
  },
  
  // Optimizations
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'i18next',
      'react-i18next',
      'zustand',
    ],
    // Exclude sentry to enable true lazy loading
    exclude: ['@sentry/react'],
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
        '.jsx': 'jsx',
        '.ts': 'tsx',
        '.tsx': 'tsx',
      },
    },
  },
  
  // Environment variable prefix
  envPrefix: 'VITE_',

  // Test configuration
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
  },
});
