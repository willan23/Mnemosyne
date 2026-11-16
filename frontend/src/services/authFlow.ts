import {
  getAdditionalUserInfo,
  GoogleAuthProvider,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  type UserCredential,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth } from '../firebase';
import { isTauriRuntime } from '../utils/tauriFolderImporter';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email ou password incorretos.',
  'auth/email-already-in-use': 'Este email ja esta em uso.',
  'auth/user-not-found': 'Utilizador nao encontrado.',
  'auth/too-many-requests': 'Demasiadas tentativas. Aguarda um momento.',
  'auth/weak-password': 'A password deve ter pelo menos 6 caracteres.',
  'auth/popup-closed-by-user': 'Login cancelado. Tenta novamente.',
  'auth/popup-blocked': 'O browser bloqueou a janela do Google. Vamos tentar por redirecionamento.',
  'auth/operation-not-supported-in-this-environment': 'Este ambiente nao suporta popup. Vamos tentar por redirecionamento.',
  'auth/cancelled-popup-request': 'Ja existe uma tentativa de login Google em curso.',
  'auth/unauthorized-domain': 'Este dominio ainda nao esta autorizado no Firebase Auth.',
  'auth/operation-not-allowed': 'O provedor Google ainda nao esta ativo no Firebase Auth.',
  'auth/invalid-email': 'Email invalido.',
  'auth/missing-password': 'Preenche a password.',
  'auth/configuration-not-found': 'Firebase Auth nao esta configurado para este projeto.',
  'auth/invalid-api-key': 'A chave Firebase do frontend esta invalida.',
  'auth/timeout': 'Login desktop expirou. Clica em Google outra vez e conclui no browser.',
};

const GOOGLE_REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/cancelled-popup-request',
  'auth/internal-error',
]);

const DESKTOP_AUTH_ORIGIN = 'https://mnemosyne-one.web.app';
const BRIDGE_TIMEOUT_MS = 3 * 60 * 1000;
const BRIDGE_POLL_MS = 2000;

export function getAuthErrorMessage(error: unknown, fallback = 'Ocorreu um erro. Tenta novamente.'): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  if (code && AUTH_ERROR_MESSAGES[code]) return AUTH_ERROR_MESSAGES[code];
  if (code) return `${fallback} (${code})`;
  const message = (error as { message?: string } | null)?.message?.trim();
  if (message) return `${fallback} (${message.slice(0, 120)})`;
  return fallback;
}

export function isNewAuthUser(credential: UserCredential): boolean {
  return getAdditionalUserInfo(credential)?.isNewUser ?? false;
}

export function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

function preferGoogleRedirect(): boolean {
  if (typeof window === 'undefined') return false;
  if (isTauriRuntime()) return false;
  const ua = navigator.userAgent || '';
  return /capacitor|android|iphone|ipad|wv/i.test(ua);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external_url', { url });
      return;
    } catch (error) {
      console.warn('open_external_url invoke failed, falling back:', error);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Google/OAuth inside Tauri WebView is blocked by Google.
 * Open the system browser → web bridge → redeem custom token in the desktop app.
 */
async function signInWithGoogleDesktopBridge(): Promise<UserCredential> {
  const bridgeId = crypto.randomUUID();
  const url = `${DESKTOP_AUTH_ORIGIN}/desktop-auth?bridge=${encodeURIComponent(bridgeId)}`;

  let toastId: string | undefined;
  try {
    const toast = (await import('react-hot-toast')).default;
    toastId = toast.loading('A abrir o browser para login Google… Conclui aí e volta à app.');
  } catch {
    // toast optional
  }

  await openExternalUrl(url);

  const functions = getFunctions(app, 'europe-west1');
  const redeem = httpsCallable(functions, 'redeemDesktopAuthBridge');
  const started = Date.now();

  try {
    while (Date.now() - started < BRIDGE_TIMEOUT_MS) {
      const result = await redeem({ bridgeId });
      const payload = result.data as { pending?: boolean; token?: string };
      if (payload?.token) {
        const credential = await signInWithCustomToken(auth, payload.token);
        if (toastId) {
          const toast = (await import('react-hot-toast')).default;
          toast.success('Login desktop concluído', { id: toastId });
        }
        return credential;
      }
      await sleep(BRIDGE_POLL_MS);
    }

    throw Object.assign(new Error('Login desktop expirou. Clica em Google outra vez.'), {
      code: 'auth/timeout',
    });
  } catch (error) {
    if (toastId) {
      try {
        const toast = (await import('react-hot-toast')).default;
        toast.dismiss(toastId);
      } catch {
        // ignore
      }
    }
    throw error;
  }
}

export async function signInWithGoogle(): Promise<UserCredential | null> {
  if (isTauriRuntime()) {
    return signInWithGoogleDesktopBridge();
  }

  const provider = createGoogleProvider();

  if (preferGoogleRedirect()) {
    await signInWithRedirect(auth, provider);
    return null;
  }

  try {
    return await signInWithPopup(auth, provider);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? '';
    if (GOOGLE_REDIRECT_FALLBACK_CODES.has(code) || !code) {
      await signInWithRedirect(auth, createGoogleProvider());
      return null;
    }

    throw error;
  }
}
