import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { liveAccountInTransaction } from './accountAccess';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { AI_COUNTER_KEYS, AI_COST_POLICY_VERSION, AI_HOURLY_LIMIT, AI_INPUT_OVERHEAD_RESERVATION, AI_MONTHLY_LIMITS,
  addAiCounters, emptyAiCounters, parseAiGenerationScope, readAiCounters, resolveAiPlan,
  type AiBudgetCounters, type AiGenerationKind, type AiGenerationScope, type AiPlan } from './aiCostPolicy';
import { aiModelAllowedForPlan, resolveImageModel, resolveTextModel } from './modelPolicy';

const digest = (kind: 'user' | 'team', id: string) => createHash('sha256').update(`mnemosyne:ai-budget:v2\0${kind}\0${id}`).digest('hex');
export function aiBudgetDocumentId(kind: 'user' | 'team', id: string, period: string): string {
  if (!['user', 'team'].includes(kind) || !attachmentActorIdValid(id) || !/^[0-9]{4}-[0-9]{2}(?:-[0-9]{2}T[0-9]{2})?$/.test(period)) throw new Error('Invalid budget context');
  return `${kind === 'user' ? 'u' : 't'}_${digest(kind, id)}_${period}`;
}
class BudgetRefusal extends Error {
  constructor(readonly reason: 'denied' | 'exhausted' | 'unavailable') { super('AI admission unavailable'); }
}
export class AiGenerationAccessError extends Error { constructor() { super('AI access changed'); } }
export interface AiGenerationRequest {
  kind: AiGenerationKind; modelId: string; promptBytes: number; outputTokens: number; scope: AiGenerationScope;
}
export interface AiGenerationAdmission {
  uid: string; kind: AiGenerationKind; modelId: string; scope: AiGenerationScope;
  userPlan: AiPlan; billingPlan: AiPlan; ownerUid: string; policyVersion: number;
}
export type AiBudgetDecision = { admitted: true; admission: AiGenerationAdmission } |
  { admitted: false; reason: 'denied' | 'exhausted' | 'unavailable' };

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validWrap = (value: unknown) => record(value) && value.v === 1 && value.alg === 'RSA-OAEP' &&
  typeof value.ct === 'string' && value.ct.length >= 256 && value.ct.length <= 2048 && /^[A-Za-z0-9+/]+={0,2}$/.test(value.ct);
const coherentWraps = (team: Record<string, any>, epoch: Record<string, any>) =>
  record(team.wrappedKeys) && record(epoch.wrappedKeys) &&
  Object.keys(team.wrappedKeys).length === team.memberUids.length && Object.keys(epoch.wrappedKeys).length === team.memberUids.length &&
  team.memberUids.every((id: string) => validWrap(team.wrappedKeys[id]) && validWrap(epoch.wrappedKeys[id]) &&
    team.wrappedKeys[id].ct === epoch.wrappedKeys[id].ct);

async function readAdmission(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, uid: string,
  scope: AiGenerationScope, model?: { kind: AiGenerationKind; id: string }): Promise<AiGenerationAdmission> {
  if (!await liveAccountInTransaction(tx, db, uid)) throw new BudgetRefusal('denied');
  const [mode, callerEntitlement] = await tx.getAll(db.doc('config/monetization'), db.doc(`entitlements/${uid}`));
  const userPlan = resolveAiPlan(mode.data(), callerEntitlement.data());
  if (!userPlan) throw new BudgetRefusal('unavailable');
  let ownerUid = uid; let billingPlan = userPlan;
  if (scope.kind === 'team') {
    const [teamSnap, deletion, epochSnap] = await tx.getAll(db.doc(`teams/${scope.teamId}`), db.doc(`teamDeletions/${scope.teamId}`),
      db.doc(`teams/${scope.teamId}/keyEpochs/${scope.keyEpoch}`));
    const team = teamSnap.data(); const epoch = epochSnap.data();
    if (!team || deletion.exists || team.deletionState === 'deleting' || !attachmentActorIdValid(team.ownerUid) ||
        !Array.isArray(team.memberUids) || team.memberUids.length > 10 || team.memberUids.some(id => !attachmentActorIdValid(id)) ||
        new Set(team.memberUids).size !== team.memberUids.length || !team.memberUids.includes(uid) || !team.memberUids.includes(team.ownerUid) ||
        team.keyRotationStatus !== 'active' || team.pendingRotationId != null ||
        team.activeKeyEpoch !== scope.keyEpoch || team.activeKeyId !== scope.keyId ||
        !epoch || epoch.status !== 'active' || epoch.keyId !== scope.keyId || !Array.isArray(epoch.memberUids) ||
        epoch.memberUids.length !== team.memberUids.length || new Set(epoch.memberUids).size !== epoch.memberUids.length ||
        !epoch.memberUids.every(id => team.memberUids.includes(id)) ||
        !coherentWraps(team, epoch)) throw new BudgetRefusal('denied');
    ownerUid = team.ownerUid;
    if (!await liveAccountInTransaction(tx, db, ownerUid)) throw new BudgetRefusal('denied');
    const entitlement = ownerUid === uid ? callerEntitlement : await tx.get(db.doc(`entitlements/${ownerUid}`));
    const plan = resolveAiPlan(mode.data(), entitlement.data());
    if (!plan) throw new BudgetRefusal('unavailable');
    if (plan !== 'preview' && plan !== 'sovereign') throw new BudgetRefusal('denied');
    billingPlan = plan;
  }
  if (model && !aiModelAllowedForPlan(model.kind, model.id, billingPlan)) throw new BudgetRefusal('denied');
  return { uid, scope, kind: model?.kind ?? 'text', modelId: model?.id ?? 'hf-default', userPlan, billingPlan, ownerUid,
    policyVersion: AI_COST_POLICY_VERSION };
}

