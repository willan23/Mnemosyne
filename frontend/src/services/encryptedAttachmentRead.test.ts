import { beforeEach, expect, it, vi } from 'vitest';
import { encryptedAttachmentId, readEncryptedAttachment, type EncryptedAttachmentReadClientDeps } from './encryptedAttachmentRead';
import { attachmentKeyWrapper, sealAttachment } from './attachmentCrypto';
import type { MemoryPermission } from './localAiConfig';
vi.mock('../firebase', () => ({ default: {}, auth: { currentUser: null }, db: {} }));
vi.mock('./teamKeyAccess', () => ({ unlockTeamKey: vi.fn() }));
vi.mock('./teamsService', () => ({ parseTeam: vi.fn() }));
vi.mock('./teamVault', () => ({ getTeamKeyCacheGeneration: () => 0, onTeamKeyChanged: vi.fn() }));
const id = '11111111-1111-4111-8111-111111111111'; const now = 1_800_000_000_000; const ref = `mnemosyne-attachment:v1:${id}`;
async function setup(team = false) {
  const wrapper = attachmentKeyWrapper(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  const scope = team ? { kind: 'team' as const, teamId: 'crew', keyEpoch: 2, keyId: '22222222-2222-4222-8222-222222222222' } : { kind: 'personal' as const, uid: 'alice' };
  const sealed = await sealAttachment({ id, uid: 'alice', scope, bytes: new TextEncoder().encode('Synthetic encrypted document'), name: 'synthetic.md' }, wrapper, () => undefined);
  const url = new URL(`https://storage.googleapis.com/synthetic-private/encrypted/${id}`);
  url.searchParams.set('generation', '200'); url.searchParams.set('response-content-type', 'application/octet-stream');
  url.searchParams.set('response-content-disposition', 'attachment; filename="attachment.bin"'); url.searchParams.set('X-Goog-Signature', 'synthetic');
  const grant = { id, uid: 'alice', scope, bytes: sealed.bytes.length, bucket: 'synthetic-private', generation: '200', url: url.href, expiresAt: now + 120_000 };
  const state = { uid: team ? 'bob' : 'alice', ready: true, policy: 'allow-cloud' as MemoryPermission, generation: 0, now };
  let change = () => undefined; const stop = vi.fn();
  const response = (bytes = sealed.bytes) => new Response(new Uint8Array(bytes).buffer, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(grant.bytes) } });
  const deps: EncryptedAttachmentReadClientDeps = { uid: () => state.uid, ready: () => state.ready, policy: () => state.policy,
    generation: () => state.generation, now: () => state.now, subscribe: callback => { change = callback; return stop; },
    mint: vi.fn(async () => grant), wrapper: vi.fn(async () => wrapper), fetch: vi.fn(async () => response()) };
  return { deps, grant, sealed, state, stop, response, change: () => change() };
}
beforeEach(() => vi.restoreAllMocks());
it('resolves opaque ids only and refuses privacy/locked context without a network or key request', async () => {
  expect(encryptedAttachmentId(ref)).toBe(id); expect(encryptedAttachmentId(`${ref}:extra`)).toBeNull(); expect(encryptedAttachmentId('https://example.com')).toBeNull();
  for (const mode of ['never-cloud', 'unknown-policy', 'confirm-cloud', 'locked', 'missing-session']) {
    const fixture = await setup();
    if (mode === 'locked') fixture.state.ready = false; else if (mode !== 'missing-session') fixture.state.policy = mode as MemoryPermission;
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(readEncryptedAttachment(ref, mode === 'missing-session' ? '' : 'note', fixture.deps)).rejects.toThrow('Não foi possível aceder ao anexo.');
    expect(fixture.deps.mint).not.toHaveBeenCalled(); expect(fixture.deps.wrapper).not.toHaveBeenCalled(); expect(fixture.deps.fetch).not.toHaveBeenCalled();
  }
});
it('opens personal and team files locally only after bounded download and cryptographic context/content verification', async () => {
  for (const team of [false, true]) {
    const fixture = await setup(team); const opened = await readEncryptedAttachment(ref, 'note', fixture.deps);
    expect(opened.metadata.name).toBe('synthetic.md'); expect(opened.metadata.delivery).toBe('download-only');
    expect(new TextDecoder().decode(opened.bytes) === 'Synthetic encrypted document').toBe(true);
    expect(fixture.deps.mint).toHaveBeenCalledExactlyOnceWith(id, 'note'); expect(fixture.stop).toHaveBeenCalledOnce();
  }
});
it('rejects forged host/path, expired grants, generation mismatch and excessive size before download', async () => {
  for (const mode of ['host', 'path', 'expiry', 'generation', 'size', 'personal-uid']) {
    const fixture = await setup();
    if (mode === 'host') fixture.grant.url = fixture.grant.url.replace('storage.googleapis.com', 'attacker.example');
    if (mode === 'path') fixture.grant.url = fixture.grant.url.replace(`/encrypted/${id}`, '/quarantine/alice/other');
    if (mode === 'expiry') fixture.grant.expiresAt = now - 1;
    if (mode === 'generation') fixture.grant.generation = '201';
    if (mode === 'size') fixture.grant.bytes = 300 * 1024 * 1024;
    if (mode === 'personal-uid') fixture.grant.uid = 'bob';
    await expect(readEncryptedAttachment(ref, 'note', fixture.deps)).rejects.toThrow('Não foi possível aceder ao anexo.');
    expect(fixture.deps.fetch).not.toHaveBeenCalled(); expect(fixture.stop).toHaveBeenCalledOnce();
  }
});
it('rejects truncated/overlong/tampered bytes, MIME and redirect responses instead of returning a preview', async () => {
  for (const mode of ['truncated', 'overlong', 'tampered', 'mime', 'redirect']) {
    const fixture = await setup(); let response: Response;
    if (mode === 'truncated') response = fixture.response(fixture.sealed.bytes.slice(0, -1));
    else if (mode === 'overlong') { const bytes = new Uint8Array(fixture.sealed.bytes.length + 1); bytes.set(fixture.sealed.bytes); response = fixture.response(bytes); }
    else { const bytes = fixture.sealed.bytes.slice(); if (mode === 'tampered') bytes[bytes.length - 1] ^= 1; response = fixture.response(bytes); }
    if (mode === 'mime') response.headers.set('content-type', 'text/html');
    if (mode === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
    vi.mocked(fixture.deps.fetch).mockResolvedValue(response);
    await expect(readEncryptedAttachment(ref, 'note', fixture.deps)).rejects.toThrow('Não foi possível aceder ao anexo.'); expect(fixture.stop).toHaveBeenCalledOnce();
  }
});
it('aborts stale contexts and refuses a grant that expires during key preparation without fetching', async () => {
  for (const mode of ['lock-unlock', 'team', 'policy', 'expiry']) {
    const fixture = await setup();
    vi.mocked(fixture.deps.wrapper).mockImplementation(async () => {
      if (mode === 'lock-unlock') { fixture.state.ready = false; fixture.change(); fixture.state.ready = true; }
      if (mode === 'team') fixture.state.generation++;
      if (mode === 'policy') fixture.state.policy = 'never-cloud';
      if (mode === 'expiry') fixture.state.now += 120001;
      return attachmentKeyWrapper(await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['decrypt']));
    });
    await expect(readEncryptedAttachment(ref, 'note', fixture.deps)).rejects.toThrow('Não foi possível aceder ao anexo.');
    expect(fixture.deps.fetch).not.toHaveBeenCalled(); expect(fixture.stop).toHaveBeenCalledOnce();
  }
});
