import { expect, it, vi } from 'vitest';
import { downloadRecoveredAttachmentDraft, type AttachmentDraftRecoveryDeps } from './attachmentDraftRecovery';
import { attachmentKeyWrapper, sealAttachment } from './attachmentCrypto';
import { attachmentBytesDigest, saveUploadCheckpoint } from './attachmentUploadCheckpoint';
import type { StoredAttachmentUpload } from './attachmentUploadJournalStore';
vi.mock('../firebase', () => ({ auth: { currentUser: null } }));
const id = '11111111-1111-4111-8111-111111111111';
async function fixture(team = false) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const wrapper = attachmentKeyWrapper(key); const state = { uid: 'alice' as string | null, ready: true, generation: 0 };
  const bytes = new TextEncoder().encode('Synthetic recoverable file');
  const scope = team ? { kind: 'team' as const, teamId: 'synthetic-team', keyEpoch: 2, keyId: id } : { kind: 'personal' as const, uid: 'alice' };
  const sealed = await sealAttachment({ id, uid: 'alice', scope, bytes, name: 'synthetic-draft.md', mimeType: 'text/markdown' }, wrapper, () => undefined);
  const records = new Map<string, StoredAttachmentUpload>(); let changed = () => undefined;
  const stop = vi.fn(); const deliver = vi.fn(async () => undefined);
  const journalKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const deps: AttachmentDraftRecoveryDeps = { uid: () => state.uid, ready: () => state.ready, generation: () => state.generation,
    subscribe: callback => { changed = callback; return stop; }, localWrapper: vi.fn(() => wrapper), deliver, exclusive: async (_name, work) => work(),
    journal: { get: async (_uid, id) => records.get(id), put: async (_uid, id, record) => { records.set(id, record); }, remove: vi.fn(), ids: async () => [id] },
    encryptJournal: async ({ text }) => {
      const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, journalKey, new TextEncoder().encode(text));
      return { v: 1, iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(ct))) };
    }, decryptJournal: async envelope => ({ text: new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM',
      iv: Uint8Array.from(atob(envelope.iv), char => char.charCodeAt(0)) }, journalKey, Uint8Array.from(atob(envelope.ct), char => char.charCodeAt(0)))) }) };
  const checkpoint = { v: 1 as const, uid: 'alice', header: sealed.header, name: 'synthetic-draft.md', phase: 'posting' as const, bytesDigest: await attachmentBytesDigest(sealed.bytes) };
  await saveUploadCheckpoint(checkpoint, new Uint8Array(sealed.bytes).buffer, deps, () => undefined);
  return { deps, state, sealed, checkpoint, records, stop, deliver, changed: () => changed() };
}
it('recovers original content/name locally, preserves the journal and zeros the delivered buffer even after a download failure', async () => {
  const value = await fixture(); const confirm = vi.spyOn(window, 'confirm'); const fetch = vi.spyOn(globalThis, 'fetch');
  let delivered!: Uint8Array;
  value.deps.deliver = vi.fn(async (bytes, metadata, guard, signal) => {
    guard(); delivered = bytes; expect(signal.aborted).toBe(false);
    expect(new TextDecoder().decode(bytes)).toBe('Synthetic recoverable file'); expect(metadata.name).toBe('synthetic-draft.md');
    expect(metadata.delivery).toBe('download-only');
  });
  await downloadRecoveredAttachmentDraft('alice', id, value.deps);
  expect(delivered.every(byte => byte === 0)).toBe(true); expect(value.records.size).toBe(1); expect(value.deps.journal.remove).not.toHaveBeenCalled();
  value.deps.deliver = vi.fn(async bytes => { delivered = bytes; throw Error('synthetic download failure'); });
  await expect(downloadRecoveredAttachmentDraft('alice', id, value.deps)).rejects.toThrow('rascunho cifrado foi conservado');
  expect(delivered.every(byte => byte === 0)).toBe(true); expect(value.records.size).toBe(1);
  expect(confirm).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); confirm.mockRestore(); fetch.mockRestore();
});
it('denies modified bytes, foreign accounts and a locked vault before exposing plaintext', async () => {
  for (const mode of ['modified', 'foreign', 'locked']) {
    const value = await fixture();
    if (mode === 'modified') { const bytes = new Uint8Array(value.records.get(id)!.bytes!); bytes[bytes.length - 1] ^= 1; }
    if (mode === 'foreign') value.state.uid = 'bob';
    if (mode === 'locked') value.state.ready = false;
    await expect(downloadRecoveredAttachmentDraft('alice', id, value.deps)).rejects.toThrow();
    expect(value.deps.localWrapper).not.toHaveBeenCalled(); expect(value.deliver).not.toHaveBeenCalled(); expect(value.records.size).toBe(1);
  }
});
it('uses only a locally available historical team key; a missing key never falls back to cloud', async () => {
  const value = await fixture(true); await downloadRecoveredAttachmentDraft('alice', id, value.deps);
  expect(value.deps.localWrapper).toHaveBeenCalledWith(value.sealed.header.scope); expect(value.deliver).toHaveBeenCalledOnce();
  value.deps.localWrapper = vi.fn(() => { throw Error('synthetic missing historical key'); }); value.deliver.mockClear();
  await expect(downloadRecoveredAttachmentDraft('alice', id, value.deps)).rejects.toThrow(); expect(value.deliver).not.toHaveBeenCalled(); expect(value.records.size).toBe(1);
});
it('suppresses plaintext after context changes during decryption and refuses ready records without local bytes', async () => {
  const value = await fixture(); const unwrap = value.deps.localWrapper(value.sealed.header.scope).unwrap;
  value.deps.localWrapper = () => ({ wrap: async () => { throw Error(); }, unwrap: async (...args) => { const raw = await unwrap(...args); value.state.generation++; value.changed(); return raw; } });
  await expect(downloadRecoveredAttachmentDraft('alice', id, value.deps)).rejects.toThrow(); expect(value.deliver).not.toHaveBeenCalled(); expect(value.stop).toHaveBeenCalled();
  const ready = await fixture(); await saveUploadCheckpoint({ ...ready.checkpoint, phase: 'ready' }, null, ready.deps, () => undefined);
  await expect(downloadRecoveredAttachmentDraft('alice', id, ready.deps)).rejects.toThrow(); expect(ready.deliver).not.toHaveBeenCalled(); expect(ready.records.size).toBe(1);
});
