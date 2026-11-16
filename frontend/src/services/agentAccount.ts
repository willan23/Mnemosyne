import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { agentUidValid } from '../../../functions/src/agentAccountContract';

export class AgentAccountError extends Error {
  constructor() { super('Não foi possível confirmar a operação desta conta. Atualiza a vista.'); }
}
/** Latch account changes, including a logout and return to the same UID. */
export async function withAgentAccount<T>(uid: string, work: (guard: () => void) => Promise<T>): Promise<T> {
  if (!agentUidValid(uid)) throw new AgentAccountError();
  let changed = false, ended = false;
  const stop = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed = true; });
  const guard = () => { if (changed || ended || auth.currentUser?.uid !== uid) throw new AgentAccountError(); };
  try { guard(); const result = await work(guard); guard(); return result; }
  catch { throw new AgentAccountError(); }
  finally { ended = true; stop(); }
}
