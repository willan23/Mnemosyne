import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
const platform = vi.hoisted(() => ({ native: false }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => platform.native },
}));

vi.mock('firebase/app', () => ({
  getApps: () => [],
  getApp: () => ({}),
  initializeApp: () => { calls.push('app'); return {}; },
}));
vi.mock('firebase/app-check', () => ({
  ReCaptchaV3Provider: class { constructor() { calls.push('v3'); } },
  ReCaptchaEnterpriseProvider: class { constructor() { calls.push('enterprise'); } },
  initializeAppCheck: () => { calls.push('app-check'); },
}));
vi.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  indexedDBLocalPersistence: {},
  getAuth: () => ({}),
  initializeAuth: () => { calls.push('auth'); return {}; },
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => { calls.push('firestore'); return {}; },
}));
vi.mock('firebase/storage', () => ({
  getStorage: () => { calls.push('storage'); return {}; },
}));

beforeEach(() => {
  calls.length = 0;
  platform.native = false;
  vi.resetModules();
  vi.doUnmock('./firebase');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Firebase startup', () => {
  it('initializes web App Check before accessing Auth, Firestore and Storage', async () => {
    vi.stubEnv('VITE_FIREBASE_APPCHECK_SITE_KEY', 'synthetic-site-key');
    await import('./firebase');
    expect(calls).toEqual(['app', 'v3', 'app-check', 'auth', 'firestore', 'storage']);
  });

  it('does not initialize the web provider in Tauri', async () => {
    vi.stubEnv('VITE_FIREBASE_APPCHECK_SITE_KEY', 'synthetic-site-key');
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    await import('./firebase');
    expect(calls).toEqual(['app', 'auth', 'firestore', 'storage']);
  });

  it('does not initialize the web provider in a native Capacitor WebView', async () => {
    vi.stubEnv('VITE_FIREBASE_APPCHECK_SITE_KEY', 'synthetic-site-key');
    platform.native = true;
    await import('./firebase');
    expect(calls).toEqual(['app', 'auth', 'firestore', 'storage']);
  });
});
