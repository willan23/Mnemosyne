import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import app, { auth, db } from '../firebase';
import { parseAgentAccessCommand, readAgentAccessState, type AgentAccessState } from '../../../functions/src/agentAccountContract';
import { withAgentAccount } from './agentAccount';
export type { AgentAccessState };

export function observeAgentAccess(uid: string, receive: (state: AgentAccessState | null) => void) {
  let active = true, changed = false;
  let releaseData = () => {};
  let dataStopped = false;
  const stopData = () => { if (!dataStopped) { dataStopped = true; releaseData(); } };
  const stopAuth = onAuthStateChanged(auth, user => {
    if (active && user?.uid !== uid) { changed = true; receive(null); stopData(); }
  });
  if (auth.currentUser?.uid === uid && !changed) releaseData = onSnapshot(doc(db, 'users', uid), { includeMetadataChanges: true }, snapshot => {
    // Cached values cannot prove the current switch state on the server.
    if (active && !changed && auth.currentUser?.uid === uid) receive(snapshot.exists() && !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites
      ? readAgentAccessState(snapshot.data()) : null);
  }, () => { if (active && !changed) receive(null); });
  else receive(null);
  return () => { if (active) { active = false; stopData(); stopAuth(); } };
}

export async function setAgentAccess(uid: string, baseline: AgentAccessState, disabled: boolean): Promise<void> {
  const command = parseAgentAccessCommand({ expectedUid: uid, baseline, disabled });
  return withAgentAccount(uid, async guard => {
    guard();
    const result = (await httpsCallable<typeof command, AgentAccessState>(getFunctions(app, 'europe-west1'), 'setAgentAccess')(command)).data;
    guard();
    if (!result || result.disabled !== command.disabled || result.epoch !== command.baseline.epoch + (command.disabled ? 1 : 0)) throw new Error('Invalid agent control response');
  });
}
