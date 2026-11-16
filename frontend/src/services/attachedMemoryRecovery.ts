import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import app, { auth, db } from '../firebase';
import { ATTACHMENT_WRITES_ENABLED, PERSONAL_MEMORY_CREATION_ENABLED, TEAM_WRITES_ENABLED } from '../config/releaseGates';
import { attachmentActorIdValid,attachmentIdValid } from '../../../functions/src/attachmentEnvelope';
import { canonicalAttachedMemoryJson, parseAttachedMemoryInput, type AttachedMemoryInput } from '../../../functions/src/attachedMemoryContract';
import { opaqueAttachmentId } from '../../../functions/src/attachmentMutationContract';
import { authorizeCloudUse } from './cloudUsePolicy';
import { getLocalAiConfig, type MemoryPermission } from './localAiConfig';
import { buildEncryptedMemoryFields, decryptMemoryEnvelope, encryptMemoryFields, isEncryptedMemoryEnvelope, isMemoryCryptoReady, onMemoryCryptoChanged, type EncryptedMemoryEnvelope } from './memoryCrypto';
import { buildTeamMemoryDocFields, getTeamKeyCacheGeneration, onTeamKeyChanged } from './teamVault';
import { unlockTeamKey } from './teamKeyAccess';
import { parseTeam } from './teamsService';
import { readSessionMnemonic } from '../utils/sessionMnemonic';
import { forgetAssociatedUploadCheckpoints } from './attachmentUploadCheckpoint';
import type { Attachment } from '../types/attachments';
export class AttachedMemoryRecoveryError extends Error {
  constructor() { super('A criação da memória aguarda confirmação. Recupera ou cancela a operação pendente antes de repetir.'); }
}
export function assertPersonalMemoryCreationEnabled() {
  if (!PERSONAL_MEMORY_CREATION_ENABLED) throw new AttachedMemoryRecoveryError();
}
export interface AttachedMemoryProposal { uid: string; text: string; title?: string | null; teamId?: string | null; attachments: Attachment[]; metadata: Record<string, unknown>; expectedTeamEpoch?:{keyEpoch:number;keyId:string} }
export interface TeamMemoryCreationProposal {uid:string;text:string;title?:string|null;metadata:Record<string,unknown>;teamId:string;keyEpoch:number;keyId:string}
export function assertTeamMemoryCreationEnabled(){if(!TEAM_WRITES_ENABLED)throw new AttachedMemoryRecoveryError();}
export interface AttachedMemoryRecoveryDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  uid: () => string | null; ready: () => boolean; policy: () => MemoryPermission; generation: () => number; id: () => string;
  subscribe: (changed: () => void) => () => void; exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  prepare: (proposal: AttachedMemoryProposal) => Promise<Pick<AttachedMemoryInput, 'teamId' | 'keyEpoch' | 'keyId' | 'enc'>>;
  encrypt: (fields: { text: string }) => Promise<EncryptedMemoryEnvelope>; decrypt: (envelope: EncryptedMemoryEnvelope) => Promise<{ text: string }>;
  create: (request: AttachedMemoryInput) => Promise<unknown>; status: (request: AttachedMemoryInput) => Promise<unknown>; cancel: (request: AttachedMemoryInput) => Promise<unknown>;
  forgetUploads: (uid: string, ids: string[], guard: () => void) => Promise<void>;
}
export type AttachedMemoryOutcome = { sessionId: string; digest: string } & ({status: 'committed' | 'cancelled'; createdAt: number} | {status: 'revoked'; createdAt: null});
const key = (uid: string) => `mnemosyne:attached-memory-creation:v1:${encodeURIComponent(uid)}`;
const event = 'mnemosyne:attached-memory-creation-changed'; const notify = () => window.dispatchEvent(new Event(event));
export function hasPendingAttachedMemoryCreation(uid: string) { try { return localStorage.getItem(key(uid)) !== null; } catch { return true; } }
export function observeAttachedMemoryCreations(callback: () => void) {
  window.addEventListener(event, callback); window.addEventListener('storage', callback);
  return () => { window.removeEventListener(event, callback); window.removeEventListener('storage', callback); };
}
function defaults(): AttachedMemoryRecoveryDeps {
  const actorUid=auth.currentUser?.uid;
  const call = async (name: string, request: unknown) => {if(!actorUid)throw new AttachedMemoryRecoveryError();return(await httpsCallable(getFunctions(app, 'europe-west1'), name)({actorUid,request})).data;};
  return { storage: localStorage, uid: () => auth.currentUser?.uid ?? null, ready: isMemoryCryptoReady, policy: () => getLocalAiConfig().memoryPermission,
    generation: getTeamKeyCacheGeneration, id: () => crypto.randomUUID(), encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope,
    create: request => call(request.attachmentIds.length ? 'createAttachedMemory' : request.teamId!==null?'createTeamMemory':'createPersonalMemory', request), status: request => call('getAttachedMemoryCreationStatus', request), cancel: request => call('cancelAttachedMemoryCreation', request),
    forgetUploads: forgetAssociatedUploadCheckpoints,
    prepare: async proposal => {
      if (!proposal.teamId) return { teamId: null, keyEpoch: null, keyId: null, enc: (await buildEncryptedMemoryFields(proposal.text, proposal.title)).enc };
      if (!TEAM_WRITES_ENABLED || !attachmentActorIdValid(proposal.teamId)) throw new AttachedMemoryRecoveryError();
      const team = parseTeam(proposal.teamId, (await getDocFromServer(doc(db, 'teams', proposal.teamId))).data() ?? {});
      if (!team || !team.memberUids.includes(proposal.uid) || team.keyRotationStatus !== 'active' || team.pendingRotationId != null || !team.activeKeyEpoch || !team.activeKeyId || !team.wrappedKeys[proposal.uid]) throw new AttachedMemoryRecoveryError();
      if(proposal.expectedTeamEpoch&&(team.activeKeyEpoch!==proposal.expectedTeamEpoch.keyEpoch||team.activeKeyId!==proposal.expectedTeamEpoch.keyId))throw new AttachedMemoryRecoveryError();
      const teamKey = await unlockTeamKey(team, proposal.uid, readSessionMnemonic(), { epoch: team.activeKeyEpoch, notify: false });
      const fields = await buildTeamMemoryDocFields(team.id, teamKey, proposal.text, proposal.title, team.activeKeyEpoch, team.activeKeyId);
      return { teamId: fields.teamId, keyEpoch: fields.keyEpoch, keyId: fields.keyId, enc: fields.enc };
    },
    subscribe: changed => {
      const uid = auth.currentUser?.uid; const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed(); });
      const stopVault = onMemoryCryptoChanged(changed); const stopTeam = onTeamKeyChanged(changed);
      window.addEventListener('mnemosyne:local-ai-config', changed); window.addEventListener('storage', changed);
      return () => { stopAuth(); stopVault(); stopTeam(); window.removeEventListener('mnemosyne:local-ai-config', changed); window.removeEventListener('storage', changed); };
    }, exclusive: async (name, work) => {
      if (!navigator.locks) throw new AttachedMemoryRecoveryError();
      return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, lock => { if (!lock) throw new AttachedMemoryRecoveryError(); return work(); });
    } };
}
async function hash(request: AttachedMemoryInput) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalAttachedMemoryJson(request))));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
async function read(raw: string, uid: string, deps: AttachedMemoryRecoveryDeps, guard: () => void) {
  if (raw.length > 1000000) throw new AttachedMemoryRecoveryError(); const envelope: unknown = JSON.parse(raw);
  if (!isEncryptedMemoryEnvelope(envelope)) throw new AttachedMemoryRecoveryError();
  const text = (await deps.decrypt(envelope)).text; guard(); if (text.length > 600000) throw new AttachedMemoryRecoveryError();
  const checkpoint = JSON.parse(text) as { v: number; uid: string; request: unknown };
  if (!checkpoint || Object.keys(checkpoint).sort().join(',') !== 'request,uid,v' || checkpoint.v !== 1 || checkpoint.uid !== uid) throw new AttachedMemoryRecoveryError();
  return parseAttachedMemoryInput(checkpoint.request);
}
async function response(value: unknown, request: AttachedMemoryInput, unknownAllowed: boolean, guard: () => void): Promise<AttachedMemoryOutcome | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'createdAt,digest,sessionId,status') throw new AttachedMemoryRecoveryError();
  const result = value as AttachedMemoryOutcome; const digest = await hash(request); guard();
  if (result.sessionId !== request.sessionId || result.digest !== digest) throw new AttachedMemoryRecoveryError();
  if (unknownAllowed && (result.status as string) === 'unknown' && result.createdAt === null) return null;
  if (result.status === 'revoked' && result.createdAt === null) return result;
  if (!['committed', 'cancelled'].includes(result.status) || !Number.isSafeInteger(result.createdAt) || result.createdAt < 1) throw new AttachedMemoryRecoveryError(); return result;
}
async function operate(uid: string, mode: 'start' | 'recover' | 'cancel', proposal: AttachedMemoryProposal | undefined, deps: AttachedMemoryRecoveryDeps, assertCurrent: () => void = () => {}, assertAccess:()=>Promise<void>=async()=>{}): Promise<AttachedMemoryOutcome> {
  const creationEnabled = (ids: readonly unknown[],teamId?:string|null) => teamId?(TEAM_WRITES_ENABLED&&(!ids.length||ATTACHMENT_WRITES_ENABLED)):(ids.length?ATTACHMENT_WRITES_ENABLED:PERSONAL_MEMORY_CREATION_ENABLED);
  if (!attachmentActorIdValid(uid) || (mode === 'start' && (!proposal || !creationEnabled(proposal.attachments,proposal.teamId)))) throw new AttachedMemoryRecoveryError();
  const policy = deps.policy(); const generation = deps.generation(); let changed = false; const stop = deps.subscribe(() => { changed = true; });
  let anchored = false; let raw: string | null = null;
  const guard = () => { assertCurrent(); if (changed || deps.uid() !== uid || !deps.ready() || deps.policy() !== policy || deps.generation() !== generation ||
    (anchored && deps.storage.getItem(key(uid)) !== raw)) throw new AttachedMemoryRecoveryError(); };
  const consent = (bytes: number, memory: boolean) => { guard(); authorizeCloudUse({ purpose: 'attachment-storage', provider: 'Firebase', policy,
    payloadSummary: { bytes, containsMemory: memory, containsAttachment: false, containsPrompt: false } }); guard(); };
  const authorize = (request: AttachedMemoryInput) => {
    guard();
    if (request.attachmentIds.length) consent(new TextEncoder().encode(canonicalAttachedMemoryJson(request)).length, true);
    // The AI policy controls provider disclosure and attachment transfers. Vault text synchronization carries ciphertext only.
    else if (!['never-cloud', 'confirm-cloud', 'allow-cloud'].includes(policy) ||
      (Array.isArray(request.metadata.connections) && request.metadata.connections.length)) throw new AttachedMemoryRecoveryError();
  };
  try {
    guard(); return await deps.exclusive(key(uid), async () => {
      guard(); raw = deps.storage.getItem(key(uid)); anchored = true; let request: AttachedMemoryInput;
      const existing = raw !== null;
      if (raw !== null) {
        if (mode === 'start') throw new AttachedMemoryRecoveryError(); request = await read(raw, uid, deps, guard);
      } else {
        if (mode !== 'start' || !proposal || proposal.uid !== uid) throw new AttachedMemoryRecoveryError();
        const ids = proposal.attachments.map(item => opaqueAttachmentId(item.url));
        if (ids.some(id => id === null) || new Set(ids).size !== ids.length) throw new AttachedMemoryRecoveryError();
        if (proposal.teamId&&ids.length) consent(2048, false); // Attached transfers retain their own metadata consent.
        else if (!(ids.length ? ['allow-cloud', 'confirm-cloud'] : ['never-cloud', 'confirm-cloud', 'allow-cloud']).includes(policy)) throw new AttachedMemoryRecoveryError();
        const sessionId = deps.id(); guard();
        const fields = await deps.prepare(proposal); guard();
        if (fields.teamId !== (proposal.teamId ?? null)) throw new AttachedMemoryRecoveryError();
        if(proposal.expectedTeamEpoch&&(fields.keyEpoch!==proposal.expectedTeamEpoch.keyEpoch||fields.keyId!==proposal.expectedTeamEpoch.keyId))throw new AttachedMemoryRecoveryError();
        request = parseAttachedMemoryInput({ sessionId, ...fields, attachmentIds: ids, metadata: proposal.metadata });
      }
      authorize(request);
      if (!existing) {
        const encrypted = await deps.encrypt({ text: JSON.stringify({ v: 1, uid, request }) }); guard();
        if (!isEncryptedMemoryEnvelope(encrypted)) throw new AttachedMemoryRecoveryError(); const serialized = JSON.stringify(encrypted);
        deps.storage.setItem(key(uid), serialized); raw = serialized; guard(); notify();
      }
      guard(); let known = existing ? await response(await deps.status(request), request, true, guard) : null; guard();
      if (!known) {
        if (mode !== 'cancel' && !creationEnabled(request.attachmentIds,request.teamId)) throw new AttachedMemoryRecoveryError();
        known = await response(mode === 'cancel' ? await deps.cancel(request) : await deps.create(request), request, false, guard); guard();
      }
      if (!known) throw new AttachedMemoryRecoveryError();
      const terminal = known;
      const confirm = async () => {
        guard(); const observed = await response(await deps.status(request), request, false, guard); guard();
        if (!observed || observed.status !== terminal.status || observed.createdAt !== terminal.createdAt) throw new AttachedMemoryRecoveryError();
      };
      await confirm();
      if(mode==='start'){await assertAccess();guard();}
      if (known.status === 'committed' && request.attachmentIds.length) { await deps.forgetUploads(uid, request.attachmentIds, guard); guard(); }
      await confirm(); guard();
      deps.storage.removeItem(key(uid)); raw = null; guard(); notify(); return known;
    });
  } catch { throw new AttachedMemoryRecoveryError(); } finally { stop(); }
}
async function create(proposal: AttachedMemoryProposal, deps: AttachedMemoryRecoveryDeps, assertCurrent: () => void,assertAccess:()=>Promise<void>=async()=>{}) {
  const captured = structuredClone(proposal);
  const result = await operate(captured.uid, 'start', captured, deps, assertCurrent,assertAccess); if (result.status !== 'committed') throw new AttachedMemoryRecoveryError(); return { id: result.sessionId };
}
export async function createMemoryWithAttachments(proposal: AttachedMemoryProposal, deps = defaults(), assertCurrent: () => void = () => {},assertAccess:()=>Promise<void>=async()=>{}) {
  if (!proposal.attachments.length) throw new AttachedMemoryRecoveryError();
  return create(proposal, deps, assertCurrent,assertAccess);
}
export async function createTeamMemory(proposal:TeamMemoryCreationProposal,deps=defaults(),assertCurrent:()=>void=()=>{},assertAccess:()=>Promise<void>=async()=>{}){
  if(!attachmentActorIdValid(proposal.teamId)||!Number.isSafeInteger(proposal.keyEpoch)||proposal.keyEpoch<1||!attachmentIdValid(proposal.keyId))throw new AttachedMemoryRecoveryError();
  return create({uid:proposal.uid,text:proposal.text,title:proposal.title,metadata:proposal.metadata,teamId:proposal.teamId,attachments:[],expectedTeamEpoch:{keyEpoch:proposal.keyEpoch,keyId:proposal.keyId}},deps,assertCurrent,assertAccess);
}
export async function createPersonalMemory(proposal: Omit<AttachedMemoryProposal, 'attachments' | 'teamId'>, deps = defaults(), assertCurrent: () => void = () => {}) {
  return create({ ...proposal, attachments: [], teamId: null }, deps, assertCurrent);
}
export const recoverAttachedMemoryCreation = (uid: string, deps = defaults()) => operate(uid, 'recover', undefined, deps);
export const cancelPendingAttachedMemoryCreation = (uid: string, deps = defaults()) => operate(uid, 'cancel', undefined, deps);
