import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/discobot/',
  plugins: [react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@discobot/engine': path.resolve(__dirname, '../engine/src'),
    },
  },
});
