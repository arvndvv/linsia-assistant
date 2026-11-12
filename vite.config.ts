import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Only used by "npm run dev". Matches the server's development port in server/src/config.ts.
const api = `http://127.0.0.1:${process.env.DEV_PORT ?? 8788}`;

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': api, '/files': api },
  },
});
