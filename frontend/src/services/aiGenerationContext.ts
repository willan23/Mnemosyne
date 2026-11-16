import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { attachmentActorIdValid } from '../../../functions/src/attachmentEnvelope';
import { parseAiGenerationScope, type AiGenerationScope } from '../../../functions/src/aiCostPolicy';
import { TEAM_WRITES_ENABLED } from '../config/releaseGates';
import { getLocalAiConfig } from './localAiConfig';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';
import { getTeamKeyCacheGeneration, onTeamKeyChanged } from './teamVault';
import { parseTeam, type TeamRecord } from './teamsService';

export class AiGenerationContextError extends Error {
  constructor() { super('A conta, cofre ou âmbito da geração mudou. Repete a operação no destino correto.'); }
}
export interface AiGenerationContext {
  readonly uid: string; readonly scope: AiGenerationScope; readonly signal: AbortSignal;
  assertCurrent: () => void; assertAccess: () => Promise<void>;
}
export interface AiGenerationContextDeps {
  uid: () => string | null; ready: () => boolean; policy: () => string; generation: () => number;
  subscribe: (changed: () => void) => () => void;
  team: (teamId: string) => Promise<TeamRecord | null>;
}
const defaults = (team: boolean): AiGenerationContextDeps => ({
  uid: () => auth.currentUser?.uid ?? null, ready: () => isMemoryCryptoReady() && (!team || TEAM_WRITES_ENABLED), policy: () => getLocalAiConfig().memoryPermission,
  generation: getTeamKeyCacheGeneration,
  team: async id => parseTeam(id, (await getDocFromServer(doc(db, 'teams', id))).data() ?? {}),
  subscribe: changed => {
    const uid = auth.currentUser?.uid;
    const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed(); });
    const stopVault = onMemoryCryptoChanged(changed); const stopTeam = team ? onTeamKeyChanged(changed) : () => {};
    window.addEventListener('mnemosyne:local-ai-config', changed); window.addEventListener('storage', changed);
    return () => { stopAuth(); stopVault(); stopTeam(); window.removeEventListener('mnemosyne:local-ai-config', changed); window.removeEventListener('storage', changed); };
  },
});
function active(team: TeamRecord | null, uid: string): asserts team is TeamRecord & { activeKeyEpoch: number; activeKeyId: string } {
  if (!team || !team.memberUids.includes(uid) || !team.memberUids.includes(team.ownerUid) ||
      team.keyRotationStatus !== 'active' || team.pendingRotationId || !team.activeKeyEpoch || !team.activeKeyId || !team.wrappedKeys[uid]) {
    throw new AiGenerationContextError();
  }
}
/** Keep this context through generation AND persistence so an account switch away/back stays latched. */
export async function withAiGenerationContext<T>(input: { uid?: string; teamId?: string }, work: (context: AiGenerationContext) => Promise<T>,
  deps = defaults(input.teamId !== undefined)): Promise<T> {
  const uid = input.uid ?? deps.uid();
  if (!attachmentActorIdValid(uid) || (input.teamId !== undefined && !attachmentActorIdValid(input.teamId))) throw new AiGenerationContextError();
  const policy = deps.policy(); const generation = deps.generation(); let changed = false; let ended = false;
  const controller = new AbortController(); const stop = deps.subscribe(() => { changed = true; controller.abort(); });
  const assertCurrent = () => {
    if (changed || ended || deps.uid() !== uid || !deps.ready() || deps.policy() !== policy ||
        (input.teamId !== undefined && deps.generation() !== generation)) throw new AiGenerationContextError();
  };
  try {
    assertCurrent(); let scope: AiGenerationScope = { kind: 'personal' };
    if (input.teamId !== undefined) {
      const team = await deps.team(input.teamId); assertCurrent(); active(team, uid);
      const parsed = parseAiGenerationScope({ kind: 'team', teamId: input.teamId, keyEpoch: team.activeKeyEpoch, keyId: team.activeKeyId });
      if (!parsed) throw new AiGenerationContextError();
      scope = parsed;
    }
    const captured = Object.freeze(scope);
    const assertAccess = async () => {
      assertCurrent();
      if (captured.kind === 'team') {
        const team = await deps.team(captured.teamId); assertCurrent(); active(team, uid);
        if (team.activeKeyEpoch !== captured.keyEpoch || team.activeKeyId !== captured.keyId) throw new AiGenerationContextError();
      }
    };
    const context: AiGenerationContext = Object.freeze({ uid, scope: captured, signal: controller.signal, assertCurrent, assertAccess });
    const result = await work(context); await assertAccess(); return result;
  } finally { ended = true; stop(); }
}
