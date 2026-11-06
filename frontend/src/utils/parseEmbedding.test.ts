import { describe, expect, it } from 'vitest';
import { parseEmbedding } from './parseEmbedding';

describe('parseEmbedding', () => {
  it('rejects a malformed vector instead of shifting its dimensions', () => {
    expect(parseEmbedding([1, null, 0])).toEqual([]);
    expect(parseEmbedding([1, Number.NaN, 0])).toEqual([]);
    expect(parseEmbedding('[1,null,0]')).toEqual([]);
    expect(parseEmbedding('[1,0,0]')).toEqual([1, 0, 0]);
  });
});
