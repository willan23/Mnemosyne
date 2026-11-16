import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const observers = vi.hoisted(() => ({ personal: new Set<() => void>(), team: new Set<() => void>() }));
vi.mock('./memoryCrypto', () => ({ onMemoryCryptoChanged: (callback: () => void) => { observers.personal.add(callback); return () => observers.personal.delete(callback); } }));
vi.mock('./teamVault', () => ({ onTeamKeyChanged: (callback: () => void) => { observers.team.add(callback); return () => observers.team.delete(callback); } }));
import { captureSemanticCandidates, semanticCandidateEligibility, semanticCandidateCohort } from './semanticCandidateCapture';
import { CURRENT_EMBEDDING_SPACE } from './embeddingModel';
import type { SessionData } from '../hooks/useSessions';
const row = (id: string, fields: Partial<SessionData> = {}): SessionData => ({ id, uid: 'alice', text: 'Synthetic content', timestamp: 1, updatedAt: 1,
  embedding: [1, 0], embeddingModel: CURRENT_EMBEDDING_SPACE, position: [1, 2, 3], semanticClusterId: 'synthetic-cluster', ...fields });
const eligible = semanticCandidateEligibility('alice');
beforeEach(() => { expect(observers.personal.size).toBe(0); expect(observers.team.size).toBe(0); });
afterEach(() => { vi.restoreAllMocks(); expect(observers.personal.size).toBe(0); expect(observers.team.size).toBe(0); });
it('captures only semantic metadata and independently copies bounded vectors/positions without reading content', async () => {
  const source = row('a'); for (const name of ['text', 'title', 'attachments', 'enc', 'connections', 'tags']) Object.defineProperty(source, name, { get() { throw Error('Unnecessary content read'); } });
  const [captured] = await captureSemanticCandidates([source], { eligible });
  expect(captured.embedding).toEqual([1, 0]); expect(captured.position).toEqual([1, 2, 3]);
  source.embedding![0] = 99; source.position![0] = 99; expect(captured.embedding).toEqual([1, 0]); expect(captured.position).toEqual([1, 2, 3]);
  for (const name of ['text', 'title', 'attachments', 'enc', 'connections', 'tags']) expect(Object.hasOwn(captured, name)).toBe(false);
});
it('checks ACL before reading a candidate vector and excludes self/ambiguous/shared/locked/deleted/foreign records', async () => {
  const denied = [{ uid: 'bob' }, { teamId: 'team' }, { teamScopeAmbiguous: true }, { sharedWithIds: ['other'] }, { encLocked: true }, { deletedAt: 1 }].map((fields, index) => {
    const value = row('denied' + index, fields); Object.defineProperty(value, 'embedding', { get() { throw Error('Denied vector read'); } }); return value;
  });
  const result = await captureSemanticCandidates([...denied, row('self'), row('allowed')], { eligible: semanticCandidateEligibility('alice', undefined, 'self') });
  expect(result.map(row => row.id)).toEqual(['allowed']);
});
it('keeps only the exact selected team and permits its other active authors', async () => {
  const result = await captureSemanticCandidates([row('own'), row('other', { teamId: 'other' }), row('team', { teamId: 'selected', uid: 'bob' }), row('ambiguous', { teamId: 'selected', teamScopeAmbiguous: true })], { eligible: semanticCandidateEligibility('alice', 'selected') });
  expect(result.map(row => row.id)).toEqual(['team']);
});
it('counts legacy/incompatible records without reading their vector, and does not copy oversized current vectors', async () => {
  const legacy = row('legacy', { embeddingModel: undefined }); Object.defineProperty(legacy, 'embedding', { get() { throw Error('Legacy vector read'); } });
  const result = await captureSemanticCandidates([legacy, row('oversized', { embedding: new Array(4097).fill(1) })], { eligible });
  expect(result.map(row => row.id)).toEqual(['legacy', 'oversized']); expect(result.every(row => row.embedding === undefined)).toBe(true);
});
it('yields every 128 raw records, including denied ones, and checks context before reading the next batch', async () => {
  let current = true; const yieldTask = vi.fn(async () => { current = false; }); const guard = () => { if (!current) throw Error('Synthetic scope retired'); };
  const rows = Array.from({ length: 300 }, (_, i) => row('m' + i, { uid: 'bob' }));
  Object.defineProperty(rows[128], 'uid', { get() { throw Error('Second batch read'); } });
  await expect(captureSemanticCandidates(rows, { eligible, assertCurrent: guard, yieldTask })).rejects.toThrow('scope retired'); expect(yieldTask).toHaveBeenCalledOnce();
});
it.each(['personal', 'team'] as const)('refuses an entire capture when the %s key retires between batches', async kind => {
  const rows = Array.from({ length: 129 }, (_, i) => row('m' + i));
  await expect(captureSemanticCandidates(rows, { eligible, yieldTask: async () => { for (const callback of observers[kind]) callback(); } })).rejects.toThrow('semantic_write_unavailable');
});
it('rejects duplicate eligible IDs and honors an already-aborted signal without reading source values', async () => {
  await expect(captureSemanticCandidates([row('a'), row('a')], { eligible })).rejects.toThrow();
  const controller = new AbortController(); controller.abort(); const source = { [Symbol.iterator]() { throw Error('Source read'); } };
  await expect(captureSemanticCandidates(source, { eligible, signal: controller.signal })).rejects.toThrow('semantic_write_unavailable');
});
it('reuses a captured base for growing capsule prefixes without copying or exposing later additions', async () => {
  const captured = await captureSemanticCandidates([row('base')], { eligible }), first = semanticCandidateCohort(captured);
  captured.push(row('new')); const second = semanticCandidateCohort(captured); captured.push(row('later'));
  expect([...first].map(row => row.id)).toEqual(['base']); expect([...second].map(row => row.id)).toEqual(['base', 'new']); expect([...first][0]).toBe(captured[0]);
});
it('processes a 10,000-record cohort with bounded task yields and no plaintext reads', async () => {
  const rows = Array.from({ length: 10000 }, (_, i) => row('m' + i)); for (const value of rows) Object.defineProperty(value, 'text', { get() { throw Error('Plaintext read'); } });
  const yieldTask = vi.fn(async () => {}), captured = await captureSemanticCandidates(rows, { eligible, yieldTask });
  expect(captured).toHaveLength(10000); expect(yieldTask).toHaveBeenCalledTimes(78); expect(captured[9999].embedding).not.toBe(rows[9999].embedding);
});
