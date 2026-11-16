import {decryptMemoryEnvelope, encryptMemoryFields, isEncryptedMemoryEnvelope, type EncryptedMemoryEnvelope} from './memoryCrypto';
import {withPersonalMemoryMutation, type PersonalMemoryMutationDeps} from './personalMemoryMutation';
import {reviewInboxStore, type ReviewInboxStore, type StoredReviewInbox} from './reviewInboxStore';
import {canonicalSyncState} from '../../../functions/src/mobileSyncImportContract';
import type {ReviewItem} from './reviewInbox';

export class ReviewInboxError extends Error {
  readonly reason: 'invalid' | 'conflict' | 'storage' | 'confirmation' | 'unsupported' | 'busy';
  constructor(reason: ReviewInboxError['reason']) {
    super('Não foi possível confirmar as revisões cifradas. Reabre a lista para verificar o estado guardado.');
    this.reason = reason;
  }
}
export interface ReviewInboxView {
  readonly uid: string;
  readonly revision: string | null;
  readonly items: readonly ReviewItem[];
  readonly legacy: Readonly<{digest: string; sourceCount: number}> | null;
  readonly legacyOrigins: readonly Readonly<{digest: string; local: boolean}>[];
}
export interface LegacyReviewPreview {readonly uid: string; readonly digest: string; readonly items: readonly ReviewItem[]}
interface LegacyImport {uid: string; at: number; sourceDigest: string; sourceRaw: string; idMap: Array<[string, string]>}
interface PendingLegacy {sourceDigest: string; sourceRaw: string}
interface RestoreReceipt {operationId: string; backupId: string; digest: string; at: number; added: number; copied: number; idMap: Array<[string, string]>}
interface Body {v: 2; uid: string; revision: string; items: ReviewItem[]; legacyImports: LegacyImport[]; pendingLegacy: PendingLegacy[]; restoreReceipts: RestoreReceipt[]; restoreHistory: RestoreReceipt[]}
type Draft = Omit<Body, 'v' | 'uid' | 'revision'>;
interface Baseline {uid: string; raw: string | null; legacyRaw: string | null; body: Body | null; store: ReviewInboxStore; storage: Pick<Storage, 'getItem'>}
export interface ReviewInboxDeps {
  store: ReviewInboxStore; legacyStorage: Pick<Storage, 'getItem'>; mutation?: PersonalMemoryMutationDeps;
  encrypt: typeof encryptMemoryFields; decrypt: typeof decryptMemoryEnvelope;
  exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>; id: () => string; now: () => number;
}
const MAX_ITEMS = 500, MAX_BYTES = 8_000_000, MAX_IMPORTS = 16, MAX_RECEIPTS = 64, MAX_HISTORY = 256;
export const REVIEW_INBOX_BACKUP_MAX_BYTES = 24_000_000;
const BACKUP_PLAIN_MAX = 16_000_000, BACKUP_FORMAT = 'mnemosyne.review-inbox-backup';
const baselines = new WeakMap<ReviewInboxView, Baseline>(), previews = new WeakMap<LegacyReviewPreview, {view: ReviewInboxView; sourceRaw: string}>();
const fail = (reason: ReviewInboxError['reason'] = 'invalid') => new ReviewInboxError(reason);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/');
const exact = (value: unknown, keys: string): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys);
const date = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const raw = (row: StoredReviewInbox | undefined) => row ? JSON.stringify(row) : null;
export const legacyReviewInboxKey = (uid: string) => `mnemosyne:review-inbox:v1:${uid}`;
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const event = 'mnemosyne:review-inbox-changed';
function notify(revision: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(event, {detail: revision}));
  if (typeof BroadcastChannel !== 'undefined') {const channel = new BroadcastChannel(event); channel.postMessage(revision); channel.close();}
}
export function observeReviewInbox(change: (revision?: string) => void) {
  const local = (value: Event) => change(value instanceof CustomEvent && uuid(value.detail) ? value.detail : undefined), other = () => change();
  window.addEventListener(event, local); window.addEventListener('storage', other); window.addEventListener('focus', other);
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(event); if (channel) channel.onmessage = value => change(uuid(value.data) ? value.data : undefined);
  return () => {window.removeEventListener(event, local); window.removeEventListener('storage', other); window.removeEventListener('focus', other); channel?.close();};
}
const defaults = (): ReviewInboxDeps => ({store: reviewInboxStore, legacyStorage: localStorage, encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope,
  id: () => crypto.randomUUID(), now: Date.now, exclusive: async (name, work) => {
    if (!navigator.locks) throw fail('unsupported');
    return navigator.locks.request(name, {mode: 'exclusive', ifAvailable: true}, lock => {if (!lock) throw fail('busy'); return work();});
  }});
