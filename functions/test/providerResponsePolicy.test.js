'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {reportedTextModel, decodeProviderImage} = require('../lib/providerResponsePolicy');
const {png} = require('./providerFixtures');
test('reported model must match the selected model and cannot be replaced with arbitrary upstream text', () => {
  for (const model of ['openai/gpt-oss-120b', 'gpt-oss-120b', 'openai/gpt-oss-120b:nscale']) assert.equal(reportedTextModel(model, 'openai/gpt-oss-120b:nscale'), model);
  assert.equal(reportedTextModel('gpt-4o-mini-2024-07-18', 'gpt-4o-mini'), 'gpt-4o-mini-2024-07-18');
  assert.equal(reportedTextModel('nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-super-120b-a12b'), 'nvidia/nemotron-3-super-120b-a12b');
  for (const value of [null, {}, '', 'other/model', 'https://synthetic.invalid/?private=data', 'synthetic-private-error']) {
    assert.throws(() => reportedTextModel(value, 'openai/gpt-oss-120b:nscale'), error => !error.message.includes('synthetic-private'));
  }
});
test('generated images require canonical bytes, raster signatures and 1024x1024 dimensions', () => {
  const base64 = png().toString('base64');
  assert.deepEqual(decodeProviderImage(base64), {image_base64: base64, media_type: 'image/png', width: 1024, height: 1024});
  for (const bytes of [png(512, 512), Buffer.from('<svg>synthetic-private</svg>'), Buffer.from('synthetic-private'), Buffer.alloc(0)]) assert.throws(() => decodeProviderImage(bytes.toString('base64')));
  for (const value of [base64 + ' ', 'data:image/png;base64,' + base64, base64.replace(/.$/, '!'), 'a'.repeat(16 * 1024 * 1024 + 4)]) assert.throws(() => decodeProviderImage(value));
});
