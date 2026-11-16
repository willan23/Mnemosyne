import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth } from '../firebase';

/** Account identity comes only from the callable's verified Auth token. */
export async function initializeAccount(uid: string): Promise<void> {
  if (!uid || auth.currentUser?.uid !== uid) throw new Error('A sessão mudou.');
  const result = await httpsCallable<Record<string, never>, { ready: true }>(getFunctions(app, 'europe-west1'), 'initializeAccount')({});
  if (auth.currentUser?.uid !== uid || !result.data || Object.keys(result.data).join(',') !== 'ready' || result.data.ready !== true) {
    throw new Error('Não foi possível preparar a conta.');
  }
}
