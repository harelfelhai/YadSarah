import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { installGlobalErrorHandlers } from './api/globalErrorHandlers';

// Catch window-level errors + unhandled promise rejections (which the React ErrorBoundary can't see)
// and ship them to the server crash log. Installed once, before the first render.
installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
