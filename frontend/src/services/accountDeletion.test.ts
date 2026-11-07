import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccountLocalStorage, completedLocalAccountDeletionUids, finishCompletedLocalAccountDeletion,
  inspectAccountDeletion, recoverableLocalAccountDeletionUids, recoverAccountDeletionWithoutAuth, requestAccountDeletion, type AccountDeletionClientDeps } from './accountDeletion';
import {starterAssimilationKey} from './starterAssimilationState';
vi.mock('./mobileDeviceKeyStore', () => ({ removeMobileSyncCredential: vi.fn() }));
function fixture() {
  let uid: string | null = 'alice'; let observer: (() => void) | undefined;
  const call = vi.fn(async () => ({ uid: 'alice', status: 'pending', retryAt: 1000 }));
  const cleanup = vi.fn(async (_uid: string, guard: () => void) => guard()); const lockVault = vi.fn();
  const deps: AccountDeletionClientDeps = { currentUid: () => uid, observeAuth: changed => { observer = changed; return () => { observer = undefined; }; }, storage: localStorage, call, lockVault, cleanup, createRecoveryToken: () => 'ab'.repeat(32) };
  return { deps, call, cleanup, lockVault, change: (next: string | null) => { uid = next; observer?.(); } };
}
const checkpointKey = 'mnemosyne:account-deletion:v1:alice';
beforeEach(() => { localStorage.clear(); });
it('local account cleanup removes only the exact own team revision checkpoint',()=>{
  for(const uid of ['alice','bob','alice-other'])localStorage.setItem(`mnemosyne:team-revision:v1:${uid}`,'Synthetic encrypted request');clearAccountLocalStorage('alice',localStorage);expect(localStorage.getItem('mnemosyne:team-revision:v1:alice')).toBeNull();expect(localStorage.getItem('mnemosyne:team-revision:v1:bob')).toBe('Synthetic encrypted request');expect(localStorage.getItem('mnemosyne:team-revision:v1:alice-other')).toBe('Synthetic encrypted request');
});
it('local account cleanup removes only its own rollover and retained identity ciphertexts',()=>{
  const operation='11111111-1111-4111-8111-111111111111';
  for(const uid of ['alice','bob']){localStorage.setItem(`mnemosyne:comms-identity-rollover:v1:${uid}`,'synthetic cipher');localStorage.setItem(`mnemosyne:comms-identity-backup:v1:${uid}`,'synthetic backup recovery');localStorage.setItem(`mnemosyne:comms-identity-history:v1:${uid}:${operation}`,'synthetic cipher');}
  clearAccountLocalStorage('alice',localStorage);expect(localStorage.getItem('mnemosyne:comms-identity-rollover:v1:alice')).toBeNull();expect(localStorage.getItem(`mnemosyne:comms-identity-history:v1:alice:${operation}`)).toBeNull();
  expect(localStorage.getItem('mnemosyne:comms-identity-backup:v1:alice')).toBeNull();expect(localStorage.getItem('mnemosyne:comms-identity-backup:v1:bob')).toBe('synthetic backup recovery');expect(localStorage.getItem('mnemosyne:comms-identity-rollover:v1:bob')).toBe('synthetic cipher');expect(localStorage.getItem(`mnemosyne:comms-identity-history:v1:bob:${operation}`)).toBe('synthetic cipher');
});
describe('account deletion recovery', () => {
  it('a closed release gate rejects a new default request before persisting a journal or issuing any operation', async () => {
    await expect(requestAccountDeletion('alice', 'start')).rejects.toThrow(/em validação/);
    expect(localStorage.getItem(checkpointKey)).toBeNull();
  });
  it('persists the exact confirmed UID and locks the vault before the first outbound request; pending never cleans local drafts', async () => {
    const f = fixture(); f.call.mockImplementation(async () => {
      expect(JSON.parse(localStorage.getItem(checkpointKey)!)).toEqual({ v: 2, uid: 'alice', phase: 'pending', recoveryToken: 'ab'.repeat(32) });
      expect(f.lockVault).toHaveBeenCalledOnce(); return { uid: 'alice', status: 'pending', retryAt: 1000 };
    });
    const result = await requestAccountDeletion('alice', 'start', f.deps);
    expect(result.status).toBe('pending'); expect(f.cleanup).not.toHaveBeenCalled(); expect(f.call).toHaveBeenCalledWith('deleteUserAccount', { uid: 'alice', recoveryToken: 'ab'.repeat(32) });
  });
  it('rejects missing persistence or a changed account before any remote deletion', async () => {
    const f = fixture(); f.change('bob'); await expect(requestAccountDeletion('alice', 'start', f.deps)).rejects.toThrow(); expect(f.call).not.toHaveBeenCalled();
    f.change('alice'); const denied = { ...f.deps, storage: { ...localStorage, getItem: () => null, setItem: () => { throw Error('synthetic storage unavailable'); } } as Storage };
    await expect(requestAccountDeletion('alice', 'start', denied)).rejects.toThrow(); expect(f.call).not.toHaveBeenCalled();
  });
  it('preserves pending state on lost ACK, malformed response or wrong account ACK', async () => {
    for (const reply of [null, { success: true }, { uid: 'bob', status: 'complete', retryAt: null }]) {
      const f = fixture(); f.call.mockResolvedValue(reply as never);
      await expect(requestAccountDeletion('alice', 'start', f.deps)).rejects.toThrow(); expect(f.cleanup).not.toHaveBeenCalled(); expect(localStorage.getItem(checkpointKey)).toContain('pending');
    }
    const f = fixture(); f.call.mockRejectedValue(Error('synthetic lost ACK'));
    await expect(requestAccountDeletion('alice', 'start', f.deps)).rejects.toThrow(); expect(localStorage.getItem(checkpointKey)).toContain('pending');
  });
  it('resumes status first, confirms remote completion before cleanup and retries failed local cleanup without deleting remotely again', async () => {
    const f = fixture(); await requestAccountDeletion('alice', 'start', f.deps); f.call.mockClear();
    f.call.mockResolvedValue({ uid: 'alice', status: 'complete', retryAt: null } as never); f.cleanup.mockRejectedValueOnce(Error('synthetic local failure'));
    await expect(requestAccountDeletion('alice', 'resume', f.deps)).rejects.toThrow(); expect(f.call).toHaveBeenCalledWith('getAccountDeletionStatus', { uid: 'alice' }); expect(f.call).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(checkpointKey)!).phase).toBe('remote-complete'); f.call.mockClear();
    expect((await requestAccountDeletion('alice', 'resume', f.deps)).status).toBe('complete'); expect(f.call).not.toHaveBeenCalled(); expect(localStorage.getItem(checkpointKey)).toBeNull();
  });
  it('rejects a switch away and back while a deletion ACK is in flight', async () => {
    const f = fixture(); f.call.mockImplementation(async () => { f.change('bob'); f.change('alice'); return { uid: 'alice', status: 'complete', retryAt: null } as never; });
    await expect(requestAccountDeletion('alice', 'start', f.deps)).rejects.toThrow(); expect(f.cleanup).not.toHaveBeenCalled(); expect(localStorage.getItem(checkpointKey)).toContain('pending');
  });
  it('allows offline cleanup after an acknowledged remote completion and Auth loss, but refuses a different active account or unconfirmed request', async () => {
    const f = fixture(); localStorage.setItem(checkpointKey, JSON.stringify({ v: 1, uid: 'alice', phase: 'remote-complete' }));
    expect(completedLocalAccountDeletionUids()).toEqual(['alice']); f.change('bob'); await expect(finishCompletedLocalAccountDeletion('alice', f.deps)).rejects.toThrow(); expect(f.cleanup).not.toHaveBeenCalled();
    f.change(null); await finishCompletedLocalAccountDeletion('alice', f.deps); expect(f.cleanup).toHaveBeenCalledOnce(); expect(f.call).not.toHaveBeenCalled();
    await expect(finishCompletedLocalAccountDeletion('alice', f.deps)).rejects.toThrow();
  });
  it('unknown server status cannot start an unconfirmed request during resume', async () => {
    const f = fixture(); f.call.mockResolvedValue({ uid: 'alice', status: 'unknown', retryAt: null } as never);
    expect((await inspectAccountDeletion('alice', f.deps)).status).toBe('unknown'); f.call.mockClear();
    await expect(requestAccountDeletion('alice', 'resume', f.deps)).rejects.toThrow(); expect(f.call).toHaveBeenCalledTimes(1); expect(f.cleanup).not.toHaveBeenCalled();
  });
  it('recovers a lost final ACK after Auth disappears using only the saved receipt status, then cleans that UID', async () => {
    const f = fixture(); f.call.mockImplementationOnce(async () => { f.change(null); throw Error('synthetic lost final ACK'); });
    await expect(requestAccountDeletion('alice', 'start', f.deps)).rejects.toThrow();
    expect(recoverableLocalAccountDeletionUids()).toEqual(['alice']); expect(completedLocalAccountDeletionUids()).toEqual([]);
    f.call.mockClear(); f.call.mockResolvedValue({ uid: 'alice', status: 'complete', retryAt: null } as never);
    expect((await recoverAccountDeletionWithoutAuth('alice', f.deps)).status).toBe('complete');
    expect(f.call).toHaveBeenCalledExactlyOnceWith('getAccountDeletionRecoveryStatus', { uid: 'alice', recoveryToken: 'ab'.repeat(32) });
    expect(f.cleanup).toHaveBeenCalledWith('alice', expect.any(Function)); expect(localStorage.getItem(checkpointKey)).toBeNull();
  });
  it('an anonymous pending, denied, malformed or different UID response never erases local data or starts remote deletion', async () => {
    const f = fixture(); await requestAccountDeletion('alice', 'start', f.deps); f.change(null); f.call.mockClear();
    for (const result of [{ uid: 'alice', status: 'pending', retryAt: 1000 }, { uid: 'alice', status: 'unknown', retryAt: null },
      { uid: 'bob', status: 'complete', retryAt: null }, null]) {
      f.call.mockResolvedValue(result as never);
      if (result?.status === 'pending') expect((await recoverAccountDeletionWithoutAuth('alice', f.deps)).status).toBe('pending');
      else await expect(recoverAccountDeletionWithoutAuth('alice', f.deps)).rejects.toThrow();
      expect(f.cleanup).not.toHaveBeenCalled(); expect(localStorage.getItem(checkpointKey)).toContain('pending');
    }
    f.call.mockRejectedValue(Error('synthetic wrong receipt')); await expect(recoverAccountDeletionWithoutAuth('alice', f.deps)).rejects.toThrow();
    expect(f.call.mock.calls.every(([name]) => name === 'getAccountDeletionRecoveryStatus')).toBe(true); expect(f.cleanup).not.toHaveBeenCalled();
  });
  it('requires a v2 pending receipt and refuses an active different UID or a switch away and back during anonymous recovery', async () => {
    const f = fixture(); f.change(null);
    for (const checkpoint of [null, { v: 1, uid: 'alice', phase: 'pending' }, { v: 2, uid: 'alice', phase: 'pending', recoveryToken: 'bad' }]) {
      if (checkpoint) localStorage.setItem(checkpointKey, JSON.stringify(checkpoint)); else localStorage.removeItem(checkpointKey);
      await expect(recoverAccountDeletionWithoutAuth('alice', f.deps)).rejects.toThrow(); expect(f.call).not.toHaveBeenCalled();
    }
    localStorage.setItem(checkpointKey, JSON.stringify({ v: 2, uid: 'alice', phase: 'pending', recoveryToken: 'ab'.repeat(32) }));
    f.change('bob'); await expect(recoverAccountDeletionWithoutAuth('alice', f.deps)).rejects.toThrow(); expect(f.call).not.toHaveBeenCalled();
    f.change(null); f.call.mockImplementation(async () => { f.change('bob'); f.change(null); return { uid: 'alice', status: 'complete', retryAt: null } as never; });
    await expect(recoverAccountDeletionWithoutAuth('alice', f.deps)).rejects.toThrow(); expect(f.cleanup).not.toHaveBeenCalled(); expect(localStorage.getItem(checkpointKey)).toContain('pending');
  });
  it('preserves acknowledged recovery on cleanup failure and rejects a receipt changed while the query is in flight', async () => {
    const f = fixture(); await requestAccountDeletion('alice', 'start', f.deps); f.change(null); f.call.mockClear();
    f.call.mockImplementationOnce(async () => {
      localStorage.setItem(checkpointKey, JSON.stringify({ v: 2, uid: 'alice', phase: 'pending', recoveryToken: 'cd'.repeat(32) }));
      return { uid: 'alice', status: 'complete', retryAt: null } as never;
    });
    await expect(recoverAccountDeletionWithoutAuth('alice', f.deps)).rejects.toThrow(); expect(f.cleanup).not.toHaveBeenCalled();
    f.call.mockResolvedValue({ uid: 'alice', status: 'complete', retryAt: null } as never); f.cleanup.mockRejectedValueOnce(Error('synthetic cleanup failure'));
    await expect(recoverAccountDeletionWithoutAuth('alice', f.deps)).rejects.toThrow(); expect(completedLocalAccountDeletionUids()).toEqual(['alice']);
    f.call.mockClear(); await finishCompletedLocalAccountDeletion('alice', f.deps); expect(f.call).not.toHaveBeenCalled(); expect(localStorage.getItem(checkpointKey)).toBeNull();
  });
  it('upgrades an authenticated legacy pending journal before remote retry and reuses the same receipt on subsequent retries', async () => {
    const f = fixture(); localStorage.setItem(checkpointKey, JSON.stringify({ v: 1, uid: 'alice', phase: 'pending' }));
    await requestAccountDeletion('alice', 'resume', f.deps);
    expect(JSON.parse(localStorage.getItem(checkpointKey)!).v).toBe(2);
    f.deps.createRecoveryToken = () => { throw Error('must reuse saved receipt'); };
    await requestAccountDeletion('alice', 'resume', f.deps);
    expect(f.call).toHaveBeenLastCalledWith('deleteUserAccount', { uid: 'alice', recoveryToken: 'ab'.repeat(32) });
  });
  it('storage that refuses journal enumeration cannot make the recovery page claim a completed request', () => {
    const storage = new Proxy(localStorage, { get(target, property) { if (property === 'length') throw Error('synthetic storage denied'); return Reflect.get(target, property); } });
    expect(completedLocalAccountDeletionUids(storage)).toEqual([]); expect(recoverableLocalAccountDeletionUids(storage)).toEqual([]);
  });
  it('clears account keys with exact boundaries and preserves other accounts, global device gates and unrelated preferences', () => {
    for(const namespace of ['comms-p2p-content','comms-p2p','comms-p2p-session','comms-contact','comms-contact-removal','comms-delivery','comms-identity-backup','team-connection']){
      for(const uid of ['alice','bob','alice-other'])localStorage.setItem(`mnemosyne:${namespace}:v1:${uid}`,'synthetic');
      clearAccountLocalStorage('alice',localStorage);expect(localStorage.getItem(`mnemosyne:${namespace}:v1:alice`)).toBeNull();
      for(const uid of ['bob','alice-other']){expect(localStorage.getItem(`mnemosyne:${namespace}:v1:${uid}`)).toBe('synthetic');localStorage.removeItem(`mnemosyne:${namespace}:v1:${uid}`);}
    }
    for(const uid of ['alice','bob','alice-other'])localStorage.setItem(`mnemosyne:comms-import:v1:${uid}`,'synthetic');
    clearAccountLocalStorage('alice',localStorage);
    expect(localStorage.getItem('mnemosyne:comms-import:v1:alice')).toBeNull();
    for(const uid of ['bob','alice-other'])expect(localStorage.getItem(`mnemosyne:comms-import:v1:${uid}`)).toBe('synthetic');
    for(const uid of ['bob','alice-other'])localStorage.removeItem(`mnemosyne:comms-import:v1:${uid}`);
    for(const kind of ['sync-outbox','sync-index']) {
      localStorage.setItem(`mnemosyne:${kind}:v1:alice:phone:desktop-to-mobile`,'synthetic');
      localStorage.setItem(`mnemosyne:${kind}:v1:bob:phone:desktop-to-mobile`,'synthetic');
      localStorage.setItem(`mnemosyne:${kind}:v1:alice-other:phone:desktop-to-mobile`,'synthetic');
    }
    for (const key of ['mnemosyne:embedding-index:v1:alice', 'mnemosyne:personal-revision:v1:alice', 'mnemosyne:attachment-mutation:v1:alice:note', 'mnemosyne_ai_secret_alice_openai', 'mnemosyne.search.recent.v2.alice', 'mnemosyne:team-creation:v1:alice', 'mnemosyne:team-deletion:v1:alice', 'mnemosyne:sync-import:v1:alice:phone:desktop-to-mobile']) localStorage.setItem(key, 'synthetic');
    const preserved = ['mnemosyne:embedding-index:v1:bob', 'mnemosyne:embedding-index:v1:alice-other', 'mnemosyne:personal-revision:v1:bob', 'mnemosyne:personal-revision:v1:alice-other', 'mnemosyne:attachment-mutation:v1:alice-other:note', 'mnemosyne_ai_secret_alice_bob_openai', 'mnemosyne.search.recent.v2.bob', 'mnemosyne:team-deletion:v1:alice-other', 'mnemosyne:team-deletion:v1:bob', 'mnemosyne.pin.vault.v1', 'mnemosyne_theme', 'mnemosyne:sync-import:v1:alice-other:phone:desktop-to-mobile', 'mnemosyne:sync-import:v1:bob:phone:desktop-to-mobile'];
    for (const key of preserved) localStorage.setItem(key, 'synthetic');
    localStorage.setItem('mnemosyne:clip-capture:v1:alice', 'synthetic');
    localStorage.setItem('mnemosyne:clip-capture:v1:bob', 'synthetic');
    localStorage.setItem('mnemosyne:personal-connections:v1:alice','synthetic');
    localStorage.setItem('mnemosyne:personal-connections:v1:bob','synthetic');
    for(const uid of ['alice','bob','alice-other']){localStorage.setItem(`mnemosyne:obsidian-import:v1:${uid}`,'synthetic');localStorage.setItem(starterAssimilationKey(uid),'1');}
    for(const uid of ['alice','bob','alice-other'])localStorage.setItem(`mnemosyne:document-import:v1:${uid}`,'synthetic');
    clearAccountLocalStorage('alice', localStorage); expect(localStorage.length).toBe(preserved.length + 12); for (const key of preserved) expect(localStorage.getItem(key)).toBe('synthetic');
    expect(localStorage.getItem('mnemosyne:obsidian-import:v1:alice')).toBeNull();expect(localStorage.getItem(starterAssimilationKey('alice'))).toBeNull();
    expect(localStorage.getItem('mnemosyne:document-import:v1:alice')).toBeNull();
    for(const uid of ['bob','alice-other'])expect(localStorage.getItem(`mnemosyne:document-import:v1:${uid}`)).toBe('synthetic');
    for(const uid of ['bob','alice-other']){expect(localStorage.getItem(`mnemosyne:obsidian-import:v1:${uid}`)).toBe('synthetic');expect(localStorage.getItem(starterAssimilationKey(uid))).toBe('1');}
    expect(localStorage.getItem('mnemosyne:personal-connections:v1:alice')).toBeNull();expect(localStorage.getItem('mnemosyne:personal-connections:v1:bob')).toBe('synthetic');
    for(const kind of ['sync-outbox','sync-index']) {
      expect(localStorage.getItem(`mnemosyne:${kind}:v1:alice:phone:desktop-to-mobile`)).toBeNull();
      expect(localStorage.getItem(`mnemosyne:${kind}:v1:bob:phone:desktop-to-mobile`)).toBe('synthetic');
      expect(localStorage.getItem(`mnemosyne:${kind}:v1:alice-other:phone:desktop-to-mobile`)).toBe('synthetic');
    }
    expect(localStorage.getItem('mnemosyne:clip-capture:v1:alice')).toBeNull(); expect(localStorage.getItem('mnemosyne:clip-capture:v1:bob')).toBe('synthetic');
  });
});


it('purges only this UID pairing journals/archives with an encoded boundary',()=>{
  localStorage.clear();for(const uid of ['alice','alice-other','alice_other','bob'])for(const kind of ['mobile-pairing','mobile-pairing-archive'])localStorage.setItem(`mnemosyne:${kind}:v2:${encodeURIComponent(uid)}:desktop:synthetic`,'Synthetic retained cipher');
  clearAccountLocalStorage('alice',localStorage);for(const kind of ['mobile-pairing','mobile-pairing-archive']){expect(localStorage.getItem(`mnemosyne:${kind}:v2:alice:desktop:synthetic`)).toBeNull();for(const uid of ['alice-other','alice_other','bob'])expect(localStorage.getItem(`mnemosyne:${kind}:v2:${uid}:desktop:synthetic`)).not.toBeNull();}
});
