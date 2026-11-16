import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SINGLE=1 builds one self-contained script (used for the claude.ai phone preview, where the page is inlined).
const single = !!process.env.SINGLE;

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: {
    chunkSizeWarningLimit: 2500,
    outDir: single ? 'dist-single' : 'dist',
    rollupOptions: single ? { output: { inlineDynamicImports: true } } : {},
  },
});
