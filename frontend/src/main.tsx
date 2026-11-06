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
import { initSentryIfConfigured } from './monitoring/sentry'
import { clipIngressFailed, clipIngressErrorCopy, verifyClipIngressBootstrap } from './utils/clipCapture'

verifyClipIngressBootstrap()
if (!clipIngressFailed()) void initSentryIfConfigured()

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
const clipErrorCopy = clipIngressErrorCopy(document.documentElement.lang === 'en' ? navigator.language : document.documentElement.lang)

createRoot(document.getElementById('root')!).render(
  clipIngressFailed() ? <main role="alert" className="min-h-screen bg-slate-950 p-8 text-white">
    <h1>{clipErrorCopy.title}</h1>
    <p>{clipErrorCopy.body}</p>
  </main> : <StrictMode>
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
                  background: '#0f172a',
                  color: '#f8fafc',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                  borderRadius: '0.75rem',
                  padding: '0.75rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                },
                success: {
                  iconTheme: {
                    primary: '#10b981',
                    secondary: '#0f172a',
                  },
                },
                error: {
                  iconTheme: {
                    primary: '#f43f5e',
                    secondary: '#0f172a',
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
