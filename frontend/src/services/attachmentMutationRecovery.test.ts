import { beforeEach, expect, it, vi } from 'vitest';
import { associateSessionAttachments, recoverSessionAttachmentMutation, cancelPendingSessionAttachmentMutation, type AttachmentMutationRecoveryDeps } from './attachmentMutationRecovery';
import type { AttachmentMutationInput } from '../../../functions/src/attachmentMutationContract';
import type { MemoryPermission } from './localAiConfig';
vi.mock('../firebase', () => ({ default: {}, auth: { currentUser: null }, db: {} }));
const gate = vi.hoisted(() => ({ writes: true }));
vi.mock('../config/releaseGates', () => ({ get ATTACHMENT_WRITES_ENABLED() { return gate.writes; } }));
beforeEach(() => { gate.writes = true; });
const id = '11111111-1111-4111-8111-111111111111'; const op = '22222222-2222-4222-8222-222222222222';
const state = { uid: 'alice', teamId: null, text: '', title: null, enc: { v: 1, iv: 'synthetic', ct: 'synthetic-cipher' }, updatedAt: 10, attachments: null };
const input = { uid: 'alice', sessionId: 'note', action: 'add' as const, ids: [id] };
const committed = (request: AttachmentMutationInput) => ({ operationId: request.operationId, sessionId: request.sessionId, status: 'committed', updatedAt: 11, versionId: request.operationId, changed: true });
async function fixture() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const context = { uid: 'alice' as string | null, ready: true, policy: 'allow-cloud' as MemoryPermission, generation: 0 };
  const stored = new Map<string, string>(); let changed = () => undefined;
  const deps: AttachmentMutationRecoveryDeps = {
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    uid: () => context.uid, ready: () => context.ready, policy: () => context.policy, generation: () => context.generation,
    subscribe: callback => { changed = callback; return vi.fn(); }, id: vi.fn(() => op), exclusive: async (_name, work) => work(),
    loadSession: vi.fn(async () => state),
    encrypt: async ({ text }) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
      return { v: 1, iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(encrypted))) };
    },
    decrypt: async envelope => ({ text: new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM',
      iv: Uint8Array.from(atob(envelope.iv), char => char.charCodeAt(0)) }, key, Uint8Array.from(atob(envelope.ct), char => char.charCodeAt(0)))) }),
    mutate: vi.fn(async request => committed(request)), status: vi.fn(async operationId => ({ operationId, status: 'unknown' })),
    cancel: vi.fn(async request => ({ operationId: request.operationId, sessionId: request.sessionId, status: 'cancelled' })),
    forgetUploads: vi.fn(async () => undefined),
  };
  return { deps, stored, context, changed: () => changed() };
}
it('denies never-cloud, unknown and declined confirmation before fresh reads, checkpoint access or remote calls', async () => {
  for (const policy of ['never-cloud', 'unknown', 'confirm-cloud']) {
    const f = await fixture(); f.context.policy = policy as MemoryPermission;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(associateSessionAttachments(input, f.deps)).rejects.toThrow();
    expect(f.deps.loadSession).not.toHaveBeenCalled(); expect(f.deps.mutate).not.toHaveBeenCalled(); expect(f.stored.size).toBe(0);
    confirm.mockRestore();
  }
});
it('writes and verifies an encrypted journal before the first request, then clears only after a bound committed acknowledgment', async () => {
  const f = await fixture();
  vi.mocked(f.deps.mutate).mockImplementation(async request => {
    expect(f.stored.size).toBe(1); const raw = [...f.stored.values()][0];
    expect(raw.includes(id)).toBe(false); expect(raw.includes(op)).toBe(false); expect(raw.includes('synthetic-cipher')).toBe(false);
    expect(request.expectedRevision).toBe(10); expect(request.expectedStateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(request).sort()).toEqual(['action', 'expectedRevision', 'expectedStateDigest', 'ids', 'operationId', 'sessionId']);
    return committed(request);
  });
  const reply = await associateSessionAttachments(input, f.deps);
  expect(reply.status).toBe('committed'); expect(f.stored.size).toBe(0); expect(f.deps.status).not.toHaveBeenCalled();
});
it('recovers a lost response from the durable receipt without another mutation or a fresh CAS', async () => {
  const f = await fixture(); let first!: AttachmentMutationInput;
  vi.mocked(f.deps.mutate).mockImplementation(async request => { first = request; throw Error('synthetic sensitive provider detail'); });
  await expect(associateSessionAttachments(input, f.deps)).rejects.toThrow('Não foi possível confirmar os anexos.'); expect(f.stored.size).toBe(1);
  vi.mocked(f.deps.status).mockResolvedValue(committed(first));
  expect(await recoverSessionAttachmentMutation('alice', 'note', f.deps)).toEqual(committed(first));
  expect(f.deps.mutate).toHaveBeenCalledOnce(); expect(f.deps.loadSession).toHaveBeenCalledOnce(); expect(f.deps.id).toHaveBeenCalledOnce(); expect(f.stored.size).toBe(0);
});
it('unknown status retries the exact request; conflicting intent cannot overwrite a pending operation', async () => {
  const f = await fixture(); vi.mocked(f.deps.mutate).mockRejectedValue(Error('synthetic'));
  await expect(associateSessionAttachments(input, f.deps)).rejects.toThrow(); const first = vi.mocked(f.deps.mutate).mock.calls[0][0]; const journal = [...f.stored.values()][0];
  await expect(associateSessionAttachments({ ...input, action: 'remove' }, f.deps)).rejects.toMatchObject({ reason: 'pending' });
  expect([...f.stored.values()][0]).toBe(journal); expect(f.deps.status).not.toHaveBeenCalled();
  vi.mocked(f.deps.mutate).mockResolvedValue(committed(first)); await recoverSessionAttachmentMutation('alice', 'note', f.deps);
  expect(f.deps.mutate).toHaveBeenLastCalledWith(first); expect(f.deps.loadSession).toHaveBeenCalledOnce(); expect(f.stored.size).toBe(0);
});
it('cancellation obtains a bound permanent server outcome; a concurrent commit is shown as committed', async () => {
  for (const lateCommit of [false, true]) {
    const f = await fixture(); vi.mocked(f.deps.mutate).mockRejectedValue(Error('synthetic'));
    await expect(associateSessionAttachments(input, f.deps)).rejects.toThrow();
    const first = vi.mocked(f.deps.mutate).mock.calls[0][0];
    if (lateCommit) vi.mocked(f.deps.cancel).mockResolvedValue(committed(first));
    const outcome = await cancelPendingSessionAttachmentMutation('alice', 'note', f.deps);
    expect(outcome.status).toBe(lateCommit ? 'committed' : 'cancelled'); expect(f.deps.cancel).toHaveBeenCalledExactlyOnceWith(first); expect(f.stored.size).toBe(0);
  }
});
it('closed gates permit receipt recovery and cancellation but never replay an unknown mutation', async () => {
  for (const known of [false, true]) {
    gate.writes = true; const f = await fixture(); vi.mocked(f.deps.mutate).mockRejectedValue(Error('synthetic'));
    await expect(associateSessionAttachments(input, f.deps)).rejects.toThrow(); const first = vi.mocked(f.deps.mutate).mock.calls[0][0];
    gate.writes = false;
    if (known) {
      vi.mocked(f.deps.status).mockResolvedValue(committed(first)); expect((await recoverSessionAttachmentMutation('alice', 'note', f.deps)).status).toBe('committed');
    } else {
      await expect(recoverSessionAttachmentMutation('alice', 'note', f.deps)).rejects.toMatchObject({ reason: 'pending' }); expect(f.stored.size).toBe(1);
      expect((await cancelPendingSessionAttachmentMutation('alice', 'note', f.deps)).status).toBe('cancelled');
    }
    expect(f.deps.mutate).toHaveBeenCalledOnce(); expect(f.stored.size).toBe(0);
  }
});
it('late acknowledgments after lock, membership generation, policy change or logout-return preserve the journal and suppress success', async () => {
  for (const change of ['vault', 'team', 'policy', 'logout-return']) {
    const f = await fixture();
    vi.mocked(f.deps.mutate).mockImplementation(async request => {
      if (change === 'vault') f.context.ready = false;
      if (change === 'team') f.context.generation++;
      if (change === 'policy') f.context.policy = 'never-cloud';
      if (change === 'logout-return') { f.context.uid = null; f.changed(); f.context.uid = 'alice'; }
      f.changed(); return committed(request);
    });
    await expect(associateSessionAttachments(input, f.deps)).rejects.toMatchObject({ reason: 'access-changed' }); expect(f.stored.size).toBe(1);
  }
});
it('corrupt/rebound checkpoints and forged receipts remain pending; unavailable local storage fails before mutation', async () => {
  for (const scenario of ['corrupt', 'rebound', 'forged']) {
    const f = await fixture(); vi.mocked(f.deps.mutate).mockRejectedValue(Error('synthetic')); await expect(associateSessionAttachments(input, f.deps)).rejects.toThrow();
    const first = vi.mocked(f.deps.mutate).mock.calls[0][0]; const storageKey = [...f.stored.keys()][0];
    if (scenario === 'corrupt') f.stored.set(storageKey, '{broken');
    if (scenario === 'rebound') f.stored.set(storageKey, JSON.stringify(await f.deps.encrypt({ text: JSON.stringify({ v: 1, uid: 'bob', sessionId: 'note', request: first }) })));
    if (scenario === 'forged') vi.mocked(f.deps.status).mockResolvedValue({ ...committed(first), sessionId: 'other-note' });
    await expect(recoverSessionAttachmentMutation('alice', 'note', f.deps)).rejects.toThrow(); expect(f.stored.size).toBe(1); expect(f.deps.mutate).toHaveBeenCalledOnce();
  }
  const f = await fixture(); f.deps.storage.setItem = () => { throw Error('quota'); };
  await expect(associateSessionAttachments(input, f.deps)).rejects.toMatchObject({ reason: 'storage' }); expect(f.deps.mutate).not.toHaveBeenCalled();
});
it('keeps the association journal when upload-checkpoint cleanup fails, then recovers without another remote mutation', async () => {
  const f = await fixture(); vi.mocked(f.deps.forgetUploads).mockRejectedValueOnce(Error('synthetic storage failure'));
  await expect(associateSessionAttachments(input, f.deps)).rejects.toThrow(); expect(f.stored.size).toBe(1);
  const first = vi.mocked(f.deps.mutate).mock.calls[0][0]; vi.mocked(f.deps.status).mockResolvedValue(committed(first));
  await recoverSessionAttachmentMutation('alice', 'note', f.deps);
  expect(f.deps.mutate).toHaveBeenCalledOnce(); expect(f.deps.forgetUploads).toHaveBeenCalledTimes(2); expect(f.stored.size).toBe(0);
});
