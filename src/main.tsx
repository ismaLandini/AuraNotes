import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/index.css';
import './styles/canvas.css';
import './styles/print.css';
import './styles/theme.css';
import App, { ErrorBoundary } from './App';
import { useStore } from './store/useStore';

// Read-only handle for automated end-to-end checks and debugging from the console.
(window as unknown as { __glassnote: unknown }).__glassnote = { useStore };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
