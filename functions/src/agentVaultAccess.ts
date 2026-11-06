import { AccountUnavailableError } from './accountAccess';
import { teamRevisionAccess } from './teamRevisions';
import { syncDocumentStateHash } from './mobileSyncImport';
import { agentVaultAdmissionBytes, type AgentVaultAdmission, type AgentVaultTarget } from './agentVaultContract';

/** Never returns wrapped keys. The snapshot hashes retire grants even after a team A -> B -> A. */
export async function inspectAgentVault(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore,
  uid: string, target: AgentVaultTarget): Promise<{ admission: AgentVaultAdmission; name: string | null }> {
  if (target.kind === 'personal') return { admission: { kind: 'personal' }, name: null };
  const access = await teamRevisionAccess(tx, db, uid, target.teamId);
  if (access.revoked) throw new AccountUnavailableError();
  const name = typeof access.row.name === 'string' && access.row.name.trim() ? access.row.name.trim().slice(0, 200) : null;
  return { admission: { kind: 'team', teamId: target.teamId, keyEpoch: access.row.activeKeyEpoch,
    keyId: access.row.activeKeyId, teamStateHash: syncDocumentStateHash(access.team),
    epochStateHash: syncDocumentStateHash(access.epoch) }, name };
}
export async function assertAgentVaultAdmission(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore,
  uid: string, expected: AgentVaultAdmission): Promise<void> {
  const current = await inspectAgentVault(tx, db, uid, expected);
  if (agentVaultAdmissionBytes(current.admission) !== agentVaultAdmissionBytes(expected)) throw new AccountUnavailableError();
}