function items(value: unknown): ReviewItem[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw fail();
  const ids = new Set<string>();
  for (const item of value) {
    if (!exact(item, 'completedCount,createdAt,dueAt,id,intervalDays,priority,question,sourceId,updatedAt') || !id(item.id) || !id(item.sourceId) || ids.has(item.id) ||
      typeof item.question !== 'string' || !item.question.trim() || item.question.length > 500 || ![1, 2, 3].includes(Number(item.priority)) || typeof item.priority !== 'number' ||
      !date(item.dueAt) || !date(item.createdAt) || !date(item.updatedAt) || typeof item.intervalDays !== 'number' || !Number.isFinite(item.intervalDays) || item.intervalDays < 0 ||
      !Number.isSafeInteger(item.completedCount) || Number(item.completedCount) < 0) throw fail();
    ids.add(item.id);
  }
  return structuredClone(value);
}
function envelope(value: unknown): EncryptedMemoryEnvelope {
  if (!exact(value, 'ct,iv,v') || !isEncryptedMemoryEnvelope(value)) throw fail(); return value;
}
async function body(value: unknown, uid: string, revision: string, guard: () => Promise<void>): Promise<Body> {
  const required = ['items', 'legacyImports', 'revision', 'uid', 'v'], optional = ['pendingLegacy', 'restoreReceipts', 'restoreHistory'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw fail();
  const row = value as Record<string, unknown>;
  if (row.v !== 2 || row.uid !== uid || row.revision !== revision || !Array.isArray(row.legacyImports) || row.legacyImports.length > MAX_IMPORTS) throw fail();
  const seen = new Set<string>();
  for (const entry of row.legacyImports) {
    if (!exact(entry, 'at,idMap,sourceDigest,sourceRaw,uid') || entry.uid !== uid || !date(entry.at) || typeof entry.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sourceDigest) ||
      typeof entry.sourceRaw !== 'string' || bytes(entry.sourceRaw) > MAX_BYTES || !Array.isArray(entry.idMap) || entry.idMap.length > MAX_ITEMS ||
      entry.idMap.some(row => !Array.isArray(row) || row.length !== 2 || !row.every(id)) || new Set(entry.idMap.map(row => row[0])).size !== entry.idMap.length) throw fail();
    const key = canonicalSyncState(entry); if (seen.has(key) || await hash(entry.sourceRaw) !== entry.sourceDigest) throw fail(); await guard(); envelope(JSON.parse(entry.sourceRaw)); seen.add(key);
  }
  const pending = row.pendingLegacy ?? []; if (!Array.isArray(pending) || pending.length > MAX_IMPORTS) throw fail(); const pendingSeen = new Set<string>();
  for (const entry of pending) {
    if (!exact(entry, 'sourceDigest,sourceRaw') || typeof entry.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sourceDigest) || pendingSeen.has(entry.sourceDigest) || typeof entry.sourceRaw !== 'string' || bytes(entry.sourceRaw) > MAX_BYTES || await hash(entry.sourceRaw) !== entry.sourceDigest) throw fail();
    await guard(); pendingSeen.add(entry.sourceDigest);
  }
  const receipts = parseReceipts(row.restoreReceipts ?? [], false), history = parseReceipts(row.restoreHistory ?? [], true);
  return {v: 2, uid, revision, items: items(row.items), legacyImports: structuredClone(row.legacyImports) as LegacyImport[], pendingLegacy: structuredClone(pending) as PendingLegacy[], restoreReceipts: receipts, restoreHistory: history};
}
function parseReceipts(value: unknown, historical: boolean): RestoreReceipt[] {
  if (!Array.isArray(value) || value.length > (historical ? MAX_HISTORY : MAX_RECEIPTS)) throw fail(); const seen = new Set<string>(), fileDigests = new Map<string, string>();
  for (const entry of value) {
    if (!exact(entry, 'added,at,backupId,copied,digest,idMap,operationId') || !uuid(entry.operationId) || !uuid(entry.backupId) || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest) || !date(entry.at) ||
      !Number.isSafeInteger(entry.added) || Number(entry.added) < 0 || Number(entry.added) > MAX_ITEMS || !Number.isSafeInteger(entry.copied) || Number(entry.copied) < 0 || Number(entry.copied) > Number(entry.added) ||
      !Array.isArray(entry.idMap) || entry.idMap.length > MAX_ITEMS || entry.idMap.some(row => !Array.isArray(row) || row.length !== 2 || !row.every(id)) || new Set(entry.idMap.map(row => row[0])).size !== entry.idMap.length) throw fail();
    const key = historical ? canonicalSyncState(entry) : entry.operationId; if (seen.has(key) || !historical && fileDigests.has(entry.backupId) && fileDigests.get(entry.backupId) !== entry.digest) throw fail();
    seen.add(key); fileDigests.set(entry.backupId, entry.digest);
  }
  return structuredClone(value);
}
async function legacySources(baseline: Baseline, guard: () => Promise<void>): Promise<PendingLegacy[]> {
  const sources = new Map((baseline.body?.pendingLegacy ?? []).map(entry => [entry.sourceDigest, entry]));
  if (baseline.legacyRaw !== null) {const digest = await hash(baseline.legacyRaw); await guard(); sources.delete(digest); const first = {sourceDigest: digest, sourceRaw: baseline.legacyRaw};
    const ordered = new Map([[digest, first], ...sources]); sources.clear(); for (const [key, entry] of ordered) sources.set(key, entry);}
  const assigned = new Set(baseline.body?.legacyImports.map(entry => entry.sourceDigest)); return [...sources.values()].filter(entry => !assigned.has(entry.sourceDigest));
}
async function view(baseline: Baseline, guard: () => Promise<void>): Promise<ReviewInboxView> {
  const sources = await legacySources(baseline, guard); await guard();
  const result: ReviewInboxView = Object.freeze({uid: baseline.uid, revision: baseline.body?.revision ?? null,
    items: Object.freeze((baseline.body?.items ?? []).map(item => Object.freeze({...item}))),
    legacy: sources.length ? Object.freeze({digest: sources[0].sourceDigest, sourceCount: sources.length}) : null,
    legacyOrigins: Object.freeze(sources.map(entry => Object.freeze({digest: entry.sourceDigest, local: entry.sourceRaw === baseline.legacyRaw})))});
  baselines.set(result, baseline); return result;
}
function baselineFor(uid: string, snapshot: ReviewInboxView, deps: ReviewInboxDeps) {
  const baseline = baselines.get(snapshot);
  if (!baseline || baseline.uid !== uid || snapshot.uid !== uid || baseline.store !== deps.store || baseline.storage !== deps.legacyStorage) throw fail('conflict'); return baseline;
}
function guards(uid: string, baseline: Baseline, scope: () => void, deps: ReviewInboxDeps) {
  const sync = () => {scope(); if (deps.legacyStorage.getItem(legacyReviewInboxKey(uid)) !== baseline.legacyRaw) throw fail('conflict');};
  const guard = async () => {sync(); const stored = await deps.store.get(uid); sync(); if (raw(stored) !== baseline.raw) throw fail('conflict');};
  return {sync, guard};
}
export async function loadReviewInbox(uid: string, outer: () => void = () => {}, deps = defaults()): Promise<ReviewInboxView> {
  return withPersonalMemoryMutation(uid, async context => {
    const scope = () => {outer(); context.assertCurrent();}; scope();
    const legacyRaw = deps.legacyStorage.getItem(legacyReviewInboxKey(uid)); if (legacyRaw !== null && bytes(legacyRaw) > MAX_BYTES) throw fail();
    const row = await deps.store.get(uid); scope(); const baseline: Baseline = {uid, raw: raw(row), legacyRaw, body: null, store: deps.store, storage: deps.legacyStorage};
    const {guard} = guards(uid, baseline, scope, deps); await guard();
    if (row) {
      if (!exact(row, 'enc,revision,uid,v') || row.v !== 2 || row.uid !== uid || !uuid(row.revision) || bytes(JSON.stringify(row)) > MAX_BYTES * 2) throw fail();
      const decoded = (await deps.decrypt(envelope(row.enc))).text; await guard(); if (bytes(decoded) > MAX_BYTES) throw fail();
      baseline.body = await body(JSON.parse(decoded), uid, row.revision, guard); await guard();
    }
    return view(baseline, guard);
  }, deps.mutation);
}
export async function previewLegacyReviewInbox(uid: string, snapshot: ReviewInboxView, outer: () => void = () => {}, deps = defaults()): Promise<LegacyReviewPreview> {
  if (!snapshot.legacy) throw fail('confirmation'); return previewReviewInboxLegacyOrigin(uid, snapshot, snapshot.legacy.digest, outer, deps);
}
export async function previewReviewInboxLegacyOrigin(uid: string, snapshot: ReviewInboxView, digest: string, outer: () => void = () => {}, deps = defaults()): Promise<LegacyReviewPreview> {
  const baseline = baselineFor(uid, snapshot, deps); if (!snapshot.legacyOrigins.some(entry => entry.digest === digest)) throw fail('confirmation');
  return withPersonalMemoryMutation(uid, async context => {
    const {guard} = guards(uid, baseline, () => {outer(); context.assertCurrent();}, deps); await guard();
    const source = (await legacySources(baseline, guard)).find(entry => entry.sourceDigest === digest); await guard(); if (!source) throw fail('confirmation');
    const decoded = (await deps.decrypt(envelope(JSON.parse(source.sourceRaw)))).text; await guard(); if (bytes(decoded) > MAX_BYTES) throw fail();
    const result: LegacyReviewPreview = Object.freeze({uid, digest, items: Object.freeze(items(JSON.parse(decoded)).map(item => Object.freeze(item)))});
    previews.set(result, {view: snapshot, sourceRaw: source.sourceRaw}); return result;
  }, deps.mutation);
}
function draft(baseline: Baseline): Draft {return structuredClone({items: baseline.body?.items ?? [], legacyImports: baseline.body?.legacyImports ?? [], pendingLegacy: baseline.body?.pendingLegacy ?? [], restoreReceipts: baseline.body?.restoreReceipts ?? [], restoreHistory: baseline.body?.restoreHistory ?? []});}
async function writeBody(uid: string, baseline: Baseline, proposal: Draft, scope: () => void, deps: ReviewInboxDeps) {
    const captured = structuredClone(proposal), {sync, guard} = guards(uid, baseline, scope, deps); await guard();
    const revision = deps.id(); if (!uuid(revision)) throw fail();
    const data = await body({v: 2, uid, revision, ...captured}, uid, revision, guard); await guard();
    const text = JSON.stringify(data); if (bytes(text) > MAX_BYTES) throw fail();
    const enc = envelope(await deps.encrypt({text})); await guard(); const roundtrip = (await deps.decrypt(enc)).text; await guard(); if (roundtrip !== text) throw fail('confirmation');
    const row: StoredReviewInbox = {v: 2, uid, revision, enc}; await deps.store.compareExchange(uid, baseline.raw, row, sync);
    const confirmed: Baseline = {...baseline, raw: JSON.stringify(row), body: structuredClone(data)}, after = guards(uid, confirmed, scope, deps).guard; await after();
    const result = await view(confirmed, after); await after(); notify(revision); return result;
}
async function persist(uid: string, snapshot: ReviewInboxView, next: ReviewItem[], imported: LegacyImport | null, outer: () => void, deps: ReviewInboxDeps) {
  const captured = items(next), baseline = baselineFor(uid, snapshot, deps), data = draft(baseline); data.items = captured;
  if (imported) {data.legacyImports.push(structuredClone(imported)); data.pendingLegacy = data.pendingLegacy.filter(entry => entry.sourceDigest !== imported.sourceDigest);}
  return withPersonalMemoryMutation(uid, context => deps.exclusive(`mnemosyne:review-inbox:${uid}`, () => writeBody(uid, baseline, data, () => {outer(); context.assertCurrent();}, deps)), deps.mutation);
}
export const saveReviewInbox = (uid: string, snapshot: ReviewInboxView, next: ReviewItem[], outer: () => void = () => {}, deps = defaults()) => persist(uid, snapshot, next, null, outer, deps);
export async function migrateLegacyReviewInbox(uid: string, preview: LegacyReviewPreview, confirmation: {ownerUid: string; digest: string; confirmed: true}, outer: () => void = () => {}, deps = defaults()) {
  const prepared = previews.get(preview), snapshot = prepared?.view; if (!prepared || !snapshot || preview.uid !== uid || confirmation?.confirmed !== true || confirmation.ownerUid !== uid || confirmation.digest !== preview.digest || !snapshot.legacyOrigins.some(entry => entry.digest === preview.digest)) throw fail('confirmation');
  baselineFor(uid, snapshot, deps); const {next, idMap} = mergeItems(snapshot.items, preview.items, deps);
  const at = deps.now(); if (!date(at)) throw fail();
  return persist(uid, snapshot, next, {uid, at, sourceDigest: preview.digest, sourceRaw: prepared.sourceRaw, idMap}, outer, deps);
}

