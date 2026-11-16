import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveAttachmentUrl, resolveAttachments, parseStorageObjectPathFromUrl } from './attachmentAccess';
const state = vi.hoisted(() => ({ uid: 'alice' as string | null, ready: true, mint: vi.fn(), encryptedRead: vi.fn(), generation: 0, teamListeners: new Set<() => void>(), cryptoListeners: new Set<() => void>(), listeners: new Set<(user: { uid: string } | null) => void>() }));
vi.mock('./encryptedAttachmentRead', () => ({ readEncryptedAttachment: (...args: unknown[]) => state.encryptedRead(...args) }));
vi.mock('./teamVault', () => ({ getTeamKeyCacheGeneration: () => state.generation, onTeamKeyChanged: (callback: () => void) => { state.teamListeners.add(callback); return () => state.teamListeners.delete(callback); } }));
vi.mock('./memoryCrypto', () => ({ isMemoryCryptoReady: () => state.ready, onMemoryCryptoChanged: (callback: () => void) => {
  state.cryptoListeners.add(callback); return () => state.cryptoListeners.delete(callback);
} }));
vi.mock('../firebase', () => ({ default: { options: { storageBucket: 'synthetic.appspot.com' } }, auth: { get currentUser() { return state.uid ? { uid: state.uid } : null; } } }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => {
  state.listeners.add(callback); callback(state.uid ? { uid: state.uid } : null); return () => state.listeners.delete(callback);
} }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: () => state.mint }));
const path = 'attachments/alice/synthetic.pdf';
const original = `https://firebasestorage.googleapis.com/v0/b/synthetic.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=synthetic-old-token`;
const signed = (objectPath = path) => {
  const url = new URL(`https://storage.googleapis.com/synthetic.appspot.com/${objectPath}`);
  url.searchParams.set('response-content-disposition', 'attachment; filename="attachment"');
  url.searchParams.set('response-content-type', 'application/octet-stream'); url.searchParams.set('X-Goog-Signature', 'synthetic'); return url.href;
};
beforeEach(() => { state.uid = 'alice'; state.ready = true; state.cryptoListeners.clear(); state.listeners.clear(); state.mint.mockReset(); state.mint.mockResolvedValue({ data: { url: signed(), objectPath: path, expiresAt: Date.now() + 110_000 } }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('authorizes uploader through the callable every time and does not cache the signed URL', async () => {
  expect(await resolveAttachmentUrl(original, { sessionId: 'note' })).toBe(signed());
  await resolveAttachmentUrl(original, { sessionId: 'note' });
  expect(state.mint).toHaveBeenCalledTimes(2); expect(state.mint).toHaveBeenCalledWith({ objectPath: path, sessionId: 'note' });
  expect(state.listeners.size).toBe(0);
});
it('refuses missing scope/account, foreign bucket/host, active data URLs and malformed paths without requests', async () => {
  for (const value of [original.replace('synthetic.appspot.com', 'other-bucket'), original.replace('firebasestorage.googleapis.com', 'attacker.example'),
    'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'https://example.com/file', original.replace(encodeURIComponent(path), 'attachments%2Falice%2F..%2Fsecret')]) {
    expect(parseStorageObjectPathFromUrl(value)).toBeNull(); await expect(resolveAttachmentUrl(value, { sessionId: 'note' })).rejects.toThrow('Não foi possível aceder ao anexo.');
  }
  await expect(resolveAttachmentUrl(original)).rejects.toBeTruthy(); state.uid = null;
  await expect(resolveAttachmentUrl(original, { sessionId: 'note' })).rejects.toBeTruthy(); expect(state.mint).not.toHaveBeenCalled();
});
it('rejects forged/expired/excessive response URLs and never falls back to the original token on denial', async () => {
  for (const payload of [{ url: signed().replace('storage.googleapis.com', 'attacker.example') }, { url: signed('attachments/alice/other.pdf') },
    { objectPath: 'attachments/alice/other.pdf' }, { expiresAt: Date.now() - 1 }, { expiresAt: Date.now() + 600_000 }, { url: original }]) {
    state.mint.mockResolvedValueOnce({ data: { url: signed(), objectPath: path, expiresAt: Date.now() + 110_000, ...payload } });
    await expect(resolveAttachmentUrl(original, { sessionId: 'note' })).rejects.toThrow('Não foi possível aceder ao anexo.');
  }
  state.mint.mockRejectedValueOnce(Error('synthetic sensitive failure'));
  expect(await resolveAttachments([{ type: 'document', url: original, name: 'synthetic.pdf' }], { sessionId: 'note' })).toEqual([]);
});
it('rejects an ACK after logout even when the same account signs back in and unsubscribes the guard', async () => {
  let finish!: (value: unknown) => void; state.mint.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const request = resolveAttachmentUrl(original, { sessionId: 'note' });
  state.uid = null; state.listeners.forEach(listener => listener(null)); state.uid = 'alice'; state.listeners.forEach(listener => listener({ uid: 'alice' }));
  finish({ data: { url: signed(), objectPath: path, expiresAt: Date.now() + 110_000 } });
  await expect(request).rejects.toThrow('Não foi possível aceder ao anexo.'); expect(state.listeners.size).toBe(0);
});
it('retains valid local image/document bytes without a cloud call and does not render active or spoofed image data', async () => {
  const png = 'data:image/png;base64,' + btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10));
  expect(await resolveAttachmentUrl(png)).toBe(png);
  expect(await resolveAttachmentUrl('data:application/pdf;base64,' + btoa('%PDF-1.7 synthetic'))).toMatch(/^data:application\/octet-stream;base64,/);
  for (const data of ['data:image/png;base64,' + btoa('<script>synthetic</script>'), 'data:image/svg+xml;base64,' + btoa('<svg/>'), 'data:text/html;base64,' + btoa('<html/>')]) {
    await expect(resolveAttachmentUrl(data)).rejects.toThrow('Não foi possível aceder ao anexo.');
  }
  expect(state.mint).not.toHaveBeenCalled();
});
it('refuses a locked vault before a request and ignores a response after lock/unlock', async () => {
  state.ready = false; await expect(resolveAttachmentUrl(original, { sessionId: 'note' })).rejects.toBeTruthy(); expect(state.mint).not.toHaveBeenCalled();
  state.ready = true; let finish!: (value: unknown) => void; state.mint.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = resolveAttachmentUrl(original, { sessionId: 'note' });
  state.ready = false; state.cryptoListeners.forEach(listener => listener()); state.ready = true; state.cryptoListeners.forEach(listener => listener());
  finish({ data: { url: signed(), objectPath: path, expiresAt: Date.now() + 110_000 } });
  await expect(pending).rejects.toThrow('Não foi possível aceder ao anexo.'); expect(state.cryptoListeners.size).toBe(0);
});
it('creates only a local preview from verified metadata and revokes it on team/vault changes, expiry and explicit disposal', async () => {
  const opaque = 'mnemosyne-attachment:v1:11111111-1111-4111-8111-111111111111';
  for (const mode of ['team', 'vault', 'expiry', 'release']) {
    vi.useFakeTimers(); state.teamListeners.clear(); state.generation = 0;
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:http://localhost/synthetic'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const bytes = new TextEncoder().encode('Synthetic document');
    state.encryptedRead.mockResolvedValue({ metadata: { name: 'verified.md', category: 'document', delivery: 'download-only', plainBytes: bytes.length, mimeType: 'application/octet-stream' }, bytes, expiresAt: Date.now() + 120000 });
    const result = await resolveAttachments([{ type: 'image', name: 'untrusted.png', url: opaque }], { sessionId: 'note' });
    expect(result[0].type).toBe('document'); expect(result[0].name).toBe('verified.md'); expect(result[0].readSourceUrl).toBe(opaque);
    expect(bytes.every(byte => byte === 0)).toBe(true); expect(state.mint).not.toHaveBeenCalled();
    if (mode === 'team') { state.generation++; state.teamListeners.forEach(listener => listener()); }
    if (mode === 'vault') state.cryptoListeners.forEach(listener => listener());
    if (mode === 'expiry') await vi.advanceTimersByTimeAsync(120000);
    if (mode === 'release') result[0].release?.();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:http://localhost/synthetic'); expect(state.teamListeners.size).toBe(0); expect(state.cryptoListeners.size).toBe(0); expect(state.listeners.size).toBe(0);
    result[0].release?.(); expect(URL.revokeObjectURL).toHaveBeenCalledOnce(); vi.useRealTimers();
  }
});
