import { beforeEach, expect, it, vi } from 'vitest';
import { cancelRecoverableAttachmentUpload, listRecoverableAttachmentUploads, resumeEncryptedAttachmentUpload, uploadEncryptedAttachment, preparePersonalAttachment, validatePreparedPersonalAttachment, forgetPreparedPersonalAttachment, cancelPreparedPersonalAttachment, type AttachmentUploadClientDeps } from './attachmentUploadClient';
import { attachmentBytesDigest } from './attachmentUploadCheckpoint';
import type { StoredAttachmentUpload } from './attachmentUploadJournalStore';
import { attachmentKeyWrapper, openAttachment } from './attachmentCrypto';
import { encodeAttachmentHeader, type AttachmentEnvelopeHeader } from '../../../functions/src/attachmentEnvelope';
import type { MemoryPermission } from './localAiConfig';
const gate = vi.hoisted(() => ({ writes: true }));
vi.mock('../config/releaseGates', () => ({ get ATTACHMENT_WRITES_ENABLED() { return gate.writes; } }));
vi.mock('../firebase', () => ({ default: {}, auth: { currentUser: null }, db: {} }));
vi.mock('./teamKeyAccess', () => ({ unlockTeamKey: vi.fn() }));
vi.mock('./teamsService', () => ({ parseTeam: vi.fn() }));
vi.mock('./teamVault', () => ({ getTeamKeyCacheGeneration: () => 0, onTeamKeyChanged: vi.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const now = 1_800_000_000_000;
const inputBytes = new TextEncoder().encode('Synthetic attachment content, not a real memory');
function file(name = 'synthetic-private.md', mime = 'text/markdown') {
  const value = new File([new Uint8Array(inputBytes).buffer], name, { type: mime });
  Object.defineProperty(value, 'arrayBuffer', { value: async () => new Uint8Array(inputBytes).buffer });
  return value;
}
async function formBytes(form: FormData) {
  const payload = form.get('file') as File;
  return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(payload);
  }));
}
function grant(header: AttachmentEnvelopeHeader) {
  const bytes = encodeAttachmentHeader(header).byteLength + header.cipherBytes;
  return { id, status: 'reserved', bytes, bucket: 'synthetic-private', expiresAt: now + 120_000,
    url: 'https://storage.googleapis.com/synthetic-private/', fields: { key: `quarantine/alice/${id}`, 'Content-Type': 'application/octet-stream',
      policy: btoa(JSON.stringify({ expiration: new Date(now + 120_000).toISOString(), conditions: [['content-length-range', bytes, bytes]] })),
      'x-goog-algorithm': 'GOOG4-RSA-SHA256', 'x-goog-credential': 'synthetic', 'x-goog-date': 'synthetic', 'x-goog-signature': 'synthetic' } };
}
async function setup() {
  const wrapper = attachmentKeyWrapper(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  const state = { uid: 'alice' as string | null, ready: true, policy: 'allow-cloud' as MemoryPermission, generation: 0 };
  let changed = () => undefined;
  const stop = vi.fn();
  const journals = new Map<string, StoredAttachmentUpload>();
  const journalKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const remote = async (header: AttachmentEnvelopeHeader, status: string) => ({ id: header.id, digest: await attachmentBytesDigest(encodeAttachmentHeader(header)),
    bytes: encodeAttachmentHeader(header).length + header.cipherBytes, status, expiresAt: status === 'unknown' ? null : now + 900000,
    postExpiresAt: status === 'unknown' ? null : now + 120000, retryAt: status === 'verifying' ? now + 180000 : null });
  const deps: AttachmentUploadClientDeps = { uid: () => state.uid, ready: () => state.ready, policy: () => state.policy,
    generation: () => state.generation, now: () => now, id: () => id, subscribe: callback => { changed = callback; return stop; },
    prepareScope: vi.fn(async () => ({ scope: { kind: 'personal', uid: 'alice' } as const, wrapper })),
    begin: vi.fn(async header => grant(header)), post: vi.fn(async () => ({ ok: true })),
    complete: vi.fn(async () => ({ id, status: 'ready' })), inspect: vi.fn(async header => remote(header, 'unknown')),
    cancelPending: vi.fn(async header => ({ id, digest: await attachmentBytesDigest(encodeAttachmentHeader(header)), status: 'cancelled' })),
    exclusive: async (_name, work) => work(),
    journal: { get: async (_uid, id) => journals.get(id), put: async (_uid, id, value) => { journals.set(id, { envelope: { ...value.envelope }, bytes: value.bytes?.slice(0) ?? null }); },
      remove: async (_uid, id) => { journals.delete(id); }, ids: async () => [...journals.keys()] },
    encryptJournal: async ({ text }) => {
      const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, journalKey, new TextEncoder().encode(text));
      return { v: 1, iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(ct))) };
    },
    decryptJournal: async envelope => ({ text: new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM',
      iv: Uint8Array.from(atob(envelope.iv), char => char.charCodeAt(0)) }, journalKey, Uint8Array.from(atob(envelope.ct), char => char.charCodeAt(0)))) }),
  };
  return { deps, wrapper, state, stop, journals, remote, changed: () => changed() };
}
beforeEach(() => { vi.restoreAllMocks(); gate.writes = true; });
it('local whole-plan preparation fixes IDs and persists encrypted originals without consent or any remote calls, even with never-cloud and a closed upload gate',async()=>{
  const f=await setup();f.state.policy='never-cloud';gate.writes=false;const confirm=vi.spyOn(window,'confirm');
  const prepared=await preparePersonalAttachment({uid:'alice',id,file:file()},()=>{},f.deps);expect(prepared.id).toBe(id);expect(f.journals.size).toBe(1);
  await validatePreparedPersonalAttachment('alice',prepared,()=>{},f.deps);expect(confirm).not.toHaveBeenCalled();
  for(const operation of [f.deps.begin,f.deps.inspect,f.deps.post,f.deps.complete,f.deps.cancelPending])expect(operation).not.toHaveBeenCalled();
  const opened=await openAttachment(new Uint8Array(f.journals.get(id)!.bytes!),{uid:'alice',id,scope:prepared.header.scope},f.wrapper,()=>{});expect([...opened.bytes]).toEqual([...inputBytes]);opened.bytes.fill(0);
  await expect(preparePersonalAttachment({uid:'alice',id,file:file()},()=>{},f.deps)).rejects.toThrow();expect(f.journals.size).toBe(1);
});
it('a parent manifest prevents swapped headers, digests and corrupted encrypted bytes before any upload status or reservation request',async()=>{
  for(const mode of ['header','digest','bytes','outer']){
    const f=await setup();const original=await preparePersonalAttachment({uid:'alice',id,file:file()},()=>{},f.deps);const expected=structuredClone(original);
    if(mode==='header')expected.header.iv='D'.repeat(16);if(mode==='digest')expected.bytesDigest='f'.repeat(64);if(mode==='bytes')new Uint8Array(f.journals.get(id)!.bytes!)[500]^=1;
    await expect(resumeEncryptedAttachmentUpload('alice',id,f.deps,()=>{if(mode==='outer')throw Error('Synthetic parent changed');},expected)).rejects.toThrow();
    for(const operation of [f.deps.inspect,f.deps.begin,f.deps.post,f.deps.complete])expect(operation).not.toHaveBeenCalled();expect(f.journals.size).toBe(1);
  }
});
it('terminal parent cleanup is resumable and preserves a swapped checkpoint; cancellation keeps ready uploads available locally',async()=>{
  const f=await setup();const prepared=await preparePersonalAttachment({uid:'alice',id,file:file()},()=>{},f.deps);
  await expect(forgetPreparedPersonalAttachment('alice',prepared,()=>{},f.deps)).rejects.toThrow();expect(f.journals.size).toBe(1);
  await resumeEncryptedAttachmentUpload('alice',id,f.deps,()=>{},prepared);vi.mocked(f.deps.inspect).mockClear();
  await cancelPreparedPersonalAttachment('alice',prepared,()=>{},f.deps);expect(f.journals.size).toBe(1);expect(f.deps.cancelPending).not.toHaveBeenCalled();
  await expect(forgetPreparedPersonalAttachment('alice',{...prepared,bytesDigest:'f'.repeat(64)},()=>{},f.deps)).rejects.toThrow();expect(f.journals.size).toBe(1);
  await forgetPreparedPersonalAttachment('alice',prepared,()=>{},f.deps);await forgetPreparedPersonalAttachment('alice',prepared,()=>{},f.deps);expect(f.journals.size).toBe(0);
});
it('recovery consent reports the encrypted file size before any possible resubmission and denies a declined confirmation', async () => {
  const fixture = await setup(); vi.mocked(fixture.deps.begin).mockRejectedValueOnce(Error('synthetic lost reservation reply'));
  await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, fixture.deps)).rejects.toThrow();
  const bytes = fixture.journals.get(id)!.bytes!.byteLength; fixture.state.policy = 'confirm-cloud';
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false); vi.mocked(fixture.deps.inspect).mockClear();
  await expect(resumeEncryptedAttachmentUpload('alice', id, fixture.deps)).rejects.toThrow();
  expect(confirm).toHaveBeenCalledOnce(); expect(confirm.mock.calls[0][0]).toContain(`Tamanho aproximado: ${bytes} bytes`);
  expect(fixture.deps.inspect).not.toHaveBeenCalled(); expect(fixture.deps.post).not.toHaveBeenCalled(); expect(fixture.journals.size).toBe(1);
});
it('denies never-cloud, unknown policy and declined consent before scope reads or any request', async () => {
  for (const policy of ['never-cloud', 'unknown-policy', 'confirm-cloud']) {
    const fixture = await setup(); fixture.state.policy = policy as MemoryPermission; vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, fixture.deps)).rejects.toThrow('Não foi possível enviar o anexo cifrado.');
    for (const operation of [fixture.deps.prepareScope, fixture.deps.begin, fixture.deps.post, fixture.deps.complete, fixture.deps.inspect, fixture.deps.cancelPending]) expect(operation).not.toHaveBeenCalled();
    expect(fixture.stop).toHaveBeenCalledOnce();
  }
});
it('sends only a bound encrypted envelope and accepts success only after the ready acknowledgment', async () => {
  const fixture = await setup(); const progress = vi.fn(); let header!: AttachmentEnvelopeHeader;
  vi.mocked(fixture.deps.begin).mockImplementation(async value => { header = value; expect(fixture.journals.size).toBe(1);
    expect(JSON.stringify(fixture.journals.get(id)!.envelope).includes(file().name)).toBe(false); return grant(value); });
  vi.mocked(fixture.deps.post).mockImplementation(async (_url, form, signal) => {
    expect(signal.aborted).toBe(false); const payload = form.get('file') as File;
    expect(payload.name).toBe('attachment.bin'); expect(payload.type).toBe('application/octet-stream');
    const ciphertext = await formBytes(form); const display = new TextDecoder().decode(ciphertext);
    expect(display.includes(file().name)).toBe(false); expect(display.includes(new TextDecoder().decode(inputBytes))).toBe(false);
    const opened = await openAttachment(ciphertext, { id, uid: 'alice', scope: header.scope }, fixture.wrapper, () => undefined);
    expect(new TextDecoder().decode(opened.bytes) === new TextDecoder().decode(inputBytes)).toBe(true);
    return { ok: true };
  });
  vi.mocked(fixture.deps.complete).mockImplementation(async () => { expect(progress.mock.calls.some(([value]) => value.state === 'success')).toBe(false); return { id, status: 'ready' }; });
  const result = await uploadEncryptedAttachment({ file: file(), uid: 'alice' }, progress, fixture.deps);
  expect(result.url).toBe(`mnemosyne-attachment:v1:${id}`); expect(result.name).toBe('Anexo cifrado');
  expect(fixture.deps.cancelPending).not.toHaveBeenCalled(); expect(progress).toHaveBeenLastCalledWith({ progress: 100, state: 'success' }); expect(fixture.stop).toHaveBeenCalledOnce();
  expect(fixture.journals.get(id)!.bytes).toBeNull(); // Ready remains recoverable until association, without retaining the local encrypted file copy.
});
it('refuses forged host, expiry, byte policy, path and redirect fields before posting and preserves the same checkpoint for explicit recovery/cancellation', async () => {
  const alterations = [(value: ReturnType<typeof grant>) => ({ ...value, url: 'https://attacker.example/synthetic-private/' }),
    (value: ReturnType<typeof grant>) => ({ ...value, expiresAt: now - 1 }),
    (value: ReturnType<typeof grant>) => ({ ...value, fields: { ...value.fields, key: 'quarantine/bob/other' } }),
    (value: ReturnType<typeof grant>) => ({ ...value, fields: { ...value.fields, success_action_redirect: 'https://attacker.example' } }),
    (value: ReturnType<typeof grant>) => ({ ...value, fields: { ...value.fields, policy: btoa(JSON.stringify({ expiration: new Date(value.expiresAt).toISOString(), conditions: [['content-length-range', 1, value.bytes]] })) } })];
  for (const alter of alterations) {
    const fixture = await setup(); vi.mocked(fixture.deps.begin).mockImplementation(async header => alter(grant(header)));
    await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, fixture.deps)).rejects.toThrow('Não foi possível enviar o anexo cifrado.');
    expect(fixture.deps.post).not.toHaveBeenCalled(); expect(fixture.deps.complete).not.toHaveBeenCalled(); expect(fixture.deps.cancelPending).not.toHaveBeenCalled(); expect(fixture.journals.size).toBe(1);
  }
});
it('aborts changed vault/team/policy contexts and ignores a late ACK without showing success', async () => {
  for (const change of ['vault', 'team', 'policy', 'logout-return']) {
    const fixture = await setup(); const progress = vi.fn();
    vi.mocked(fixture.deps.complete).mockImplementation(async () => {
      if (change === 'vault') fixture.state.ready = false;
      if (change === 'team') fixture.state.generation++;
      if (change === 'policy') fixture.state.policy = 'never-cloud';
      if (change === 'logout-return') { fixture.state.uid = null; fixture.changed(); fixture.state.uid = 'alice'; }
      fixture.changed(); return { id, status: 'ready' };
    });
    await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, progress, fixture.deps)).rejects.toThrow('Não foi possível enviar o anexo cifrado.');
    expect(progress.mock.calls.some(([value]) => value.state === 'success')).toBe(false); expect(fixture.deps.cancelPending).not.toHaveBeenCalled(); expect(fixture.journals.size).toBe(1); expect(fixture.stop).toHaveBeenCalledOnce();
  }
});
it('refuses locked/missing accounts and mismatched file content before reserving; reports fixed errors on lost ACK or POST failure', async () => {
  for (const mode of ['locked', 'logout', 'spoof', 'post', 'ack']) {
    const fixture = await setup(); if (mode === 'locked') fixture.state.ready = false; if (mode === 'logout') fixture.state.uid = null;
    if (mode === 'post') vi.mocked(fixture.deps.post).mockResolvedValue({ ok: false });
    if (mode === 'ack') vi.mocked(fixture.deps.complete).mockRejectedValue(Error('synthetic sensitive provider detail'));
    const pending = uploadEncryptedAttachment({ file: mode === 'spoof' ? file('synthetic.png', 'image/png') : file(), uid: 'alice' }, undefined, fixture.deps);
    await expect(pending).rejects.toThrow('Não foi possível enviar o anexo cifrado.');
    if (['locked', 'logout', 'spoof'].includes(mode)) expect(fixture.deps.begin).not.toHaveBeenCalled();
    else { expect(fixture.deps.cancelPending).not.toHaveBeenCalled(); expect(fixture.journals.size).toBe(1); }
    expect(fixture.stop).toHaveBeenCalledOnce();
  }
});
it('recovers a lost ready ACK using the exact header without another file, reservation or POST', async () => {
  const f = await setup(); vi.mocked(f.deps.complete).mockRejectedValue(Error('synthetic lost ACK'));
  await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, f.deps)).rejects.toThrow();
  const header = vi.mocked(f.deps.begin).mock.calls[0][0];
  vi.mocked(f.deps.inspect).mockImplementation(async value => { expect(value).toEqual(header); return f.remote(value, 'ready'); });
  const outcome = await resumeEncryptedAttachmentUpload('alice', id, f.deps); expect(outcome.status).toBe('ready');
  expect(f.deps.begin).toHaveBeenCalledOnce(); expect(f.deps.post).toHaveBeenCalledOnce(); expect(f.deps.prepareScope).toHaveBeenCalledOnce();
  expect(f.journals.get(id)!.bytes).toBeNull(); expect(f.journals.size).toBe(1);
});
it('recovers a lost begin response from stored ciphertext, while a POST already attempted is never replayed', async () => {
  const f = await setup(); vi.mocked(f.deps.begin).mockRejectedValueOnce(Error('synthetic lost begin'));
  await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, f.deps)).rejects.toThrow();
  const header = vi.mocked(f.deps.begin).mock.calls[0][0]; const originalBytes = f.journals.get(id)!.bytes!.slice(0);
  vi.mocked(f.deps.inspect).mockImplementation(value => f.remote(value, 'reserved')); vi.mocked(f.deps.post).mockRejectedValueOnce(Error('synthetic lost POST'));
  await expect(resumeEncryptedAttachmentUpload('alice', id, f.deps)).rejects.toThrow();
  expect(vi.mocked(f.deps.begin).mock.calls[1][0]).toEqual(header); expect(f.journals.get(id)!.bytes).toEqual(originalBytes);
  vi.mocked(f.deps.complete).mockResolvedValue({ id, status: 'ready' });
  expect((await resumeEncryptedAttachmentUpload('alice', id, f.deps)).status).toBe('ready'); expect(f.deps.post).toHaveBeenCalledOnce(); expect(f.deps.begin).toHaveBeenCalledTimes(2);
});
it('verifying, expiry and forged registry replies preserve the checkpoint without POST replay or success', async () => {
  for (const scenario of ['verifying', 'expired', 'forged']) {
    const f = await setup(); vi.mocked(f.deps.complete).mockRejectedValue(Error('synthetic'));
    await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, f.deps)).rejects.toThrow();
    vi.mocked(f.deps.inspect).mockImplementation(async header => {
      const value = await f.remote(header, scenario === 'forged' ? 'ready' : scenario);
      if (scenario === 'forged') return { ...value, digest: 'a'.repeat(64) };
      if (scenario === 'expired') return { ...value, expiresAt: now - 1 }; return value;
    });
    await expect(resumeEncryptedAttachmentUpload('alice', id, f.deps)).rejects.toMatchObject({ reason: scenario === 'forged' ? 'pending' : scenario });
    expect(f.deps.post).toHaveBeenCalledOnce(); expect(f.journals.get(id)!.bytes).not.toBeNull();
  }
});
it('tampered ciphertext or transplanted journal fails before any recovery request, and storage failure prevents the initial reservation', async () => {
  for (const scenario of ['bytes', 'journal']) {
    const f = await setup(); vi.mocked(f.deps.begin).mockRejectedValue(Error('synthetic'));
    await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, f.deps)).rejects.toThrow();
    const stored = f.journals.get(id)!;
    if (scenario === 'bytes') new Uint8Array(stored.bytes!)[stored.bytes!.byteLength - 1] ^= 1;
    else {
      const fields = JSON.parse((await f.deps.decryptJournal(stored.envelope)).text); fields.uid = 'bob';
      stored.envelope = await f.deps.encryptJournal({ text: JSON.stringify(fields) });
    }
    vi.mocked(f.deps.inspect).mockClear(); await expect(resumeEncryptedAttachmentUpload('alice', id, f.deps)).rejects.toThrow();
    expect(f.deps.inspect).not.toHaveBeenCalled(); expect(f.journals.size).toBe(1);
  }
  const f = await setup(); f.deps.journal.put = async () => { throw Error('quota'); };
  await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, f.deps)).rejects.toThrow(); expect(f.deps.begin).not.toHaveBeenCalled(); expect(f.deps.inspect).not.toHaveBeenCalled();
});
it('closed write gates allow ready recovery and bound cancellation but no reservation or finalizer retry', async () => {
  for (const ready of [false, true]) {
    gate.writes = true; const f = await setup(); vi.mocked(f.deps.begin).mockRejectedValue(Error('synthetic'));
    await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, f.deps)).rejects.toThrow(); gate.writes = false;
    if (ready) vi.mocked(f.deps.inspect).mockImplementation(header => f.remote(header, 'ready'));
    if (ready) expect((await resumeEncryptedAttachmentUpload('alice', id, f.deps)).status).toBe('ready');
    else {
      await expect(resumeEncryptedAttachmentUpload('alice', id, f.deps)).rejects.toMatchObject({ reason: 'pending' });
      expect((await cancelRecoverableAttachmentUpload('alice', id, f.deps)).status).toBe('cancelled'); expect(f.journals.size).toBe(0);
    }
    expect(f.deps.begin).toHaveBeenCalledOnce(); expect(f.deps.post).not.toHaveBeenCalled(); expect(f.deps.complete).not.toHaveBeenCalled();
  }
});
it('a concurrent ready result is recovered rather than labelled cancelled, and local inventory never sends a request', async () => {
  const f = await setup(); await uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, f.deps);
  const calls = vi.mocked(f.deps.inspect).mock.calls.length; f.state.policy = 'never-cloud';
  const inventory = await listRecoverableAttachmentUploads('alice', undefined, f.deps); expect(inventory).toEqual({ items: [{ id, name: file().name, phase: 'ready' }], unreadableCount: 0, nextAfterId: null });
  expect(vi.mocked(f.deps.inspect).mock.calls.length).toBe(calls);
  await expect(resumeEncryptedAttachmentUpload('alice', id, f.deps)).rejects.toThrow(); expect(vi.mocked(f.deps.inspect).mock.calls.length).toBe(calls);
  f.state.policy = 'allow-cloud'; vi.mocked(f.deps.cancelPending).mockImplementation(async header => ({ id, digest: await attachmentBytesDigest(encodeAttachmentHeader(header)), status: 'ready' }));
  expect((await cancelRecoverableAttachmentUpload('alice', id, f.deps)).status).toBe('ready'); expect(f.journals.size).toBe(1);
});
it('unsupported or busy Web Locks fail before scope reads or reservation and do not create an unprotected checkpoint', async () => {
  const f = await setup(); f.deps.exclusive = async () => { throw Error('unsupported or busy'); };
  await expect(uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, f.deps)).rejects.toThrow();
  expect(f.deps.prepareScope).not.toHaveBeenCalled(); expect(f.deps.begin).not.toHaveBeenCalled(); expect(f.deps.inspect).not.toHaveBeenCalled(); expect(f.journals.size).toBe(0);
});
it('a corrupt local checkpoint is preserved without hiding valid files, but context loss aborts the entire inventory', async () => {
  const f = await setup(); await uploadEncryptedAttachment({ file: file(), uid: 'alice' }, undefined, f.deps);
  const other = '33333333-3333-4333-8333-333333333333'; f.journals.set(other, f.journals.get(id)!); // An ID transplant cannot be opened as another checkpoint.
  f.state.policy = 'never-cloud'; const calls = vi.mocked(f.deps.inspect).mock.calls.length;
  const inventory = await listRecoverableAttachmentUploads('alice', undefined, f.deps);
  expect(inventory.items.map(item => item.id)).toEqual([id]); expect(inventory.unreadableCount).toBe(1); expect(f.journals.size).toBe(2);
  expect(vi.mocked(f.deps.inspect).mock.calls.length).toBe(calls);
  const decrypt = f.deps.decryptJournal; f.deps.decryptJournal = async envelope => { const value = await decrypt(envelope); f.state.ready = false; f.changed(); return value; };
  await expect(listRecoverableAttachmentUploads('alice', undefined, f.deps)).rejects.toThrow(); expect(f.journals.size).toBe(2);
});
