import { getApp, getApps, initializeApp } from 'firebase/app';
import {
    browserLocalPersistence,
    getAuth,
    indexedDBLocalPersistence,
    initializeAuth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import {
    initializeAppCheck,
    ReCaptchaEnterpriseProvider,
    ReCaptchaV3Provider,
} from 'firebase/app-check';
import { Capacitor } from '@capacitor/core';

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

/** App Check starts before Auth, Firestore, and Storage are accessed. */
export function initAppCheckIfConfigured(): boolean {
  const siteKey = (import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY as string | undefined)?.trim();
  if (!siteKey || typeof window === 'undefined') return false;
  // Native WebViews need their own attestation integration before enforcement.
  if ('__TAURI_INTERNALS__' in window || Capacitor.isNativePlatform()) return false;
  const providerKind = (import.meta.env.VITE_FIREBASE_APPCHECK_PROVIDER || 'v3')
    .toString()
    .trim()
    .toLowerCase();
  try {
    const provider = providerKind === 'enterprise'
      ? new ReCaptchaEnterpriseProvider(siteKey)
      : new ReCaptchaV3Provider(siteKey);
    initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
    return true;
  } catch (error) {
    console.warn('App Check não inicializado:', error);
    return false;
  }
}

initAppCheckIfConfigured();

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

export default app;
