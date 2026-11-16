import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import englishWordlist from 'bip39/src/wordlists/english.json';
import { setFixtureUid, auth } from './android-native-auth-fixture.mjs';
import { setMemoryCryptoMnemonic, encryptMemoryFields, decryptMemoryEnvelope } from '../src/services/memoryCrypto.ts';
import { generatePairingKey, pairingPrivateKey } from '../src/services/mobilePairingCrypto.ts';
import { saveMobileSyncCredential, inspectMobileSyncCredential, protectLegacyMobileSyncCredential, removeMobileSyncCredential } from '../src/services/mobileDeviceKeyStore.ts';
import { withClipCaptureLock } from '../src/services/clipCaptureService.ts';

const ALICE = 'native_alice', BOB = 'native_bob', LEGACY = 'native_legacy';
const prefix = 'mnemosyne_mobile_sync_';
const check = (value, code) => { if (!value) throw Error('native_fixture_' + code); };
// Deterministic zero-entropy BIP-39 fixture; never returned, logged or persisted in clear.
const words = () => Array.from({ length: 12 }, (_, index) => englishWordlist[index === 11 ? 3 : 0]);
const unlock = uid => { setFixtureUid(uid); setMemoryCryptoMnemonic(words()); };
let writes = 0;
const adapter = () => ({
  get: key => SecureStorage.get(key), set: async (key, value) => { await SecureStorage.set(key, value); writes++; },
  remove: key => SecureStorage.remove(key), keys: () => SecureStorage.keys(), encrypt: encryptMemoryFields,
  decrypt: decryptMemoryEnvelope, verify: pairingPrivateKey, exclusive: withClipCaptureLock,
  hash: async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join(''),
});
async function credential(uid, device) {
  const pair = await generatePairingKey(() => {});
  return { ownerUid: uid, deviceId: device.repeat(24), pairingId: 'P'.repeat(24), deviceName: 'Synthetic native pilot', privateKeyJwk: pair.privateKeyJwk, savedAt: 1000 };
}
async function rejects(work, code) { let refused = false; try { await work(); } catch { refused = true; } check(refused, code); }
async function initialize() {
  check(Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SecureStorage'), 'native_plugin');
  await SecureStorage.setKeyPrefix(prefix);
  check(typeof navigator.locks?.request === 'function', 'web_locks');
}
export async function create() {
  await initialize();
  check((await SecureStorage.keys()).length === 0, 'existing_credential_keys');
  unlock(ALICE);
  const value = await credential(ALICE, 'A');
  await saveMobileSyncCredential(value);
  const inspected = await inspectMobileSyncCredential(ALICE), stored = await SecureStorage.get('credential_' + ALICE);
  check(inspected && !inspected.legacy && inspected.credential.deviceId === value.deviceId, 'default_save_read');
  check(stored?.v === 2 && stored.enc?.ct && !JSON.stringify(stored).includes('privateKeyJwk'), 'vault_cipher');
  return { defaultNativeAdapterSaved: true, defaultAccountGuardUsedWithSyntheticAuth: true, vaultCipherStored: true, realWebLocks: true };
}
export async function afterRestart() {
  await initialize(); unlock(ALICE);
  const inspected = await inspectMobileSyncCredential(ALICE);
  check(inspected && !inspected.legacy && inspected.credential.deviceId === 'A'.repeat(24), 'restart_persistence');
  return { recoveredAfterAndroidProcessRestart: true, recoveredKeyPairValidated: true };
}
let caseState;
export async function foreignCipher() {
  await initialize(); unlock(ALICE);
  const initial = await inspectMobileSyncCredential(ALICE), firstCipher = await SecureStorage.get('credential_' + ALICE);
  check(initial && !initial.legacy, 'initial_credential');
  await SecureStorage.set('credential_' + BOB, firstCipher); setFixtureUid(BOB);
  await rejects(() => inspectMobileSyncCredential(BOB), 'copied_cipher_accepted');
  check(JSON.stringify(await SecureStorage.get('credential_' + BOB)) === JSON.stringify(firstCipher), 'copied_cipher_overwritten');
  await SecureStorage.remove('credential_' + BOB); setFixtureUid(ALICE);
  caseState = { initial, firstCipher };
  return { copiedForeignCipherRefusedWithoutOverwrite: true };
}
export async function lostAck() {
  const { initial, firstCipher } = caseState;
  const next = { ...initial.credential, deviceId: 'N'.repeat(24) }, lostAck = adapter(), baseSet = lostAck.set;
  let lose = true;
  lostAck.set = async (key, value) => { await baseSet(key, value); if (key === 'credential_' + ALICE && lose) { lose = false; throw Error('native_fixture_lost_ack'); } };
  await rejects(() => saveMobileSyncCredential(next, () => {}, lostAck), 'lost_ack_not_reported');
  const recovered = await inspectMobileSyncCredential(ALICE);
  check(recovered?.credential.deviceId === next.deviceId, 'lost_ack_readback');
  const count = writes; await saveMobileSyncCredential(next, () => {}, lostAck); check(writes === count, 'lost_ack_rewrote_primary');
  const archives = (await SecureStorage.keys()).filter(key => key.startsWith('archive_v2:' + ALICE + ':'));
  check(archives.length === 1, 'archive_count');
  const archived = await SecureStorage.get(archives[0]), old = JSON.parse((await decryptMemoryEnvelope(archived.enc)).text);
  check(JSON.stringify(old.previous) === JSON.stringify(firstCipher), 'archive_not_exact');
  caseState.next = next; caseState.stable = JSON.stringify(await SecureStorage.get('credential_' + ALICE));
  return { lostAckRecoveredWithoutRewrite: true, exactPreviousCipherArchived: true };
}
export async function retirementAndDamage() {
  const { next, stable } = caseState, retired = adapter();
  retired.encrypt = async value => { const cipher = await encryptMemoryFields(value); setMemoryCryptoMnemonic(null); setMemoryCryptoMnemonic(words()); return cipher; };
  await rejects(() => saveMobileSyncCredential({ ...next, deviceId: 'R'.repeat(24) }, () => {}, retired), 'vault_aba_accepted');
  check(JSON.stringify(await SecureStorage.get('credential_' + ALICE)) === stable, 'vault_aba_overwrote');
  const accountSwap = adapter(), baseGet = accountSwap.get; let swap = true;
  accountSwap.get = async key => { const value = await baseGet(key); if (swap) { swap = false; setFixtureUid(BOB); setFixtureUid(ALICE); } return value; };
  await rejects(() => inspectMobileSyncCredential(ALICE, () => {}, accountSwap), 'account_aba_accepted');
  check(JSON.stringify(await SecureStorage.get('credential_' + ALICE)) === stable, 'account_aba_overwrote');
  setMemoryCryptoMnemonic(null); await rejects(() => inspectMobileSyncCredential(ALICE), 'locked_vault_accepted'); unlock(ALICE);
  const damaged = structuredClone(await SecureStorage.get('credential_' + ALICE)); damaged.enc.ct = damaged.enc.ct[0] === 'A' ? 'B' + damaged.enc.ct.slice(1) : 'A' + damaged.enc.ct.slice(1);
  await SecureStorage.set('credential_' + ALICE, damaged);
  await rejects(() => inspectMobileSyncCredential(ALICE), 'damaged_cipher_accepted');
  check(JSON.stringify(await SecureStorage.get('credential_' + ALICE)) === JSON.stringify(damaged), 'damaged_cipher_overwritten');
  await SecureStorage.set('credential_' + ALICE, JSON.parse(stable));
  return { accountAndVaultABARefused: true, lockedAndDamagedCipherRefused: true };
}
export async function legacyProtection() {
  unlock(LEGACY); const legacy = await credential(LEGACY, 'L'); await SecureStorage.set('credential_' + LEGACY, legacy);
  const reviewed = await inspectMobileSyncCredential(LEGACY); check(reviewed?.legacy, 'legacy_inspection');
  await protectLegacyMobileSyncCredential(LEGACY, reviewed.sourceDigest);
  check((await inspectMobileSyncCredential(LEGACY))?.legacy === false, 'legacy_protection');
  const legacyArchives = (await SecureStorage.keys()).filter(key => key.startsWith('archive_v2:' + LEGACY + ':'));
  check(legacyArchives.length === 1, 'legacy_archive_count');
  const savedLegacy = await SecureStorage.get(legacyArchives[0]), legacyBody = JSON.parse((await decryptMemoryEnvelope(savedLegacy.enc)).text);
  check(JSON.stringify(legacyBody.previous) === JSON.stringify(legacy), 'legacy_archive_not_exact');
  return { legacyProtectedWithExactArchive: true };
}
export async function otherUidCleanup() {
  unlock(BOB); await saveMobileSyncCredential(await credential(BOB, 'B'));
  await SecureStorage.set('credential_' + ALICE + '_other', { synthetic: true });
  setMemoryCryptoMnemonic(null); setFixtureUid(null); await removeMobileSyncCredential(ALICE);
  const remaining = await SecureStorage.keys(); check(!remaining.includes('credential_' + ALICE) && !remaining.some(key => key.startsWith('archive_v2:' + ALICE + ':')), 'alice_cleanup_incomplete');
  check(remaining.includes('credential_' + BOB) && remaining.includes('credential_' + ALICE + '_other'), 'other_account_cleanup');
  unlock(BOB); check((await inspectMobileSyncCredential(BOB))?.credential.deviceId === 'B'.repeat(24), 'bob_not_recoverable');
  return { cleanupAfterRetirementPreservesOtherUid: true, otherUidStillRecoverable: true };
}
export async function cleanup() {
  await initialize(); setMemoryCryptoMnemonic(null); setFixtureUid(null);
  for (const uid of [ALICE, BOB, LEGACY]) await removeMobileSyncCredential(uid);
  await SecureStorage.remove('credential_' + ALICE + '_other');
  check((await SecureStorage.keys()).length === 0 && auth.currentUser === null, 'fixture_cleanup');
  return { fixtureCredentialsRemoved: true, fixtureVaultLocked: true };
}
