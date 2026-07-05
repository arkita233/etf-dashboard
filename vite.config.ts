import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path: use relative './' so it works under any subpath (e.g. GitHub Pages project site
// at /etf-dashboard/ as well as root domain). All asset URLs are emitted relative to the
// document, which is the most portable choice for a static deploy.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});