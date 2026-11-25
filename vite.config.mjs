import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'web', plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, assetsDir: 'static', sourcemap: false },
  server: { host: '127.0.0.1', port: 5173, proxy: { '/formal/api':'http://127.0.0.1:4181', '/demo/api':'http://127.0.0.1:4181', '/api': 'http://127.0.0.1:4181', '/assets/brand': 'http://127.0.0.1:4181', '/fonts': 'http://127.0.0.1:4181' } }
});
