import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    strictPort: false,
    // Dev dashboard calls the sidecar through the same-origin /api prefix
    // (identical to the container launcher), so no CORS or env is needed.
    proxy: {
      '/api': {
        target: 'http://localhost:9559',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      '/stream': {
        target: 'http://localhost:9559',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          motion: ['framer-motion'],
          charts: ['recharts'],
        },
      },
    },
  },
});