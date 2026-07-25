import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { UIProvider } from './contexts/UIContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppUpdatePrompt } from './components/AppUpdatePrompt'
import { Toaster } from 'react-hot-toast'
import './index.css'
import App from './App.tsx'
import { initAppCheckIfConfigured } from './firebase'

// App Check (opcional) — só se VITE_FIREBASE_APPCHECK_SITE_KEY estiver definido
void initAppCheckIfConfigured()

const cleanupLegacyServiceWorkers = () => {
  if (!('serviceWorker' in navigator)) {
    return
  }

  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .then(() => {
      if (!('caches' in window)) {
        return
      }

      return caches.keys().then((cacheNames) => Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName))))
    })
    .catch(() => {
      // Best-effort cleanup for users who still have the old PWA worker installed.
    })
}

cleanupLegacyServiceWorkers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <UIProvider>
            <App />
            <AppUpdatePrompt />
            <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#ededed',
              },
              success: {
                iconTheme: {
                  primary: '#10b981',
                  secondary: '#ededed',
                },
              },
              error: {
                iconTheme: {
                  primary: '#ef4444',
                  secondary: '#ededed',
                },
              },
            }}
          />
          </UIProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
