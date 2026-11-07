const assert = require('node:assert/strict');
const { test } = require('node:test');
const { classifySessionExposure, needsPersonalScopeBackfill, hasValidSessionUid } = require('../../scripts/session-exposure');

test('session exposure inventory flags legacy plaintext without returning content', () => {
  const flags = classifySessionExposure({
    text: 'synthetic-secret',
    title: 'synthetic-title',
    generatedImagePrompt: 'synthetic-prompt',
    webResearch: { query: 'synthetic-query', sources: [{ url: 'https://example.com' }] },
    attachments: [
      { url: 'data:text/plain,synthetic-inline' },
      { url: 'https://storage.example/o/file?token=synthetic-token' },
    ],
    teamId: 'team-synthetic',
  });
  assert.deepEqual(flags, {
    missingEnc: true,
    plaintextText: true,
    plaintextTitle: true,
    plaintextGenerationPrompt: true,
    plaintextResearchMetadata: true,
    attachmentsPresent: true,
    inlineAttachment: true,
    tokenizedAttachment: true,
    teamSession: true,
    sharedSession: false,
    missingPersonalScope: false,
    invalidTeamScope: false,
  });
  assert.equal(JSON.stringify(flags).includes('synthetic-'), false);
});

test('session exposure inventory accepts a clean encrypted personal memory', () => {
  assert.deepEqual(classifySessionExposure({
    uid: 'alice', teamId: null,
    text: '', title: null,
    enc: { v: 1, iv: 'iv', ct: 'ct' },
    attachments: [],
  }), {
    missingEnc: false,
    plaintextText: false,
    plaintextTitle: false,
    plaintextGenerationPrompt: false,
    plaintextResearchMetadata: false,
    attachmentsPresent: false,
    inlineAttachment: false,
    tokenizedAttachment: false,
    teamSession: false,
    sharedSession: false,
    missingPersonalScope: false,
    invalidTeamScope: false,
  });
});

test('personal scope backfill targets only unmarked personal documents', () => {
  assert.equal(classifySessionExposure({ sharedWithIds: ['bob'] }).sharedSession, true);
  assert.equal(needsPersonalScopeBackfill({ uid: 'alice' }), true);
  assert.equal(needsPersonalScopeBackfill({ uid: 'alice', teamId: '' }), false);
  assert.equal(needsPersonalScopeBackfill({ uid: 'alice', teamId: null }), false);
  assert.equal(needsPersonalScopeBackfill({ uid: 'alice', teamId: 'crew' }), false);
  assert.equal(needsPersonalScopeBackfill({ teamId: null }), false);
  assert.equal(classifySessionExposure({ uid: 'alice', teamId: '' }).invalidTeamScope, true);
});

test('personal scope backfill cannot ignore malformed owners into a clean cutover', () => {
  for (const uid of [undefined, null, '', ' ', '.', '..', 'bad/path', 'bad\\path', 'bad\nowner', 'A'.repeat(129)]) {
    assert.equal(hasValidSessionUid({ uid }), false);
    assert.equal(needsPersonalScopeBackfill({ uid }), false);
  }
  assert.equal(hasValidSessionUid({ uid: 'alice' }), true);
});
