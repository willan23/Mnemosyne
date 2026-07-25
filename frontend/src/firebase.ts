import { getApp, getApps, initializeApp } from 'firebase/app';
import {
    browserLocalPersistence,
    getAuth,
    indexedDBLocalPersistence,
    initializeAuth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase web config is public; env vars still override these local defaults.
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDVA1XN6YOJ0VYDgzV2i3TdgfjwqPMWIhY',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'mnemosyne-one.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'mnemosyne-one',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'mnemosyne-one.firebasestorage.app',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '960796327752',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:960796327752:web:f30c44a90a576ab3fcbd7d',
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-0B87V1GG56'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const createPersistentAuth = () => {
    try {
        return initializeAuth(app, {
            persistence: [indexedDBLocalPersistence, browserLocalPersistence],
        });
    } catch (error) {
        if ((error as { code?: string }).code === 'auth/already-initialized') {
            return getAuth(app);
        }
        throw error;
    }
};

export const auth = createPersistentAuth();
export const db = getFirestore(app);
export const storage = getStorage(app);

/**
 * App Check opcional — ativa só com site key configurada.
 * Protege Functions/Firestore de abuso automatizado sem bloquear dev local.
 * Docs: https://firebase.google.com/docs/app-check
 */
export async function initAppCheckIfConfigured(): Promise<boolean> {
  const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY as string | undefined;
  if (!siteKey || typeof window === 'undefined') return false;
  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    return true;
  } catch (error) {
    console.warn('App Check não inicializado:', error);
    return false;
  }
}

export default app;