export interface ReviewInboxBackupSource {readonly size: number; text: () => Promise<string>}
export interface ReviewInboxBackup {readonly text: string; readonly filename: string; readonly backupId: string; readonly digest: string; readonly exportedAt: number}
export interface ReviewInboxBackupChange {readonly action: 'add' | 'copy' | 'keep'; readonly incoming: Readonly<ReviewItem>; readonly current: Readonly<ReviewItem> | null; readonly targetId: string}
export interface ReviewInboxBackupPreview {
  readonly uid: string; readonly backupId: string; readonly digest: string; readonly operationId: string; readonly exportedAt: number;
  readonly sourceQuestions: number; readonly added: number; readonly copied: number; readonly afterCount: number; readonly pendingSources: number;
  readonly archiveCount: number; readonly alreadyApplied: boolean; readonly appliedAt: number | null; readonly changes: readonly ReviewInboxBackupChange[];
}
interface BackupPayload {v: 1; uid: string; backupId: string; exportedAt: number; root: Body | null; legacyRaw: string | null}
interface PreparedBackup {snapshot: ReviewInboxView; payload: BackupPayload; digest: string; operationId: string; proposal: Draft | null; receipt: RestoreReceipt}
const backupPreviews = new WeakMap<ReviewInboxBackupPreview, PreparedBackup>();
function mergeItems(current: readonly ReviewItem[], incoming: readonly ReviewItem[], deps: ReviewInboxDeps) {
  const next = items(current), source = items(incoming), reserved = new Set([...next, ...source].map(item => item.id)), byId = new Map(next.map(item => [item.id, item]));
  const idMap: Array<[string, string]> = [], changes: ReviewInboxBackupChange[] = []; let added = 0, copied = 0;
  for (const original of source) {
    const existing = byId.get(original.id);
    if (existing && canonicalSyncState(existing) === canonicalSyncState(original)) {idMap.push([original.id, original.id]); changes.push({action: 'keep', incoming: original, current: existing, targetId: original.id}); continue;}
    let imported = {...original};
    if (existing) {let fresh = ''; for (let attempt = 0; attempt < 20; attempt++) {const candidate = deps.id(); if (uuid(candidate) && !reserved.has(candidate)) {fresh = candidate; break;}}
      if (!fresh) throw fail(); imported = {...original, id: fresh}; copied++;
    }
    next.push(imported); byId.set(imported.id, imported); reserved.add(imported.id); idMap.push([original.id, imported.id]); added++;
    changes.push({action: existing ? 'copy' : 'add', incoming: original, current: existing ?? null, targetId: imported.id});
  }
  items(next); return {next, idMap, changes, added, copied};
}
const unique = <T>(entries: T[]): T[] => [...new Map(entries.map(entry => [canonicalSyncState(entry), entry])).values()];
async function backupPayload(uid: string, rawFile: string, guard: () => Promise<void>, deps: ReviewInboxDeps) {
  if (typeof rawFile !== 'string' || !rawFile || bytes(rawFile) > REVIEW_INBOX_BACKUP_MAX_BYTES) throw fail(); const wrapper: unknown = JSON.parse(rawFile.replace(/^\uFEFF/, ''));
  if (!exact(wrapper, 'enc,format,v') || wrapper.format !== BACKUP_FORMAT || wrapper.v !== 1) throw fail();
  const decoded = (await deps.decrypt(envelope(wrapper.enc))).text; await guard(); if (bytes(decoded) > BACKUP_PLAIN_MAX) throw fail();
  const payload: unknown = JSON.parse(decoded);
  if (!exact(payload, 'backupId,exportedAt,legacyRaw,root,uid,v') || payload.v !== 1 || payload.uid !== uid || !uuid(payload.backupId) || !date(payload.exportedAt) || payload.exportedAt < 0 ||
    payload.legacyRaw !== null && (typeof payload.legacyRaw !== 'string' || bytes(payload.legacyRaw) > MAX_BYTES)) throw fail();
  let root: Body | null = null;
  if (payload.root !== null) {
    if (!payload.root || typeof payload.root !== 'object' || !('revision' in payload.root) || !uuid(payload.root.revision) || bytes(JSON.stringify(payload.root)) > MAX_BYTES) throw fail();
    root = await body(payload.root, uid, payload.root.revision, guard); await guard();
  }
  const digest = await hash(canonicalSyncState(wrapper)); await guard();
  return {payload: {v: 1, uid, backupId: payload.backupId, exportedAt: payload.exportedAt, root, legacyRaw: payload.legacyRaw} as BackupPayload, digest};
}
export async function exportReviewInboxBackup(uid: string, snapshot: ReviewInboxView, outer: () => void = () => {}, deps = defaults()): Promise<ReviewInboxBackup> {
  const baseline = baselineFor(uid, snapshot, deps);
  return withPersonalMemoryMutation(uid, async context => {
    const {guard} = guards(uid, baseline, () => {outer(); context.assertCurrent();}, deps); await guard();
    const backupId = deps.id(), exportedAt = deps.now(); if (!uuid(backupId) || !date(exportedAt) || exportedAt < 0) throw fail();
    const payload: BackupPayload = {v: 1, uid, backupId, exportedAt, root: structuredClone(baseline.body), legacyRaw: baseline.legacyRaw}, text = JSON.stringify(payload);
    if (bytes(text) > BACKUP_PLAIN_MAX) throw fail(); const enc = envelope(await deps.encrypt({text})); await guard();
    if ((await deps.decrypt(enc)).text !== text) throw fail('confirmation'); await guard();
    const wrapper = {format: BACKUP_FORMAT, v: 1, enc}, result = JSON.stringify(wrapper, null, 2); if (bytes(result) > REVIEW_INBOX_BACKUP_MAX_BYTES) throw fail();
    const digest = await hash(canonicalSyncState(wrapper)); await guard();
    return Object.freeze({text: result, filename: `mnemosyne-review-inbox-${new Date(exportedAt).toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${backupId}.json`, backupId, digest, exportedAt});
  }, deps.mutation);
}
async function prepareParsedBackup(uid: string, snapshot: ReviewInboxView, payload: BackupPayload, digest: string, forceNew: boolean, guard: () => Promise<void>, deps: ReviewInboxDeps) {
  const baseline = baselineFor(uid, snapshot, deps), current = draft(baseline); await guard();
  if (current.restoreReceipts.some(receipt => receipt.backupId === payload.backupId && receipt.digest !== digest)) throw fail('confirmation');
  const known = [...current.restoreReceipts].reverse().find(receipt => receipt.backupId === payload.backupId && receipt.digest === digest);
  let receipt: RestoreReceipt, proposal: Draft | null = null, changes: ReviewInboxBackupChange[] = [], pendingSources: number, archiveCount: number;
  if (known && !forceNew) {receipt = structuredClone(known); pendingSources = (await legacySources(baseline, guard)).length; archiveCount = current.legacyImports.length;}
  else {
    const operationId = deps.id(), at = deps.now(); if (!uuid(operationId) || !date(at) || at < 0) throw fail();
    const merge = mergeItems(current.items, payload.root?.items ?? [], deps); changes = merge.changes;
    const legacyImports = unique([...current.legacyImports, ...(payload.root?.legacyImports ?? [])]);
    const pending = new Map<string, PendingLegacy>();
    for (const entry of [...current.pendingLegacy, ...(payload.root?.pendingLegacy ?? [])]) {const previous = pending.get(entry.sourceDigest); if (previous && previous.sourceRaw !== entry.sourceRaw) throw fail(); pending.set(entry.sourceDigest, structuredClone(entry));}
    if (payload.legacyRaw !== null) {const sourceDigest = await hash(payload.legacyRaw); await guard(); const previous = pending.get(sourceDigest); if (previous && previous.sourceRaw !== payload.legacyRaw) throw fail(); pending.set(sourceDigest, {sourceDigest, sourceRaw: payload.legacyRaw});}
    const assigned = new Set(legacyImports.map(entry => entry.sourceDigest)), pendingLegacy = [...pending.values()].filter(entry => !assigned.has(entry.sourceDigest));
    receipt = {operationId, backupId: payload.backupId, digest, at, added: merge.added, copied: merge.copied, idMap: merge.idMap};
    proposal = {items: merge.next, legacyImports, pendingLegacy, restoreReceipts: [...current.restoreReceipts, receipt], restoreHistory: unique([...current.restoreHistory, ...(payload.root?.restoreHistory ?? []), ...(payload.root?.restoreReceipts ?? [])])};
    const candidate = {v: 2, uid, revision: baseline.body?.revision ?? operationId, ...proposal}; if (bytes(JSON.stringify(candidate)) > MAX_BYTES) throw fail();
    await body(candidate, uid, candidate.revision, guard); await guard();
    const candidateBaseline: Baseline = {...baseline, body: candidate as Body}; pendingSources = (await legacySources(candidateBaseline, guard)).length; archiveCount = legacyImports.length;
  }
  await guard();
  const preview: ReviewInboxBackupPreview = Object.freeze({uid, backupId: payload.backupId, digest, operationId: receipt.operationId, exportedAt: payload.exportedAt,
    sourceQuestions: payload.root?.items.length ?? 0, added: receipt.added, copied: receipt.copied, afterCount: proposal?.items.length ?? current.items.length, pendingSources, archiveCount,
    alreadyApplied: proposal === null, appliedAt: proposal === null ? receipt.at : null, changes: Object.freeze(changes.map(change => Object.freeze({...change, incoming: Object.freeze({...change.incoming}), current: change.current ? Object.freeze({...change.current}) : null})))});
  backupPreviews.set(preview, {snapshot, payload: structuredClone(payload), digest, operationId: receipt.operationId, proposal: proposal ? structuredClone(proposal) : null, receipt: structuredClone(receipt)}); return preview;
}
export async function prepareReviewInboxBackup(uid: string, snapshot: ReviewInboxView, source: ReviewInboxBackupSource, outer: () => void = () => {}, deps = defaults()) {
  const baseline = baselineFor(uid, snapshot, deps), size = source.size, read = source.text.bind(source);
  if (!Number.isSafeInteger(size) || size < 1 || size > REVIEW_INBOX_BACKUP_MAX_BYTES) throw fail();
  return withPersonalMemoryMutation(uid, async context => {
    const {guard} = guards(uid, baseline, () => {outer(); context.assertCurrent();}, deps); await guard(); const text = await read(); await guard();
    const {payload, digest} = await backupPayload(uid, text, guard, deps); return prepareParsedBackup(uid, snapshot, payload, digest, false, guard, deps);
  }, deps.mutation);
}
export async function prepareRepeatedReviewInboxBackup(uid: string, snapshot: ReviewInboxView, preview: ReviewInboxBackupPreview, outer: () => void = () => {}, deps = defaults()) {
  const previous = backupPreviews.get(preview); if (!previous || preview.uid !== uid || !preview.alreadyApplied) throw fail('confirmation'); const baseline = baselineFor(uid, snapshot, deps);
  return withPersonalMemoryMutation(uid, async context => {
    const {guard} = guards(uid, baseline, () => {outer(); context.assertCurrent();}, deps); await guard(); return prepareParsedBackup(uid, snapshot, previous.payload, previous.digest, true, guard, deps);
  }, deps.mutation);
}
export async function restoreReviewInboxBackup(uid: string, preview: ReviewInboxBackupPreview, confirmation: {ownerUid: string; digest: string; confirmed: true}, outer: () => void = () => {}, deps = defaults()) {
  const prepared = backupPreviews.get(preview); if (!prepared || preview.uid !== uid || confirmation?.confirmed !== true || confirmation.ownerUid !== uid || confirmation.digest !== prepared.digest) throw fail('confirmation');
  return withPersonalMemoryMutation(uid, context => deps.exclusive(`mnemosyne:review-inbox:${uid}`, async () => {
    const scope = () => {outer(); context.assertCurrent();}; scope(); const current = await loadReviewInbox(uid, scope, deps); scope(); const currentBaseline = baselineFor(uid, current, deps);
    const known = currentBaseline.body?.restoreReceipts.find(receipt => receipt.operationId === prepared.operationId);
    if (known) {if (known.backupId !== prepared.payload.backupId || known.digest !== prepared.digest) throw fail('confirmation'); return {view: current, receipt: structuredClone(known), confirmed: true};}
    if (!prepared.proposal) throw fail('confirmation'); const baseline = baselineFor(uid, prepared.snapshot, deps);
    const {guard} = guards(uid, baseline, scope, deps); await guard(); const proposal = structuredClone(prepared.proposal), at = deps.now(); if (!date(at) || at < 0) throw fail();
    const receipt = {...prepared.receipt, at}; proposal.restoreReceipts = proposal.restoreReceipts.map(row => row.operationId === receipt.operationId ? receipt : row);
    const result = await writeBody(uid, baseline, proposal, scope, deps); scope(); return {view: result, receipt: structuredClone(receipt), confirmed: false};
  }), deps.mutation);
}
