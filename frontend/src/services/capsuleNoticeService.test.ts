import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const sdk = vi.hoisted(() => ({ auth: { currentUser: { uid: 'alice' } as { uid: string } | null }, onSnapshot: vi.fn(), onAuthStateChanged: vi.fn(() => vi.fn()),
  collection: vi.fn(() => 'collection'), where: vi.fn((...args: unknown[]) => args), limit: vi.fn((count: number) => count), query: vi.fn((...args: unknown[]) => args),
  getFunctions: vi.fn(() => 'functions'), httpsCallable: vi.fn() }));
vi.mock('../firebase', () => ({ default: {}, auth: sdk.auth, db: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: sdk.onAuthStateChanged }));
vi.mock('firebase/firestore', () => ({ collection: sdk.collection, where: sdk.where, limit: sdk.limit, query: sdk.query, onSnapshot: sdk.onSnapshot }));
vi.mock('firebase/functions', () => ({ getFunctions: sdk.getFunctions, httpsCallable: sdk.httpsCallable }));
import { createCapsuleNoticeService, captureCapsuleNotice, capsuleNoticeSourceBytes, type CapsuleNoticeClientDeps } from './capsuleNoticeService';
const source = () => ({ ownerUid: 'alice', shareId: 'share', importerUid: 'bob', itemCount: 2, createdAt: 1, read: false, titleHint: 'SYNTHETIC_NOTICE_PRIVATE_884 á漢🙂' });
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  let uid: string | null = 'alice'; const observers = new Set<(uid: string | null) => void>();
  let receive!: Parameters<CapsuleNoticeClientDeps['subscribe']>[1], failed!: () => void;
  const deps: CapsuleNoticeClientDeps = { uid: () => uid, observeAuth: callback => { observers.add(callback); return () => { observers.delete(callback); }; },
    subscribe: vi.fn((_uid, callback, onError) => { receive = callback; failed = onError; return vi.fn(); }), hash: vi.fn(async bytes => hash(bytes)),
    call: vi.fn(async command => ({ ...command, acknowledged: true, changed: true })) };
  const service = createCapsuleNoticeService(deps);
  return { deps, service, notice: () => captureCapsuleNotice('notice', source()), receive: (data = source(), cache = false) => receive([{ id: 'notice', data }], cache),
    failed: () => failed(), auth: (next: string | null) => { uid = next; for (const observer of observers) observer(next); }, observers };
}
beforeEach(() => { vi.clearAllMocks(); sdk.auth.currentUser = { uid: 'alice' }; });
it('ignores cache until server metadata, skips malformed/foreign events and deduplicates delivery', () => {
  const f = fixture(), delivered = vi.fn(); const stop = f.service.watch('alice', delivered);
  f.receive(source(), true); expect(delivered).not.toHaveBeenCalled(); f.receive(); f.receive(); expect(delivered).toHaveBeenCalledTimes(1);
  expect(Object.isFrozen(delivered.mock.calls[0][0])).toBe(true); stop(); expect(f.observers.size).toBe(0); f.receive(); expect(delivered).toHaveBeenCalledTimes(1);
  for (const data of [{ ...source(), ownerUid: 'bob' }, { ...source(), itemCount: undefined }, { ...source(), read: true }]) {
    const next = fixture(), callback = vi.fn(); next.service.watch('alice', callback); next.receive(data as ReturnType<typeof source>); expect(callback).not.toHaveBeenCalled();
  }
});
it('retires a listener permanently on account ABA and never logs raw listener failures', () => {
  const f = fixture(), delivered = vi.fn(), failed = vi.fn(), warn = vi.spyOn(console, 'warn'); f.service.watch('alice', delivered, failed);
  f.failed(); expect(failed).toHaveBeenCalledTimes(1); expect(warn).not.toHaveBeenCalled(); f.auth(null); f.auth('alice'); f.receive(); f.failed();
  expect(delivered).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledTimes(1); warn.mockRestore();
});
it('binds actor/source and sends no displayed metadata in the callable request', async () => {
  const f = fixture(), notice = f.notice(); await f.service.acknowledge(notice);
  expect(f.deps.call).toHaveBeenCalledWith({ v: 1, actorUid: 'alice', noticeId: 'notice', sourceDigest: hash(capsuleNoticeSourceBytes(notice.id, notice)) });
  expect(JSON.stringify(vi.mocked(f.deps.call).mock.calls)).not.toContain('SYNTHETIC_NOTICE_PRIVATE_884'); expect(f.observers.size).toBe(0);
});
it('captures source bytes before a hash wait and refuses Auth ABA before transport', async () => {
  const f = fixture(); let release!: (digest: string) => void; let captured = '';
  f.deps.hash = vi.fn(bytes => { captured = bytes; return new Promise(resolve => { release = resolve; }); });
  const value = { ...f.notice() }, pending = f.service.acknowledge(value); value.titleHint = 'Changed'; f.auth(null); f.auth('alice'); release(hash(captured));
  await expect(pending).rejects.toThrow(); expect(captured).toContain('SYNTHETIC_NOTICE_PRIVATE_884'); expect(captured).not.toContain('Changed'); expect(f.deps.call).not.toHaveBeenCalled(); expect(f.observers.size).toBe(0);
});
it('refuses another actor, a retired view and a mismatched response', async () => {
  const foreign = fixture(); foreign.auth('bob'); await expect(foreign.service.acknowledge(foreign.notice())).rejects.toThrow(); expect(foreign.deps.call).not.toHaveBeenCalled();
  const retired = fixture(); await expect(retired.service.acknowledge(retired.notice(), () => false)).rejects.toThrow(); expect(retired.deps.call).not.toHaveBeenCalled();
  for (const patch of [{ actorUid: 'bob' }, { noticeId: 'other' }, { sourceDigest: 'a'.repeat(64) }, { acknowledged: false }, { changed: 'true' }, { extra: true }]) {
    const f = fixture(); f.deps.call = vi.fn(async command => ({ ...command, acknowledged: true, changed: true, ...patch }));
    await expect(f.service.acknowledge(f.notice())).rejects.toThrow(); expect(f.observers.size).toBe(0);
  }
});
it('a response arriving after view retirement cannot confirm the current operation', async () => {
  const f = fixture(); let active = true, release!: (value: unknown) => void;
  f.deps.call = vi.fn(command => new Promise(resolve => { release = value => resolve({ ...command, acknowledged: true, changed: true, ...value as object }); }));
  const pending = f.service.acknowledge(f.notice(), () => active); await vi.waitFor(() => expect(f.deps.call).toHaveBeenCalled()); active = false; release({});
  await expect(pending).rejects.toThrow(); expect(f.observers.size).toBe(0);
});
it('source parsing refuses unsupported legacy metadata instead of manufacturing counts or dates', () => {
  for (const patch of [{ itemCount: 0 }, { itemCount: 301 }, { createdAt: undefined }, { read: 'false' }, { titleHint: '漢'.repeat(334) }, { planDigest: 'a'.repeat(64) }])
    expect(() => captureCapsuleNotice('notice', { ...source(), ...patch })).toThrow();
  expect(captureCapsuleNotice('notice', { ...source(), itemCount: 300 }).itemCount).toBe(300);
});
it('default adapter includes metadata-only confirmations and ignores local pending writes', () => {
  sdk.onSnapshot.mockReturnValue(vi.fn()); const callback = vi.fn(), service = createCapsuleNoticeService(); service.watch('alice', callback);
  const receive = sdk.onSnapshot.mock.calls[0][2];
  const change = { type: 'added', doc: { id: 'notice', data: source, metadata: { hasPendingWrites: false } } };
  const changes = vi.fn((options: { includeMetadataChanges?: boolean }) => options?.includeMetadataChanges ? [change] : []);
  receive({ docChanges: changes, metadata: { fromCache: true } }); expect(callback).not.toHaveBeenCalled();
  change.doc.metadata.hasPendingWrites = true; receive({ docChanges: changes, metadata: { fromCache: false } }); expect(callback).not.toHaveBeenCalled();
  change.doc.metadata.hasPendingWrites = false; receive({ docChanges: changes, metadata: { fromCache: false } });
  expect(callback).toHaveBeenCalledTimes(1); expect(changes).toHaveBeenCalledWith({ includeMetadataChanges: true });
});
it('default Firestore query is unread-only, bounded and metadata-aware; callable uses Europe', async () => {
  sdk.onSnapshot.mockReturnValue(vi.fn()); const service = createCapsuleNoticeService(); service.watch('alice', vi.fn());
  expect(sdk.where).toHaveBeenCalledWith('ownerUid', '==', 'alice'); expect(sdk.where).toHaveBeenCalledWith('read', '==', false);
  expect(sdk.limit).toHaveBeenCalledWith(40); expect(sdk.onSnapshot.mock.calls[0][1]).toEqual({ includeMetadataChanges: true });
  const call = vi.fn(async command => ({ data: { ...command, acknowledged: true, changed: false } })); sdk.httpsCallable.mockReturnValue(call);
  await service.acknowledge(captureCapsuleNotice('notice', source())); expect(sdk.getFunctions).toHaveBeenCalledWith({}, 'europe-west1');
  expect(sdk.httpsCallable).toHaveBeenCalledWith('functions', 'acknowledgeCapsuleNotice');
});
