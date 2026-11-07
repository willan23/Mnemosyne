import {afterEach, expect, it, vi} from 'vitest';
vi.mock('../firebase', () => ({db: {}}));
import {buildMobileMemorySnapshot, buildMobileMemoryDelta, personalSyncSessions, queueMobileMemorySnapshot, queueDesktopMemoryDelta, queueMobileMemoryDelta, importQueuedMobileSyncEnvelopes, importQueuedDesktopSyncEnvelopes, markMobileSyncEnvelopePulled, cleanupMobileSyncArtifacts} from './mobileSync';
import type {SessionData} from '../hooks/useSessions';
import type {TrustedDevice} from './mobilePairing';
const personal: SessionData = {id:'personal',uid:'alice',text:'Synthetic personal',timestamp:10,updatedAt:20};
afterEach(() => vi.restoreAllMocks());
it('personal snapshots and deltas exclude foreign, team, ambiguous and shared content before serialization', () => {
  const sessions = [personal, {...personal,id:'foreign',uid:'bob'}, {...personal,id:'team',teamId:'crew'},
    {...personal,id:'ambiguous',teamScopeAmbiguous:true}, {...personal,id:'shared',sharedWithIds:['bob']}, {...personal,id:'malformed-share',sharedWithIds:7}];
  expect(personalSyncSessions('alice',sessions).map(memory=>memory.id)).toEqual(['personal']);
  expect(buildMobileMemorySnapshot('alice',sessions).memories.map(memory=>memory.id)).toEqual(['personal']);
  expect(buildMobileMemoryDelta('alice','phone','mobile',sessions).changes.map(change=>change.memory.id)).toEqual(['personal']);
});
it('a locked personal memory prevents sync; excluded locked team/shared content is never serialized', () => {
  expect(() => buildMobileMemorySnapshot('alice',[{...personal,encLocked:true}])).toThrow();
  expect(buildMobileMemorySnapshot('alice',[personal,{...personal,id:'team',teamId:'crew',encLocked:true}]).memories).toHaveLength(1);
});
it('all legacy sync writers fail before any database, crypto or envelope changes while the protocol is migrating', async () => {
  const device={deviceId:'phone',ownerUid:'alice',status:'active'} as TrustedDevice;
  const operations=[() => queueMobileMemorySnapshot('alice',device,[personal]), () => queueDesktopMemoryDelta('alice',device,[personal]),
    () => queueMobileMemoryDelta('alice',{deviceId:'phone',privateKeyJwk:{}},[personal]), () => importQueuedMobileSyncEnvelopes('alice','phone',{}),
    () => importQueuedDesktopSyncEnvelopes('alice','phone',{}), () => markMobileSyncEnvelopePulled('alice','envelope'), () => cleanupMobileSyncArtifacts('alice',[personal],[device])];
  for (const operation of operations) await expect(operation()).rejects.toThrow('A sincronização está temporariamente em validação. Os envelopes existentes foram conservados.');
});
