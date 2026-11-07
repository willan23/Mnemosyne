import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../firebase', () => ({default: {}, db: {}, auth: {}}));
import { cancelPendingClipCapture, clipCaptureCheckpointKey, persistClippedMemory, recoverPendingClipCapture, type ClipCaptureDeps } from './clipCaptureService';
import { buildEncryptedMemoryFields, decryptMemoryEnvelope, encryptMemoryFields, setMemoryCryptoMnemonic } from './memoryCrypto';
import { clippedMemoryRequestBytes, type ClippedMemoryInput } from '../../../functions/src/clippedMemoryContract';
const words = ['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
const id = '11111111-1111-4111-8111-111111111111';
const clip = {title: 'Synthetic clip', text: 'Synthetic captured text', url: 'https://example.test/synthetic'};
async function result(request: ClippedMemoryInput, status = 'committed') {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clippedMemoryRequestBytes(request))));
  return {sessionId: request.sessionId, digest: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''), status, createdAt: status === 'unknown' ? null : 1000};
}
function fixture() {
  const storage = new Map<string, string>();
  const state = {uid: 'alice', ready: true, enabled: true, listener: () => undefined as void};
  const deps: ClipCaptureDeps = {createEnabled: () => state.enabled, storage: {getItem: key => storage.get(key) ?? null, setItem: (key, raw) => {storage.set(key, raw);}, removeItem: key => {storage.delete(key);}},
    mutation: {uid: () => state.uid, ready: () => state.ready, subscribe: callback => {state.listener = callback; return vi.fn();}},
    id: vi.fn(() => id), exclusive: async (_name, work) => work(), prepare: vi.fn(buildEncryptedMemoryFields),
    encryptJournal: vi.fn(encryptMemoryFields), decryptJournal: vi.fn(decryptMemoryEnvelope),
    call: vi.fn(async (mode, request) => result(request, mode === 'status' ? 'unknown' : mode === 'cancel' ? 'cancelled' : 'committed'))};
  return {deps, state, storage};
}
const start = (deps: ClipCaptureDeps, prepared?: () => void) => persistClippedMemory('alice', clip, prepared, deps);
beforeEach(() => {vi.clearAllMocks(); setMemoryCryptoMnemonic(words);});
afterEach(() => setMemoryCryptoMnemonic(null));
it('persists/reads back real encrypted journal before clearing the incoming queue or sending only bounded ciphertext', async () => {
  const {deps, storage} = fixture(); const prepared = vi.fn(() => expect(storage.size).toBe(1));
  vi.mocked(deps.call).mockImplementation(async (mode, request) => {
    expect(prepared).toHaveBeenCalledOnce(); expect(storage.size).toBe(1);
    expect(JSON.stringify(request)).not.toContain('Synthetic'); expect([...storage.values()][0]).not.toContain('Synthetic');
    expect((await decryptMemoryEnvelope(request.enc)).text).toContain('Synthetic captured text');
    return result(request, mode === 'status' ? 'unknown' : 'committed');
  });
  await expect(start(deps, prepared)).resolves.toBe(id); expect(storage.size).toBe(0); expect(deps.call).toHaveBeenCalledTimes(2);
});
it('recovers a lost acknowledgement from a receipt with the exact ID/ciphertext, no second create and no repeated preparation', async () => {
  const {deps, storage} = fixture(); let saved!: ClippedMemoryInput;
  vi.mocked(deps.call).mockImplementation(async (mode, request) => {saved = request; if (mode === 'create') throw new Error('Synthetic lost ACK'); return result(request, 'unknown');});
  await expect(start(deps)).rejects.toThrow(); expect(storage.size).toBe(1);
  const raw = [...storage.values()][0]; expect(raw).not.toContain(id); expect(raw).not.toContain('alice');
  await expect(start(deps)).rejects.toMatchObject({reason: 'pending'}); expect(deps.prepare).toHaveBeenCalledOnce();
  vi.mocked(deps.call).mockImplementation(async (mode, request) => {expect(mode).toBe('status'); expect(request).toEqual(saved); return result(request);});
  await expect(recoverPendingClipCapture('alice', deps)).resolves.toMatchObject({status: 'committed', sessionId: id});
  expect(storage.size).toBe(0); expect(deps.prepare).toHaveBeenCalledOnce(); expect(deps.encryptJournal).toHaveBeenCalledOnce(); expect(deps.id).toHaveBeenCalledOnce();
});
it('unknown status retries only the original request; cancellation confirms a prior commit or serializes one cancellation', async () => {
  for (const committed of [false, true]) {
    const {deps, storage} = fixture(); vi.mocked(deps.call).mockRejectedValueOnce(new Error('Synthetic failed status')); await expect(start(deps)).rejects.toThrow();
    vi.mocked(deps.call).mockClear(); vi.mocked(deps.call).mockImplementation(async (mode, request) => result(request, mode === 'status' ? committed ? 'committed' : 'unknown' : 'cancelled'));
    expect((await cancelPendingClipCapture('alice', deps)).status).toBe(committed ? 'committed' : 'cancelled');
    expect(deps.call).toHaveBeenCalledTimes(committed ? 1 : 2); expect(storage.size).toBe(0);
  }
  const {deps} = fixture(); vi.mocked(deps.call).mockRejectedValueOnce(new Error('Synthetic failed status')); await expect(start(deps)).rejects.toThrow();
  vi.mocked(deps.call).mockClear(); await expect(recoverPendingClipCapture('alice', deps)).resolves.toMatchObject({status: 'committed'});
  expect(vi.mocked(deps.call).mock.calls.map(([mode]) => mode)).toEqual(['status','create']); expect(deps.id).toHaveBeenCalledOnce();
});
it.each(['write','readback','exclusive','owner','locked','empty'] as const)('fails before outbound calls and queue removal when %s is invalid', async mode => {
  const {deps, state, storage} = fixture(); const prepared = vi.fn();
  if (mode === 'write') deps.storage.setItem = () => {throw new Error('Synthetic storage failure');};
  if (mode === 'readback') deps.storage.setItem = () => undefined;
  if (mode === 'exclusive') deps.exclusive = async () => {throw new Error('Synthetic busy');};
  if (mode === 'owner') state.uid = 'bob'; if (mode === 'locked') state.ready = false;
  await expect(persistClippedMemory('alice', mode === 'empty' ? {title: '', text: '', url: ''} : clip, prepared, deps)).rejects.toThrow();
  expect(deps.call).not.toHaveBeenCalled(); expect(prepared).not.toHaveBeenCalled(); expect(storage.size).toBe(0);
});
it.each(['prepare','response'] as const)('latches observed account/vault changes during %s and preserves an already staged journal', async phase => {
  for (const mode of ['account','vault']) {
    const {deps, state, storage} = fixture();
    const change = () => {if (mode === 'account') {state.uid = 'bob'; state.listener(); state.uid = 'alice';} else {state.ready = false; state.listener(); state.ready = true;}};
    if (phase === 'prepare') deps.prepare = async (...args) => {const fields = await buildEncryptedMemoryFields(...args); change(); return fields;};
    else vi.mocked(deps.call).mockImplementation(async (kind, request) => {if (kind === 'create') change(); return result(request, kind === 'status' ? 'unknown' : 'committed');});
    await expect(start(deps)).rejects.toThrow(); expect(storage.size).toBe(phase === 'prepare' ? 0 : 1);
    if (phase === 'prepare') expect(deps.call).not.toHaveBeenCalled();
  }
});
it('refuses corrupted and transplanted encrypted checkpoints before status and retains them for manual recovery', async () => {
  const {deps, state, storage} = fixture(); vi.mocked(deps.call).mockRejectedValueOnce(new Error('Synthetic status failure')); await expect(start(deps)).rejects.toThrow();
  const raw = [...storage.values()][0]; vi.mocked(deps.call).mockClear(); storage.set(clipCaptureCheckpointKey('alice'), raw.slice(0,-8));
  await expect(recoverPendingClipCapture('alice', deps)).rejects.toMatchObject({reason: 'checkpoint'}); expect(deps.call).not.toHaveBeenCalled();
  storage.clear(); storage.set(clipCaptureCheckpointKey('bob'), raw); state.uid = 'bob';
  await expect(recoverPendingClipCapture('bob', deps)).rejects.toMatchObject({reason: 'checkpoint'}); expect(deps.call).not.toHaveBeenCalled(); expect(storage.size).toBe(1);
});
it('closed creation gates deny new/unknown captures but allow receipt confirmation and cancellation', async () => {
  const closed = fixture(); closed.state.enabled = false; await expect(start(closed.deps)).rejects.toMatchObject({reason: 'unavailable'}); expect(closed.deps.prepare).not.toHaveBeenCalled();
  const {deps, state, storage} = fixture(); vi.mocked(deps.call).mockRejectedValueOnce(new Error('Synthetic lost status')); await expect(start(deps)).rejects.toThrow();
  state.enabled = false; vi.mocked(deps.call).mockClear();
  await expect(recoverPendingClipCapture('alice', deps)).rejects.toMatchObject({reason: 'pending'}); expect(deps.call).toHaveBeenCalledTimes(1); expect(storage.size).toBe(1);
  expect((await cancelPendingClipCapture('alice', deps)).status).toBe('cancelled'); expect(storage.size).toBe(0);
});
it('retains the checkpoint on forged/unknown success and on cleanup failure, without blindly repeating a committed creation', async () => {
  const {deps, storage} = fixture(); vi.mocked(deps.call).mockRejectedValueOnce(new Error('Synthetic failure')); await expect(start(deps)).rejects.toThrow();
  vi.mocked(deps.call).mockImplementation(async (_mode, request) => ({...await result(request), digest: 'f'.repeat(64)}));
  await expect(recoverPendingClipCapture('alice', deps)).rejects.toMatchObject({reason: 'pending'}); expect(storage.size).toBe(1);
  vi.mocked(deps.call).mockImplementation(async (_mode, request) => result(request));
  const remove = deps.storage.removeItem; deps.storage.removeItem = () => {throw new Error('Synthetic cleanup failure');};
  await expect(recoverPendingClipCapture('alice', deps)).rejects.toMatchObject({reason: 'storage'}); expect(storage.size).toBe(1);
  deps.storage.removeItem = remove; await recoverPendingClipCapture('alice', deps); expect(storage.size).toBe(0);
});
