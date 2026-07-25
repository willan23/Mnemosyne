import {
  getAdditionalUserInfo,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  type UserCredential,
} from 'firebase/auth';
import { auth } from '../firebase';

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
};

const GOOGLE_REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
]);

export function getAuthErrorMessage(error: unknown, fallback = 'Ocorreu um erro. Tenta novamente.'): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  return AUTH_ERROR_MESSAGES[code] ?? fallback;
}

export function isNewAuthUser(credential: UserCredential): boolean {
  return getAdditionalUserInfo(credential)?.isNewUser ?? false;
}

export function createGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export async function signInWithGoogle(): Promise<UserCredential | null> {
  const provider = createGoogleProvider();

  try {
    return await signInWithPopup(auth, provider);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? '';
    if (!GOOGLE_REDIRECT_FALLBACK_CODES.has(code)) {
      throw error;
    }

    await signInWithRedirect(auth, createGoogleProvider());
    return null;
  }
}
