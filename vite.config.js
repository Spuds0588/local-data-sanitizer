import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// VITE_BASE_PATH lets the GitHub Pages build use '/<repo>/' while the
// agent-hosted / local build stays at '/'.
// VITE_STABLE_NAMES keeps the bundle at assets/app.js + assets/app.css so the
// branch-served fallback in index.html has a fixed path to load.
const stableNames = process.env.VITE_STABLE_NAMES === '1';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  build: stableNames
    ? {
        rollupOptions: {
          output: {
            entryFileNames: 'assets/app.js',
            chunkFileNames: 'assets/[name].js',
            assetFileNames: 'assets/[name][extname]',
          },
        },
      }
    : {},
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    // pdf.js ships a browser (modern) and a Node (legacy) build; tests run in Node.
    alias: {
      'pdfjs-dist/build/': 'pdfjs-dist/legacy/build/',
    },
  },
});
