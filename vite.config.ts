import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths: works from app://glassnotes (GlassNotes.app), file:// and any web server.
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pdfjs-dist')) {
            return 'pdfjs';
          }
          if (id.includes('node_modules/katex')) {
            return 'katex';
          }
          if (id.includes('node_modules/lowlight') || id.includes('node_modules/highlight.js')) {
            return 'syntax-highlight';
          }
          if (id.includes('node_modules/@tiptap') || id.includes('node_modules/prosemirror')) {
            return 'editor-vendor';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'icons';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/zustand')) {
            return 'react-vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
});
