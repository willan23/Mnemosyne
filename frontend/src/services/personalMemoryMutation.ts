import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';

export class PersonalMemoryMutationError extends Error {
  constructor() { super('A conta, cofre ou memória mudou. Atualiza a vista e repete a operação.'); }
}
export interface PersonalMemoryMutationContext { readonly uid: string; assertCurrent: () => void }
export interface PersonalMemoryMutationDeps {
  uid: () => string | null; ready: () => boolean; subscribe: (changed: () => void) => () => void;
}
const defaults = (): PersonalMemoryMutationDeps => ({
  uid: () => auth.currentUser?.uid ?? null, ready: isMemoryCryptoReady,
  subscribe: changed => {
    const uid = auth.currentUser?.uid;
    const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed(); });
    const stopVault = onMemoryCryptoChanged(changed);
    return () => { stopAuth(); stopVault(); };
  },
});
/** Keep one account/vault guard through preparation and commit; observed changes stay latched. */
export async function withPersonalMemoryMutation<T>(uid: string, work: (context: PersonalMemoryMutationContext) => Promise<T>, deps = defaults()): Promise<T> {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) throw new PersonalMemoryMutationError();
  let changed = false; let ended = false;
  const stop = deps.subscribe(() => { changed = true; });
  const assertCurrent = () => { if (changed || ended || deps.uid() !== uid || !deps.ready()) throw new PersonalMemoryMutationError(); };
  try { assertCurrent(); const result = await work(Object.freeze({uid, assertCurrent})); assertCurrent(); return result; }
  finally { ended = true; stop(); }
}
