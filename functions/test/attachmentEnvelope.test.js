const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAttachmentContent, parseAttachmentHeader, encodeAttachmentHeader, decodeAttachmentHeader, attachmentKeyBinding } = require('../lib/attachmentEnvelope');
const id = '11111111-1111-4111-8111-111111111111';
const header = () => ({ v: 1, id, uid: 'alice', scope: { kind: 'personal', uid: 'alice' }, category: 'document',
  plainBytes: 10, metadataBytes: 20, cipherBytes: 50, iv: 'A'.repeat(16), wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64) } });
test('canonical envelope rejects added fields, wrong context, sizes, base64 and truncated/noncanonical prefix', () => {
  const source = header(); const prefix = encodeAttachmentHeader(source); const decoded = decodeAttachmentHeader(prefix, prefix.length + 50);
  assert.deepEqual(decoded.header, source); assert.equal(decoded.prefixBytes, prefix.length);
  for (const changed of [{ v: 2 }, { id: '../file' }, { uid: 'other' }, { category: '__proto__' }, { plainBytes: 0 }, { metadataBytes: 4097 },
    { cipherBytes: 51 }, { iv: 'short' }, { rawKey: 'forbidden' }, { scope: { kind: 'personal', uid: 'other' } },
    { scope: { kind: 'team', teamId: 'crew', keyEpoch: 0, keyId: id } }, { wrappedKey: { iv: 'B'.repeat(16), ct: 'C'.repeat(64), plaintext: 'forbidden' } }]) {
    assert.throws(() => parseAttachmentHeader({ ...source, ...changed }));
  }
  assert.throws(() => decodeAttachmentHeader(prefix, prefix.length + 51)); assert.throws(() => decodeAttachmentHeader(prefix.slice(0, 12), prefix.length + 50));
  const broken = prefix.slice(); broken[0] = 0; assert.throws(() => decodeAttachmentHeader(broken, broken.length + 50));
  const reordered = Buffer.from(JSON.stringify({ uid: source.uid, ...source })); const alternate = new Uint8Array(12 + reordered.length);
  alternate.set(prefix.slice(0, 8)); new DataView(alternate.buffer).setUint32(8, reordered.length, false); alternate.set(reordered, 12);
  assert.throws(() => decodeAttachmentHeader(alternate, alternate.length + 50));
  assert.notDeepEqual(attachmentKeyBinding(source), attachmentKeyBinding({ ...source, scope: { kind: 'team', teamId: 'crew', keyEpoch: 1, keyId: id } }));
});
test('content policy checks actual signatures and MIME, supports Windows empty MIME, and makes active/code/Office files download-only', () => {
  const png = Uint8Array.from([137,80,78,71,13,10,26,10]);
  assert.deepEqual(validateAttachmentContent(png, 'synthetic.PNG', ''), { category: 'image', mimeType: 'image/png', delivery: 'preview' });
  assert.throws(() => validateAttachmentContent(Buffer.from('<svg/>'), 'spoof.png', 'image/png'));
  assert.throws(() => validateAttachmentContent(png, 'synthetic.png', 'text/html'));
  for (const name of ['synthetic.html', 'synthetic.svg', 'synthetic.ts', 'synthetic.md']) {
    assert.deepEqual(validateAttachmentContent(Buffer.from('<script>synthetic</script>'), name, name.endsWith('.ts') ? 'video/mp2t' : ''),
      { category: 'document', mimeType: 'application/octet-stream', delivery: 'download-only' });
  }
  assert.equal(validateAttachmentContent(Buffer.from([80,75,3,4]), 'synthetic.docx').delivery, 'download-only');
  assert.equal(validateAttachmentContent(Buffer.from([26,69,223,163]), 'synthetic.webm', 'audio/webm;codecs=opus').category, 'audio');
  for (const name of ['synthetic.exe', 'synthetic.zip', 'synthetic.unknown']) assert.throws(() => validateAttachmentContent(png, name));
  assert.throws(() => validateAttachmentContent(Buffer.from([0,255]), 'synthetic.txt'));
  assert.throws(() => validateAttachmentContent(new Uint8Array(), 'synthetic.md'));
});
