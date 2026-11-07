import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {setMemoryCryptoMnemonic, encryptMemoryFields, decryptMemoryEnvelope} from './memoryCrypto';
import {advanceReview, createReviewItem} from './reviewInbox';
import {loadReviewInbox, saveReviewInbox, previewLegacyReviewInbox, previewReviewInboxLegacyOrigin, migrateLegacyReviewInbox, legacyReviewInboxKey,
  exportReviewInboxBackup, prepareReviewInboxBackup, prepareRepeatedReviewInboxBackup, restoreReviewInboxBackup, REVIEW_INBOX_BACKUP_MAX_BYTES,
  type ReviewInboxDeps, type ReviewInboxBackupPreview} from './reviewInboxPersistence';
import type {StoredReviewInbox} from './reviewInboxStore';
const words = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];
let actor: string, ready: boolean, listeners: Set<() => void>, rows: Map<string, StoredReviewInbox>, deps: ReviewInboxDeps;
const item = (id = 'one', question = 'Synthetic private question') => ({...createReviewItem('source-1', question, 3, 1000), id});
beforeEach(() => {
  localStorage.clear(); setMemoryCryptoMnemonic(words); actor = 'alice'; ready = true; listeners = new Set(); rows = new Map();
  deps = {store: {get: async uid => rows.has(uid) ? structuredClone(rows.get(uid)) : undefined,
    compareExchange: async (uid, expected, next, guard) => {guard(); if ((rows.has(uid) ? JSON.stringify(rows.get(uid)) : null) !== expected) throw Error('CAS'); rows.set(uid, structuredClone(next));},
    clear: async (uid, guard) => {guard(); rows.delete(uid);}}, legacyStorage: localStorage,
    mutation: {uid: () => actor, ready: () => ready, subscribe: cb => {listeners.add(cb); return () => {listeners.delete(cb);};}},
    encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope, exclusive: async (_name, work) => work(), id: () => crypto.randomUUID(), now: () => 2000};
});
afterEach(() => {expect(listeners.size).toBe(0); setMemoryCryptoMnemonic(null); localStorage.clear(); vi.restoreAllMocks();});
const load = () => loadReviewInbox('alice', () => {}, deps);
const save = async (next = [item()]) => saveReviewInbox('alice', await load(), next, () => {}, deps);
async function legacy(items = [item()]) {const raw = JSON.stringify(await encryptMemoryFields({text: JSON.stringify(items)})); localStorage.setItem(legacyReviewInboxKey('alice'), raw); return raw;}
it('preserves existing spaced scheduling and stores UID/revision-bound ciphertext with a verified roundtrip', async () => {
  const question = createReviewItem('source-1', 'Synthetic question', 3, 1000), good = advanceReview(question, 'good', 2000);
  expect(good.dueAt).toBe(2000 + 86400000); expect(advanceReview(good, 'easy', 3000).intervalDays).toBe(3); expect(advanceReview(good, 'again', 4000).dueAt).toBe(604000);
  const result = await save([good]), row = rows.get('alice')!, body = JSON.parse((await decryptMemoryEnvelope(row.enc)).text);
  expect(result.items).toEqual([good]); expect(body).toMatchObject({v: 2, uid: 'alice', revision: row.revision, items: [good], legacyImports: []});
  expect(JSON.stringify(row)).not.toContain('Synthetic question'); expect(localStorage.length).toBe(0); expect((await load()).items).toEqual([good]);
});
it('does not attribute or decrypt a bare legacy list until an explicit preview and then requires account/digest confirmation', async () => {
  const source = await legacy(), decrypt = vi.fn(deps.decrypt); deps.decrypt = decrypt; const snapshot = await load();
  expect(snapshot.items).toEqual([]); expect(snapshot.legacy).not.toBeNull(); expect(decrypt).not.toHaveBeenCalled();
  const preview = await previewLegacyReviewInbox('alice', snapshot, () => {}, deps); expect(preview.items).toEqual([item()]);
  await expect(migrateLegacyReviewInbox('alice', preview, {ownerUid: 'bob', digest: preview.digest, confirmed: true}, () => {}, deps)).rejects.toThrow();
  await expect(migrateLegacyReviewInbox('alice', preview, {ownerUid: 'alice', digest: 'a'.repeat(64), confirmed: true}, () => {}, deps)).rejects.toThrow();
  expect(rows.size).toBe(0); const result = await migrateLegacyReviewInbox('alice', preview, {ownerUid: 'alice', digest: preview.digest, confirmed: true}, () => {}, deps);
  expect(result.items).toEqual(preview.items); expect(result.legacy).toBeNull(); expect(localStorage.getItem(legacyReviewInboxKey('alice'))).toBe(source);
  const body = JSON.parse((await decryptMemoryEnvelope(rows.get('alice')!.enc)).text); expect(body.legacyImports[0]).toMatchObject({uid: 'alice', sourceRaw: source, sourceDigest: preview.digest, idMap: [['one', 'one']]});
  await expect(migrateLegacyReviewInbox('alice', preview, {ownerUid: 'alice', digest: preview.digest, confirmed: true}, () => {}, deps)).rejects.toThrow(); expect((await load()).items).toHaveLength(1);
});
it('a legacy copy decryptable by two accounts is still unassigned in each and a v2 copy cannot be adopted through its header', async () => {
  const source = await legacy(); localStorage.setItem(legacyReviewInboxKey('bob'), source); actor = 'bob'; const pending = await loadReviewInbox('bob', () => {}, deps);
  expect(pending.items).toEqual([]); expect(pending.legacy).not.toBeNull(); actor = 'alice'; await save(); const original = rows.get('alice')!;
  for (const row of [{...original, uid: 'bob'}, {...original, uid: 'bob', revision: crypto.randomUUID()}]) {rows.set('bob', row); actor = 'bob'; await expect(loadReviewInbox('bob', () => {}, deps)).rejects.toThrow(); expect(rows.get('bob')).toEqual(row);}
});
it('keeps new v2 reviews when a legacy client writes again and imports conflicting IDs only as explicit copies', async () => {
  await legacy(); let snapshot = await load(), preview = await previewLegacyReviewInbox('alice', snapshot, () => {}, deps);
  snapshot = await migrateLegacyReviewInbox('alice', preview, {ownerUid: 'alice', digest: preview.digest, confirmed: true}, () => {}, deps);
  snapshot = await saveReviewInbox('alice', snapshot, [item('one', 'Synthetic new edit'), item('new')], () => {}, deps);
  const later = await legacy([item('one', 'Synthetic old-client fork'), item('new')]); snapshot = await load(); expect(snapshot.items.map(row => row.question)).toEqual(['Synthetic new edit', 'Synthetic private question']);
  preview = await previewLegacyReviewInbox('alice', snapshot, () => {}, deps); const merged = await migrateLegacyReviewInbox('alice', preview, {ownerUid: 'alice', digest: preview.digest, confirmed: true}, () => {}, deps);
  expect(merged.items).toHaveLength(3); expect(merged.items.find(row => row.id === 'one')?.question).toBe('Synthetic new edit'); expect(merged.items.filter(row => row.question === 'Synthetic old-client fork')).toHaveLength(1);
  expect(new Set(merged.items.map(row => row.id)).size).toBe(3); expect(localStorage.getItem(legacyReviewInboxKey('alice'))).toBe(later);
});
it('stale and fabricated baselines cannot overwrite a newer revision; input arrays are captured before encryption awaits', async () => {
  const first = await load(), stale = await load(); await saveReviewInbox('alice', first, [item()], () => {}, deps); const saved = JSON.stringify(rows.get('alice'));
  await expect(saveReviewInbox('alice', stale, [], () => {}, deps)).rejects.toThrow(); await expect(saveReviewInbox('alice', {...first}, [], () => {}, deps)).rejects.toThrow(); expect(JSON.stringify(rows.get('alice'))).toBe(saved);
  const snapshot = await load(), next = [item('two')], encrypt = deps.encrypt; deps.encrypt = async fields => {next[0].question = 'Synthetic changed input'; return encrypt(fields);};
  const result = await saveReviewInbox('alice', snapshot, next, () => {}, deps); expect(result.items[0].question).toBe('Synthetic private question');
});
it.each(['account', 'vault', 'outer', 'legacy', 'store'])('a %s change during encryption refuses dispatch and preserves the prior stored state', async kind => {
  const snapshot = await save(), previous = JSON.stringify(rows.get('alice')), encrypt = deps.encrypt; let active = true;
  deps.encrypt = async fields => {const sealed = await encrypt(fields); if (kind === 'account') {actor = 'bob'; listeners.forEach(cb => cb()); actor = 'alice';} if (kind === 'vault') listeners.forEach(cb => cb()); if (kind === 'outer') active = false; if (kind === 'legacy') localStorage.setItem(legacyReviewInboxKey('alice'), 'changed'); if (kind === 'store') rows.set('alice', {...rows.get('alice')!, revision: crypto.randomUUID()}); return sealed;};
  await expect(saveReviewInbox('alice', snapshot, [], () => {if (!active) throw Error('Retired');}, deps)).rejects.toThrow();
  if (kind !== 'store') expect(JSON.stringify(rows.get('alice'))).toBe(previous);
});
it('a post-commit acknowledgement failure leaves an owned readable revision for reload instead of rewriting an old baseline', async () => {
  const snapshot = await load(), exchange = deps.store.compareExchange; deps.store.compareExchange = async (...args) => {await exchange(...args); throw Error('Lost reply');};
  await expect(saveReviewInbox('alice', snapshot, [item()], () => {}, deps)).rejects.toThrow(); deps.store.compareExchange = exchange;
  expect((await load()).items).toEqual([item()]); await expect(saveReviewInbox('alice', snapshot, [], () => {}, deps)).rejects.toThrow();
});
it('malformed legacy, unknown fields, duplicate IDs, unreadable ciphertext and oversized lists are retained without truncation', async () => {
  for (const value of [[{...item(), extra: true}], [item(), item()], Array.from({length: 501}, (_, index) => item(String(index))), {invalid: true}]) {
    const source = JSON.stringify(await encryptMemoryFields({text: JSON.stringify(value)})); localStorage.setItem(legacyReviewInboxKey('alice'), source); const snapshot = await load();
    await expect(previewLegacyReviewInbox('alice', snapshot, () => {}, deps)).rejects.toThrow(); expect(localStorage.getItem(legacyReviewInboxKey('alice'))).toBe(source); expect(rows.size).toBe(0);
  }
  const corrupt = '{"v":1,"iv":"bad","ct":"bad"}'; localStorage.setItem(legacyReviewInboxKey('alice'), corrupt); await expect(previewLegacyReviewInbox('alice', await load(), () => {}, deps)).rejects.toThrow(); expect(localStorage.getItem(legacyReviewInboxKey('alice'))).toBe(corrupt);
  await expect(save(Array.from({length: 501}, (_, index) => item(String(index))))).rejects.toThrow(); expect(rows.size).toBe(0);
});
it('an invalid cipher roundtrip and quota failure never replace the old revision or legacy source', async () => {
  const snapshot = await save(), previous = JSON.stringify(rows.get('alice')), encrypt = deps.encrypt;
  deps.encrypt = async () => encrypt({text: 'wrong body'}); await expect(saveReviewInbox('alice', snapshot, [], () => {}, deps)).rejects.toThrow(); expect(JSON.stringify(rows.get('alice'))).toBe(previous);
  deps.encrypt = encrypt; deps.store.compareExchange = async () => {throw Error('Quota');}; await expect(saveReviewInbox('alice', snapshot, [], () => {}, deps)).rejects.toThrow(); expect(JSON.stringify(rows.get('alice'))).toBe(previous);
});
it('legacy source replacement after preview refuses attribution and retains the complete latest source', async () => {
  await legacy(); const snapshot = await load(), preview = await previewLegacyReviewInbox('alice', snapshot, () => {}, deps);
  const latest = await legacy([item('later')]); await expect(migrateLegacyReviewInbox('alice', preview, {ownerUid: 'alice', digest: preview.digest, confirmed: true}, () => {}, deps)).rejects.toThrow();
  expect(rows.size).toBe(0); expect(localStorage.getItem(legacyReviewInboxKey('alice'))).toBe(latest);
});
it('a full inbox refuses a whole legacy merge without dropping any current question or original legacy byte', async () => {
  await save(Array.from({length: 500}, (_, index) => item(String(index)))); const before = JSON.stringify(rows.get('alice')), source = await legacy([item('extra')]);
  const snapshot = await load(), preview = await previewLegacyReviewInbox('alice', snapshot, () => {}, deps);
  await expect(migrateLegacyReviewInbox('alice', preview, {ownerUid: 'alice', digest: preview.digest, confirmed: true}, () => {}, deps)).rejects.toThrow();
  expect(JSON.stringify(rows.get('alice'))).toBe(before); expect(localStorage.getItem(legacyReviewInboxKey('alice'))).toBe(source); expect((await load()).items).toHaveLength(500);
});
it('migration preserves legacy question whitespace, dates and fractional scheduling without normalization', async () => {
  const original = {...item(), question: '  Synthetic original question  ', createdAt: -100, dueAt: 1500, intervalDays: 2.5, completedCount: 12}; await legacy([original]);
  const snapshot = await load(), preview = await previewLegacyReviewInbox('alice', snapshot, () => {}, deps), result = await migrateLegacyReviewInbox('alice', preview, {ownerUid: 'alice', digest: preview.digest, confirmed: true}, () => {}, deps);
  expect(result.items).toEqual([original]);
});
it('UID revision and archived-origin bindings are validated inside ciphertext without adopting malformed current data', async () => {
  await save(); const original = rows.get('alice')!, decoded = JSON.parse((await decryptMemoryEnvelope(original.enc)).text);
  for (const change of [{...decoded, uid: 'bob'}, {...decoded, revision: crypto.randomUUID()}, {...decoded, extra: true}, {...decoded, legacyImports: [{uid: 'alice', at: 1000, sourceDigest: 'a'.repeat(64), sourceRaw: '{}', idMap: []}]}]) {
    const row = {...original, enc: await encryptMemoryFields({text: JSON.stringify(change)})}; rows.set('alice', row); await expect(load()).rejects.toThrow(); expect(rows.get('alice')).toEqual(row);
  }
});
const source = (text: string) => ({size: new TextEncoder().encode(text).length, text: async () => text});
const restore = (preview: ReviewInboxBackupPreview) => restoreReviewInboxBackup('alice', preview, {ownerUid: 'alice', digest: preview.digest, confirmed: true}, () => {}, deps);
async function exported(next = [item()]) {const snapshot = await save(next); return exportReviewInboxBackup('alice', snapshot, () => {}, deps);}
async function previewFile(text: string) {return prepareReviewInboxBackup('alice', await load(), source(text), () => {}, deps);}
it('exports questions, exact attributed archives and an unassigned device origin without changing storage or exposing plaintext', async () => {
  const original = await legacy(), initial = await load(), legacyPreview = await previewLegacyReviewInbox('alice', initial, () => {}, deps);
  await migrateLegacyReviewInbox('alice', legacyPreview, {ownerUid: 'alice', digest: legacyPreview.digest, confirmed: true}, () => {}, deps);
  const pending = await legacy([item('pending', 'Synthetic unassigned question')]), snapshot = await load(), before = JSON.stringify(rows.get('alice'));
  const backup = await exportReviewInboxBackup('alice', snapshot, () => {}, deps), wrapper = JSON.parse(backup.text), payload = JSON.parse((await decryptMemoryEnvelope(wrapper.enc)).text);
  expect(backup.text).not.toContain('Synthetic private question'); expect(backup.text).not.toContain('Synthetic unassigned question');
  expect(payload).toMatchObject({v: 1, uid: 'alice', backupId: backup.backupId, legacyRaw: pending}); expect(payload.root.items).toEqual([item()]); expect(payload.root.legacyImports[0].sourceRaw).toBe(original);
  expect(JSON.stringify(rows.get('alice'))).toBe(before); expect(localStorage.getItem(legacyReviewInboxKey('alice'))).toBe(pending);
});
it('restores on a clean device atomically and keeps recovered unassigned sources pending until separate attribution', async () => {
  const backup = await exported([item('owned')]), pending = await legacy([item('pending')]), complete = await exportReviewInboxBackup('alice', await load(), () => {}, deps);
  expect(complete.backupId).not.toBe(backup.backupId); rows.clear(); localStorage.clear(); const preview = await previewFile(complete.text);
  expect(preview).toMatchObject({sourceQuestions: 1, added: 1, copied: 0, pendingSources: 1, alreadyApplied: false}); expect(rows.size).toBe(0);
  await expect(restoreReviewInboxBackup('alice', preview, {ownerUid: 'bob', digest: preview.digest, confirmed: true}, () => {}, deps)).rejects.toThrow();
  const result = await restore(preview); expect(result.view.items).toEqual([item('owned')]); expect(result.view.legacyOrigins).toHaveLength(1); expect(result.view.legacyOrigins[0].local).toBe(false);
  expect(localStorage.getItem(legacyReviewInboxKey('alice'))).toBeNull(); const root = JSON.parse((await decryptMemoryEnvelope(rows.get('alice')!.enc)).text); expect(root.pendingLegacy[0].sourceRaw).toBe(pending);
  const legacyPreview = await previewLegacyReviewInbox('alice', result.view, () => {}, deps), imported = await migrateLegacyReviewInbox('alice', legacyPreview, {ownerUid: 'alice', digest: legacyPreview.digest, confirmed: true}, () => {}, deps);
  expect(imported.items).toHaveLength(2); expect(imported.legacy).toBeNull(); const finalBody = JSON.parse((await decryptMemoryEnvelope(rows.get('alice')!.enc)).text); expect(finalBody.pendingLegacy).toEqual([]); expect(finalBody.legacyImports[0].sourceRaw).toBe(pending);
});
it('backup merge previews copies and preserves existing questions, exact schedules and both attributed archive histories', async () => {
  const original = {...item('one', 'Synthetic backup version'), intervalDays: 2.5, completedCount: 8, dueAt: 4000}; await legacy([original]); let snapshot = await load();
  const first = await previewLegacyReviewInbox('alice', snapshot, () => {}, deps); snapshot = await migrateLegacyReviewInbox('alice', first, {ownerUid: 'alice', digest: first.digest, confirmed: true}, () => {}, deps);
  const backup = await exportReviewInboxBackup('alice', snapshot, () => {}, deps); rows.clear(); localStorage.clear();
  await save([item('one', 'Synthetic current version'), item('local')]); const preview = await previewFile(backup.text);
  expect(preview).toMatchObject({added: 1, copied: 1, afterCount: 3, archiveCount: 1}); expect(preview.changes[0]).toMatchObject({action: 'copy', current: {question: 'Synthetic current version'}, incoming: original});
  const result = await restore(preview); expect(result.view.items.find(row => row.id === 'one')?.question).toBe('Synthetic current version');
  const copied = result.view.items.find(row => row.id !== 'one' && row.question === original.question)!; expect({...copied, id: 'one'}).toEqual(original); expect(result.view.items.find(row => row.id === 'local')).toEqual(item('local'));
});
it('lost restore ACK, reload confirmation and replay never duplicate copies or undo later edits; explicit repeat prepares a new operation', async () => {
  const backup = await exported([item('one', 'Synthetic backup copy')]); await save([item('one', 'Synthetic latest local')]); const preview = await previewFile(backup.text), exchange = deps.store.compareExchange;
  let writes = 0; deps.store.compareExchange = async (...args) => {writes++; await exchange(...args); throw Error('Synthetic lost ACK');}; await expect(restore(preview)).rejects.toThrow(); deps.store.compareExchange = exchange;
  const committed = JSON.stringify(rows.get('alice')), confirmed = await restore(preview); expect(confirmed.confirmed).toBe(true); expect(JSON.stringify(rows.get('alice'))).toBe(committed); expect(writes).toBe(1);
  const reloadPreview = await previewFile(backup.text); expect(reloadPreview.alreadyApplied).toBe(true); expect((await restore(reloadPreview)).confirmed).toBe(true); expect((await load()).items).toHaveLength(2);
  let snapshot = await load(); snapshot = await saveReviewInbox('alice', snapshot, snapshot.items.map(row => row.id === 'one' ? {...row, question: 'Synthetic edit after restore'} : row), () => {}, deps);
  expect((await restore(preview)).view.items.find(row => row.id === 'one')?.question).toBe('Synthetic edit after restore');
  const repeat = await prepareRepeatedReviewInboxBackup('alice', snapshot, reloadPreview, () => {}, deps); expect(repeat.alreadyApplied).toBe(false); expect(repeat.operationId).not.toBe(preview.operationId);
  expect((await restore(repeat)).view.items).toHaveLength(3);
});
it('backup copies of receipt history do not become local proof that another backup was applied here', async () => {
  const first = await exported(); rows.clear(); await restore(await previewFile(first.text)); const second = await exportReviewInboxBackup('alice', await load(), () => {}, deps);
  rows.clear(); await restore(await previewFile(second.text)); const root = JSON.parse((await decryptMemoryEnvelope(rows.get('alice')!.enc)).text);
  expect(root.restoreReceipts).toHaveLength(1); expect(root.restoreReceipts[0].backupId).toBe(second.backupId); expect(root.restoreHistory.some((row: {backupId: string}) => row.backupId === first.backupId)).toBe(true);
  expect((await previewFile(first.text)).alreadyApplied).toBe(false);
});
it('malformed local legacy never blocks review and attribution of a valid source recovered in the same backup', async () => {
  await legacy([item('recovered')]); const backup = await exportReviewInboxBackup('alice', await load(), () => {}, deps); rows.clear(); localStorage.setItem(legacyReviewInboxKey('alice'), 'Synthetic malformed legacy');
  await save([item('current')]); const result = await restore(await previewFile(backup.text)); expect(result.view.items).toEqual([item('current')]); expect(result.view.legacyOrigins).toHaveLength(2);
  await expect(previewLegacyReviewInbox('alice', result.view, () => {}, deps)).rejects.toThrow();
  const origin = result.view.legacyOrigins.find(row => !row.local)!, preview = await previewReviewInboxLegacyOrigin('alice', result.view, origin.digest, () => {}, deps);
  const next = await migrateLegacyReviewInbox('alice', preview, {ownerUid: 'alice', digest: preview.digest, confirmed: true}, () => {}, deps);
  expect(next.items).toHaveLength(2); expect(next.legacyOrigins).toHaveLength(1); expect(localStorage.getItem(legacyReviewInboxKey('alice'))).toBe('Synthetic malformed legacy');
});
it('same-key foreign UID files, altered ciphertext and extra format fields refuse without writing a destination', async () => {
  const backup = await exported(); rows.clear(); actor = 'bob'; const bob = await loadReviewInbox('bob', () => {}, deps);
  await expect(prepareReviewInboxBackup('bob', bob, source(backup.text), () => {}, deps)).rejects.toThrow(); actor = 'alice';
  for (const file of [{...JSON.parse(backup.text), extra: true}, {...JSON.parse(backup.text), format: 'unknown'}, {...JSON.parse(backup.text), enc: {v: 1, iv: 'bad', ct: 'bad'}}]) {
    await expect(previewFile(JSON.stringify(file))).rejects.toThrow(); expect(rows.size).toBe(0);
  }
});
it('canonical file identity accepts JSON formatting/BOM changes but refuses a different cipher under an already used backup nonce', async () => {
  const backup = await exported(); rows.clear(); await restore(await previewFile(backup.text)); const wrapper = JSON.parse(backup.text);
  const formatted = '\uFEFF'+JSON.stringify({enc: wrapper.enc, v: wrapper.v, format: wrapper.format}); expect((await previewFile(formatted)).alreadyApplied).toBe(true);
  const plain = (await decryptMemoryEnvelope(wrapper.enc)).text, changed = {...wrapper, enc: await encryptMemoryFields({text: plain})};
  await expect(previewFile(JSON.stringify(changed))).rejects.toThrow(); expect((await load()).items).toHaveLength(1);
});
it.each(['account', 'vault', 'outer'])('a %s change while reading a file retires its preview before any local mutation', async kind => {
  const backup = await exported(); rows.clear(); let active = true; const snapshot = await load();
  const file = {size: source(backup.text).size, text: async () => {if (kind === 'account') {actor = 'bob'; listeners.forEach(cb => cb()); actor = 'alice';} if (kind === 'vault') listeners.forEach(cb => cb()); if (kind === 'outer') active = false; return backup.text;}};
  await expect(prepareReviewInboxBackup('alice', snapshot, file, () => {if (!active) throw Error('Retired');}, deps)).rejects.toThrow(); expect(rows.size).toBe(0);
});
it('a stale prepared restore and full destination reject the whole plan, retaining every existing question', async () => {
  const backup = await exported([item('extra')]); rows.clear(); const preview = await previewFile(backup.text); await save([item('local')]); const before = JSON.stringify(rows.get('alice'));
  await expect(restore(preview)).rejects.toThrow(); expect(JSON.stringify(rows.get('alice'))).toBe(before);
  await save(Array.from({length: 500}, (_, index) => item(String(index)))); const full = JSON.stringify(rows.get('alice')); await expect(previewFile(backup.text)).rejects.toThrow(); expect(JSON.stringify(rows.get('alice'))).toBe(full);
});
it('file size admission happens before reading; actual oversized text is refused before parsing or changing data', async () => {
  const snapshot = await load(), read = vi.fn(async () => '{}');
  await expect(prepareReviewInboxBackup('alice', snapshot, {size: REVIEW_INBOX_BACKUP_MAX_BYTES + 1, text: read}, () => {}, deps)).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
  await expect(prepareReviewInboxBackup('alice', snapshot, {size: 1, text: async () => ' '.repeat(REVIEW_INBOX_BACKUP_MAX_BYTES + 1)}, () => {}, deps)).rejects.toThrow(); expect(rows.size).toBe(0);
});
