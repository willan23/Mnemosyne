import { describe, expect, it } from 'vitest';
import { parseEmbedding } from './parseEmbedding';

describe('parseEmbedding', () => {
  it('rejects a malformed vector instead of shifting its dimensions', () => {
    expect(parseEmbedding([1, null, 0])).toEqual([]);
    expect(parseEmbedding([1, Number.NaN, 0])).toEqual([]);
    expect(parseEmbedding('[1,null,0]')).toEqual([]);
    expect(parseEmbedding('[1,0,0]')).toEqual([1, 0, 0]);
  });

  it('reads compact stored vectors without changing coordinates or signed zero', () => {
    const parsed = parseEmbedding('[-0,5e-324,0.3333333333333333]');
    expect(Object.is(parsed[0], -0)).toBe(true);
    expect(parsed.slice(1)).toEqual([Number.MIN_VALUE, 1 / 3]);
  });

  it('bounds stored inputs and rejects sparse arrays as complete vectors', () => {
    const sparse = [1, 0, 0]; delete sparse[1];
    expect(parseEmbedding(sparse)).toEqual([]);
    expect(parseEmbedding(Array(4097).fill(0))).toEqual([]);
    expect(parseEmbedding(' '.repeat(150001))).toEqual([]);
  });
});
