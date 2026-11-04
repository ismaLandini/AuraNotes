import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Strips legacy `.ttf` and `.woff` font files from the production bundle,
 * keeping only `.woff2` (supported natively by macOS WebKit and all modern browsers).
 */
function stripLegacyFontFormats(): Plugin {
  return {
    name: 'strip-legacy-font-formats',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.ttf') || fileName.endsWith('.woff')) {
          delete bundle[fileName];
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stripLegacyFontFormats()],
  // Relative asset paths: works inside Tauri 2 (AuraNotes.app) and any web server.
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
