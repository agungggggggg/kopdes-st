import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api ke backend Express (port 3000) selama development.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
