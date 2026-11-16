import { expect, it } from 'vitest';
import { embeddingProfile, embeddingProfileForSpace, embeddingProfileSpace } from './embeddingProfile';
import { CURRENT_EMBEDDING_MODEL, CURRENT_EMBEDDING_SPACE, LEGACY_EMBEDDING_SPACE } from './embeddingModel';
import { EMBEDDING_INDEX_TARGET_SPACE, EMBEDDING_INDEX_DIMENSIONS } from '../../../functions/src/embeddingIndexContract';

it('keeps the new-memory model, pinned loader and reviewed publication contract in the same multilingual space', () => {
  const profile = embeddingProfile('multilingualCandidate');
  expect(CURRENT_EMBEDDING_MODEL).toBe(profile.modelId);
  expect(CURRENT_EMBEDDING_SPACE).toBe(embeddingProfileSpace('multilingualCandidate'));
  expect(CURRENT_EMBEDDING_SPACE).toBe(EMBEDDING_INDEX_TARGET_SPACE);
  expect(profile.dimensions).toBe(EMBEDDING_INDEX_DIMENSIONS);
  expect(CURRENT_EMBEDDING_SPACE).not.toBe(LEGACY_EMBEDDING_SPACE);
});

it('selects only exact pinned profile spaces and accepts surrounding whitespace', () => {
  for (const id of ['englishPinned', 'multilingualCandidate'] as const) {
    const space = embeddingProfileSpace(id);
    expect(embeddingProfileForSpace(space)).toBe(id);
    expect(embeddingProfileForSpace(` ${space} `)).toBe(id);
    expect(embeddingProfileForSpace(embeddingProfile(id).modelId)).toBeNull();
    expect(embeddingProfileForSpace(space.replace(':q8:', ':q4:'))).toBeNull();
  }
});

it('does not reinterpret historical, arbitrary or prototype labels as a pinned model', () => {
  for (const value of [LEGACY_EMBEDDING_SPACE, '__proto__', 'constructor', 'https://example.invalid/model',
    'multilingualCandidate', '', null, undefined, 1, {}]) expect(embeddingProfileForSpace(value)).toBeNull();
});