function canonicalUsage(snapshot: FirebaseFirestore.DocumentSnapshot, kind: 'user' | 'team', id: string, period: string,
  ownerUid?: string): AiBudgetCounters {
  if (!snapshot.exists) return emptyAiCounters();
  const data = snapshot.data()!;
  if (data.v !== 2 || data.kind !== kind || data.period !== period ||
      (kind === 'user' ? data.uid !== id : data.teamId !== id || data.ownerUid !== ownerUid)) throw new BudgetRefusal('unavailable');
  const usage = readAiCounters(data.usage);
  if (!usage) throw new BudgetRefusal('unavailable');
  return usage;
}

/** All ledgers and the compatibility mirror participate in one transaction. Failed calls retain reservations. */
export async function reserveInternalAiBudget(uid: string, charge: AiBudgetCounters, now: Date, scope: AiGenerationScope,
  model?: { kind: AiGenerationKind; id: string }, suppliedDb?: FirebaseFirestore.Firestore): Promise<AiBudgetDecision> {
  try {
    if (!attachmentActorIdValid(uid) || !(now instanceof Date) || !Number.isFinite(now.getTime()) ||
        !readAiCounters(charge) || charge.requests < 1) return { admitted: false, reason: 'denied' };
    const db = suppliedDb ?? admin.firestore(); const iso = now.toISOString(); const month = iso.slice(0, 7); const hour = iso.slice(0, 13);
    const userMonthly = db.doc(`aiBudgets/${aiBudgetDocumentId('user', uid, month)}`);
    const userHourly = db.doc(`aiBudgetWindows/${aiBudgetDocumentId('user', uid, hour)}`);
    const userPersonal = db.doc(`aiPersonalBudgets/${aiBudgetDocumentId('user', uid, month)}`);
    const legacyRef = db.doc(`aiBudgets/${uid.replace(/[^\w-]/g, '_')}_${month}`);
    return await db.runTransaction(async tx => {
      const admission = await readAdmission(tx, db, uid, scope, model);
      const refs = [userMonthly, userHourly, legacyRef, userPersonal];
      if (scope.kind === 'team') refs.push(db.doc(`teamAiBudgets/${aiBudgetDocumentId('team', scope.teamId, month)}`),
        db.doc(`teamAiBudgetWindows/${aiBudgetDocumentId('team', scope.teamId, hour)}`));
      const rows = await tx.getAll(...refs);
      const monthlyUsage = canonicalUsage(rows[0], 'user', uid, month);
      const personalUsage = canonicalUsage(rows[3], 'user', uid, month);
      let mirror = !rows[2].exists;
      if (rows[2].exists) {
        const old = rows[2].data()!; const oldUsage = readAiCounters(old.usage, true);
        // A different valid UID owns its legacy collision; never overwrite or charge that record.
        if (!attachmentActorIdValid(old.uid) || old.month !== month || !oldUsage) throw new BudgetRefusal('unavailable');
        mirror = old.uid === uid;
        if (mirror) for (const key of AI_COUNTER_KEYS) {
          // Only consumption added by old instances belongs to the personal ledger.
          const delta = Math.max(0, oldUsage[key] - monthlyUsage[key]);
          if (!Number.isSafeInteger(personalUsage[key] + delta)) throw new BudgetRefusal('unavailable');
          personalUsage[key] += delta;
          monthlyUsage[key] = Math.max(monthlyUsage[key], oldUsage[key]);
        }
      }
      // Team sponsorship cannot remove the caller's global technical ceiling or consume their personal image entitlement.
      const monthly = addAiCounters(monthlyUsage, charge, AI_MONTHLY_LIMITS.preview);
      const personal = scope.kind === 'personal' ? addAiCounters(personalUsage, charge, AI_MONTHLY_LIMITS[admission.userPlan]) : personalUsage;
      const hourly = addAiCounters(canonicalUsage(rows[1], 'user', uid, hour), charge, AI_HOURLY_LIMIT);
      let teamMonthly: AiBudgetCounters | null = null; let teamHourly: AiBudgetCounters | null = null;
      if (scope.kind === 'team') {
        teamMonthly = addAiCounters(canonicalUsage(rows[4], 'team', scope.teamId, month, admission.ownerUid), charge, AI_MONTHLY_LIMITS[admission.billingPlan]);
        teamHourly = addAiCounters(canonicalUsage(rows[5], 'team', scope.teamId, hour, admission.ownerUid), charge, AI_HOURLY_LIMIT);
      }
      if (!monthly || !personal || !hourly || (scope.kind === 'team' && (!teamMonthly || !teamHourly))) throw new BudgetRefusal('exhausted');
      const stamp = { v: 2, kind: 'user', uid, updatedAt: now.getTime(), policyVersion: AI_COST_POLICY_VERSION };
      tx.set(userMonthly, { ...stamp, period: month, usage: monthly });
      tx.set(userPersonal, { ...stamp, period: month, usage: personal });
      tx.set(userHourly, { ...stamp, period: hour, usage: hourly, expiresAt: now.getTime() + 48 * 60 * 60_000 });
      // Keep old instances on the same monotonically increasing monthly counter during rollout.
      if (mirror) tx.set(legacyRef, { uid, month, usage: monthly, updatedAt: now.getTime() });
      if (scope.kind === 'team') {
        const teamStamp = { v: 2, kind: 'team', teamId: scope.teamId, ownerUid: admission.ownerUid,
          updatedAt: now.getTime(), policyVersion: AI_COST_POLICY_VERSION };
        tx.set(refs[4], { ...teamStamp, period: month, usage: teamMonthly });
        tx.set(refs[5], { ...teamStamp, period: hour, usage: teamHourly, expiresAt: now.getTime() + 48 * 60 * 60_000 });
      }
      return { admitted: true, admission };
    });
  } catch (error) {
    return { admitted: false, reason: error instanceof BudgetRefusal ? error.reason : 'unavailable' };
  }
}

