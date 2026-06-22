import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import viteTsconfigPaths from 'vite-tsconfig-paths';
import svgr from 'vite-plugin-svgr';
import path from 'path';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      // Add React refresh
      fastRefresh: true,
      // Support JSX in .js files
      include: "**/*.{jsx,tsx,js,ts}",
    }),
    viteTsconfigPaths(),
    svgr(),
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
    sourcemap: true,
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
          i18n: ['i18next', 'react-i18next', 'i18next-browser-languagedetector', 'i18next-http-backend'],
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
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@styles': path.resolve(__dirname, './src/styles'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@store': path.resolve(__dirname, './src/store'),
    },
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
  },
  
  // CSS configuration
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
  
  // Define global constants
  define: {
    'process.env': {},
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
