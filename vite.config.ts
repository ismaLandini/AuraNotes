import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths: works from app://glassnotes (GlassNotes.app), file:// and any web server.
  base: './',
  build: {
    // The app is local-first and loaded once; one larger bundle (editor + syntax highlighting + KaTeX) is expected.
    chunkSizeWarningLimit: 1600,
  },
});
