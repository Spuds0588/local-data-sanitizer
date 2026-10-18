import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// VITE_BASE_PATH lets the GitHub Pages build use '/<repo>/' while the
// agent-hosted / local build stays at '/'.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    // pdf.js ships a browser (modern) and a Node (legacy) build; tests run in Node.
    alias: {
      'pdfjs-dist/build/': 'pdfjs-dist/legacy/build/',
    },
  },
});
