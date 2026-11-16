import { decryptMemoryEnvelope, encryptMemoryFields, isEncryptedMemoryEnvelope } from './memoryCrypto';
import { withPersonalMemoryMutation, type PersonalMemoryMutationDeps } from './personalMemoryMutation';
import { localMemoryActivityStore, type MemoryActivityStore, type StoredMemoryActivity } from './localMemoryActivityStore';

export const LOCAL_ACTIVITY_MAX_EVENTS = 200;
export const LOCAL_ACTIVITY_RETENTION_MS = 30 * 86_400_000;
const MAX_BYTES = 200_000;
export type LocalMemoryActivity = { id: string; kind: 'retrieve'; operation: 'search'; at: number; resultCount: number }
  | { id: string; kind: 'index'; at: number; changed: number; removed: number; indexed: number };
export interface LocalMemoryActivityDeps {
  store: MemoryActivityStore; mutation?: PersonalMemoryMutationDeps;
  encrypt: typeof encryptMemoryFields; decrypt: typeof decryptMemoryEnvelope; now: () => number; id: () => string;
}
interface Body { v: 1; uid: string; revision: string; reset: string; events: LocalMemoryActivity[] }
const fail = () => new Error('local_memory_activity_unavailable');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const exact = (value: unknown, keys: string): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys;
const time = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 8.64e15;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000;
const defaults = (): LocalMemoryActivityDeps => ({ store: localMemoryActivityStore, encrypt: encryptMemoryFields,
  decrypt: decryptMemoryEnvelope, now: Date.now, id: () => crypto.randomUUID() });
function events(value: unknown): LocalMemoryActivity[] {
  if (!Array.isArray(value) || value.length > LOCAL_ACTIVITY_MAX_EVENTS) throw fail();
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || !uuid(row.id) || ids.has(row.id) || !time(row.at)) throw fail();
    if (row.kind === 'retrieve') {
      if (!exact(row, 'at,id,kind,operation,resultCount') || row.operation !== 'search' || !count(row.resultCount)) throw fail();
    } else if (row.kind === 'index') {
      if (!exact(row, 'at,changed,id,indexed,kind,removed') || !count(row.changed) || !count(row.removed) || !count(row.indexed)) throw fail();
    } else throw fail();
    ids.add(row.id);
  }
  return structuredClone(value);
}
const raw = (row: StoredMemoryActivity | undefined) => row ? JSON.stringify(row) : null;
async function read(uid: string, guard: () => void, deps: LocalMemoryActivityDeps) {
  const stored = await deps.store.get(uid); guard();
  if (!stored) return { stored, body: { v: 1 as const, uid, revision: '', reset: 'initial', events: [] as LocalMemoryActivity[] } };
  if (!exact(stored, 'enc,reset,revision,uid,v') || stored.v !== 1 || stored.uid !== uid || !uuid(stored.revision) ||
    stored.reset !== 'initial' && !uuid(stored.reset) || !exact(stored.enc, 'ct,iv,v') || !isEncryptedMemoryEnvelope(stored.enc) || JSON.stringify(stored).length > MAX_BYTES * 2) throw fail();
  const plain = await deps.decrypt(stored.enc); guard();
  if (new TextEncoder().encode(plain.text).length > MAX_BYTES) throw fail();
  const data: unknown = JSON.parse(plain.text);
  if (!exact(data, 'events,reset,revision,uid,v') || data.v !== 1 || data.uid !== uid || data.revision !== stored.revision || data.reset !== stored.reset) throw fail();
  return { stored, body: { v: 1 as const, uid, revision: stored.revision, reset: stored.reset, events: events(data.events) } };
}
function retained(rows: LocalMemoryActivity[], now: number) {
  if (!time(now)) throw fail();
  return rows.filter(row => row.at >= now - LOCAL_ACTIVITY_RETENTION_MS)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-LOCAL_ACTIVITY_MAX_EVENTS);
}
async function operate(uid: string, mode: 'append' | 'load' | 'clear', input: LocalMemoryActivity[], injected?: LocalMemoryActivityDeps) {
  const deps = injected ?? defaults(), captured = events(input);
  return withPersonalMemoryMutation(uid, async context => {
    const guard = context.assertCurrent;
    let reset: string | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      const prior = await read(uid, guard, deps); guard();
      if (reset !== undefined && reset !== prior.body.reset) throw fail(); // A manual clear fences old pending appends.
      reset = prior.body.reset;
      const now = deps.now(), existing = retained(prior.body.events, now);
      let next = existing;
      if (mode === 'clear') next = [];
      else if (mode === 'append') {
        const byId = new Map(existing.map(row => [row.id, row]));
        for (const row of captured) {
          if (row.at > now || row.at < now - LOCAL_ACTIVITY_RETENTION_MS) throw fail();
          const old = byId.get(row.id);
          if (old && JSON.stringify(old) !== JSON.stringify(row)) throw fail();
          byId.set(row.id, row);
        }
        next = retained([...byId.values()], now);
      }
      if (mode !== 'clear' && JSON.stringify(next) === JSON.stringify(prior.body.events)) return structuredClone(next);
      const revision = deps.id(); if (!uuid(revision)) throw fail();
      const body: Body = { v: 1, uid, revision, reset: mode === 'clear' ? revision : reset, events: next };
      const enc = await deps.encrypt({ text: JSON.stringify(body) }); guard();
      if (!exact(enc, 'ct,iv,v') || !isEncryptedMemoryEnvelope(enc)) throw fail();
      const stored: StoredMemoryActivity = { v: 1, uid, revision, reset: body.reset, enc };
      if (JSON.stringify(stored).length > MAX_BYTES * 2) throw fail();
      const committed = await deps.store.compareExchange(uid, raw(prior.stored), stored, guard); guard();
      if (committed) return structuredClone(next);
    }
    throw fail();
  }, deps.mutation).catch(() => { throw fail(); });
}

/** Metadata-only device journal; never accepts a query, document ID or vector. */
export const appendLocalMemoryActivity = (uid: string, rows: LocalMemoryActivity[], deps?: LocalMemoryActivityDeps) => operate(uid, 'append', rows, deps);
export const loadLocalMemoryActivity = (uid: string, deps?: LocalMemoryActivityDeps) => operate(uid, 'load', [], deps);
export const clearLocalMemoryActivity = (uid: string, deps?: LocalMemoryActivityDeps) => operate(uid, 'clear', [], deps);
export async function exportLocalMemoryActivity(uid: string, deps?: LocalMemoryActivityDeps): Promise<string> {
  const rows = await loadLocalMemoryActivity(uid, deps);
  return JSON.stringify({ format: 'mnemosyne.local-memory-activity', v: 1, events: rows }, null, 2);
}
