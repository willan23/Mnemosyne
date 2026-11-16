import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const sdk = vi.hoisted(() => ({ auth: { currentUser: { uid: 'alice' } as { uid: string } | null }, observers: new Set<(user: { uid: string } | null) => void>(), call: vi.fn() }));
vi.mock('../firebase', () => ({ default: { options: { projectId: 'demo-mnemosyne-rules' } }, auth: sdk.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, observer: (user: { uid: string } | null) => void) => { sdk.observers.add(observer); return () => { sdk.observers.delete(observer); }; } }));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: () => sdk.call }));
import { callPublicCapsule, createPublicCapsuleService, PublicCapsuleError, revokePublicCapsule } from './publicCapsuleService';
import { publicCapsuleSourceBytes, type PublicCapsuleSource } from '../../../functions/src/publicCapsuleContract';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function source(): PublicCapsuleSource {
  const value: PublicCapsuleSource = { v: 1, shareId: 'capsule', generation: 'a'.repeat(64), ciphertext: { v: 1, alg: 'AES-GCM-PBKDF2', salt: 'A'.repeat(22)+'==', iv: 'A'.repeat(16), data: 'A'.repeat(43)+'=' },
    createdAt: 1, expiresAt: null, views: 0, viewDeadline: Date.now()+600000, sourceDigest: '0'.repeat(64) };
  value.sourceDigest = hash(publicCapsuleSourceBytes(value)); return value;
}
const opening = (value = source()) => ({ v: 1 as const, shareId: value.shareId, openingId: 'n'.repeat(32), sourceDigest: value.sourceDigest, viewDeadline: value.viewDeadline });
beforeEach(() => { vi.clearAllMocks(); sdk.auth.currentUser = { uid: 'alice' }; sdk.observers.clear(); });
it('captures and verifies the public source without inventing unknown counters or dates', async () => {
  const value = { ...source(), views: null, createdAt: null }; value.sourceDigest = hash(publicCapsuleSourceBytes(value));
  const call = vi.fn(async () => value), service = createPublicCapsuleService({ call, hash: async bytes => hash(bytes) });
  const result = await service.read('capsule'); expect(result.views).toBeNull(); expect(result.createdAt).toBeNull(); expect(Object.isFrozen(result.ciphertext)).toBe(true);
  expect(call).toHaveBeenCalledWith('getPublicCapsule', { v: 1, shareId: 'capsule' });
});
it('refuses an unexpected capsule, altered fingerprint or private fields in the public result', async () => {
  for (const patch of [{ shareId: 'other' }, { sourceDigest: 'b'.repeat(64) }, { uid: 'private-owner' }, { text: 'PRIVATE_PLAINTEXT' }, { ciphertext: { ...source().ciphertext, iv: 'bad' } }]) {
    const service = createPublicCapsuleService({ call: async () => ({ ...source(), ...patch }), hash: async bytes => hash(bytes) });
    await expect(service.read('capsule')).rejects.toThrow();
  }
});
it('retires a source while hashing and suppresses late opening responses', async () => {
  let active = true, finish!: (value: string) => void; const value = source();
  const service = createPublicCapsuleService({ call: async () => value, hash: () => new Promise(resolve => { finish = resolve; }) });
  const pending = service.read('capsule', () => active); await vi.waitFor(() => expect(finish).toBeTypeOf('function')); active = false; finish(value.sourceDigest);
  await expect(pending).rejects.toThrow();
  let response!: (value: unknown) => void; active = true; const command = opening();
  const counted = createPublicCapsuleService({ call: () => new Promise(resolve => { response = resolve; }), hash: async bytes => hash(bytes) });
  const ack = counted.opening(command, () => active); active = false; response({ ...command, counted: true, changed: true, currentViews: 1 }); await expect(ack).rejects.toThrow();
});
it('retries uncertain delivery with the exact captured nonce, source and deadline', async () => {
  const value = opening(), call = vi.fn().mockRejectedValueOnce(new PublicCapsuleError(true)).mockImplementationOnce(async (_name: string, input: object) => ({ ...input, counted: true, changed: false, currentViews: 9 }));
  const service = createPublicCapsuleService({ call, hash: async bytes => hash(bytes) });
  expect(await service.opening(value)).toBe(9); expect(call).toHaveBeenCalledTimes(2); expect(call.mock.calls[0]).toEqual(call.mock.calls[1]); expect(Object.isFrozen(call.mock.calls[0][1])).toBe(true);
});
it('does not retry validation/refusal and rejects an acknowledgement for another operation', async () => {
  const refused = vi.fn(async () => { throw new PublicCapsuleError(); });
  await expect(createPublicCapsuleService({ call: refused, hash: async bytes => hash(bytes) }).opening(opening())).rejects.toThrow(); expect(refused).toHaveBeenCalledTimes(1);
  for (const patch of [{ shareId: 'other' }, { openingId: 'x'.repeat(32) }, { viewDeadline: 1 }, { sourceDigest: '0'.repeat(64) }, { currentViews: -1 }, { counted: false }, { extra: true }]) {
    const command = opening(), service = createPublicCapsuleService({ call: async () => ({ ...command, counted: true, changed: true, currentViews: 1, ...patch }), hash: async bytes => hash(bytes) });
    await expect(service.opening(command)).rejects.toThrow();
  }
});
it('anonymous callable transport omits credentials/referrer and sends only data in a bounded JSON frame', async () => {
  window.history.replaceState(null, '', '/share/capsule#k=SYNTHETIC_FRAGMENT_SECRET');
  const request = vi.fn(async () => new Response(JSON.stringify({ result: source() }), { headers: { 'Content-Type': 'application/json' } }));
  const result = await callPublicCapsule('getPublicCapsule', { v: 1, shareId: 'capsule' }, request as typeof fetch);
  expect(result).toHaveProperty('shareId', 'capsule'); const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://europe-west1-demo-mnemosyne-rules.cloudfunctions.net/getPublicCapsule'); expect(options.credentials).toBe('omit'); expect(options.referrerPolicy).toBe('no-referrer');
  expect(options.headers).toEqual({ 'Content-Type': 'application/json' }); expect(options.body).toBe('{"data":{"v":1,"shareId":"capsule"}}'); expect(JSON.stringify([url, options])).not.toContain('SYNTHETIC_FRAGMENT_SECRET');
  window.history.replaceState(null, '', '/');
});
it('transport rejects oversized, invalid and error frames without surfacing raw diagnostics', async () => {
  for (const response of [new Response('PRIVATE_DIAGNOSTIC'), new Response(JSON.stringify({ error: { message: 'PRIVATE_DIAGNOSTIC' }, result: source() })),
    new Response('{}', { headers: { 'content-length': '1100001' } }), new Response('x'.repeat(1100001)), new Response('{}', { status: 503 })]) {
    try { await callPublicCapsule('getPublicCapsule', { v: 1, shareId: 'capsule' }, vi.fn(async () => response) as typeof fetch); throw Error('unexpected success'); }
    catch (error) { expect(error).toBeInstanceOf(PublicCapsuleError); expect((error as Error).message).not.toContain('PRIVATE_DIAGNOSTIC'); }
  }
});
it('transport refuses extra input fields before any network request', async () => {
  const request = vi.fn(async () => new Response('{}'));
  await expect(callPublicCapsule('getPublicCapsule', { v: 1, shareId: 'capsule', passphrase: 'SYNTHETIC_PRIVATE_KEY' }, request as typeof fetch)).rejects.toThrow();
  await expect(callPublicCapsule('recordCapsuleOpening', { ...opening(), text: 'SYNTHETIC_PRIVATE_TEXT' }, request as typeof fetch)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it('revocation captures the actor and verifies its response without requiring a vault key', async () => {
  const target={shareId:'capsule',sourceToken:'a'.repeat(64)};
  sdk.call.mockImplementation(async command => ({ data: { ...command, revoked: true, changed: true } })); await revokePublicCapsule(target);
  expect(sdk.call).toHaveBeenCalledWith({ v: 2, actorUid: 'alice', ...target }); expect(sdk.observers.size).toBe(0);
  sdk.call.mockResolvedValueOnce({ data: { v: 2, actorUid: 'bob', ...target, revoked: true, changed: true } }); await expect(revokePublicCapsule(target)).rejects.toThrow();
});
