import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Compute a sensible basename for BrowserRouter at runtime.
// Priority:
// 1. If there's a <base> tag in the document, use its absolute href's pathname
//    (this works when index.html contains <base href="%BASE_URL%"> and Vite
//    has made it absolute at runtime).
// 2. Fall back to import.meta.env.BASE_URL when it's a proper path (not './').
// 3. Otherwise leave basename undefined so Router works with the current URL.
function getRouterBasename(): string | undefined {
  try {
    const baseEl = document.querySelector('base');
    if (baseEl && baseEl.getAttribute('href')) {
      // baseEl.href yields an absolute URL. Use its pathname as basename.
      const pathname = new URL((baseEl as HTMLBaseElement).href).pathname;
      // Normalize: treat root '/' as no basename, remove trailing slash.
      if (!pathname || pathname === '/') return undefined;
      return pathname.replace(/\/$/, '');
    }
  } catch (e) {
    // ignore and fallback
  }

  const envBase = import.meta.env.BASE_URL;
  if (envBase && envBase !== './' && envBase !== '/') {
    return envBase.replace(/\/$/, '');
  }
  return undefined;
}

const routerBasename = getRouterBasename();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
