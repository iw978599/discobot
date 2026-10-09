import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// The service worker caches the built app so it opens with no connection. It is only
// produced by a production build, so there is nothing to register in development.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
      console.warn('Offline support is unavailable:', error);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