export async function reserveAiGenerationBudget(uid: string, input: AiGenerationRequest, now = new Date(), db?: FirebaseFirestore.Firestore): Promise<AiBudgetDecision> {
  const scope = parseAiGenerationScope(input?.scope);
  const model = input?.kind === 'text' ? resolveTextModel(input.modelId) : input?.kind === 'image' ? resolveImageModel(input.modelId) : null;
  if (!scope || !model || !Number.isSafeInteger(input.promptBytes) || input.promptBytes < 1 || input.promptBytes > 16_000 ||
      !Number.isSafeInteger(input.outputTokens) || input.outputTokens < 0 ||
      (input.kind === 'text' ? input.outputTokens < 64 || input.outputTokens > ('maxOutputTokens' in model ? model.maxOutputTokens : 0) : input.outputTokens !== 0)) {
    return { admitted: false, reason: 'denied' };
  }
  const charge: AiBudgetCounters = { requests: 1, inputBytes: input.promptBytes,
    reservedInputTokens: input.promptBytes + AI_INPUT_OVERHEAD_RESERVATION,
    reservedOutputTokens: input.outputTokens, images: input.kind === 'image' ? 1 : 0, costUnits: model.costUnitsPerRequest };
  return reserveInternalAiBudget(uid, charge, now, scope, { kind: input.kind, id: model.id }, db);
}

/** Revalidate before dispatch and after response; never reserve twice for one operation. */
export async function isAiGenerationAdmissionLive(admission: AiGenerationAdmission, suppliedDb?: FirebaseFirestore.Firestore): Promise<boolean> {
  try {
    if (!admission || admission.policyVersion !== AI_COST_POLICY_VERSION || !attachmentActorIdValid(admission.uid)) return false;
    const scope = parseAiGenerationScope(admission.scope); if (!scope) return false;
    const db = suppliedDb ?? admin.firestore();
    return await db.runTransaction(async tx => {
      const current = await readAdmission(tx, db, admission.uid, scope, { kind: admission.kind, id: admission.modelId });
      return current.userPlan === admission.userPlan && current.billingPlan === admission.billingPlan && current.ownerUid === admission.ownerUid;
    });
  } catch { return false; }
}
