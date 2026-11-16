import { describe, expect, it } from 'vitest';
import { rankSearchVectors } from './searchVectorRanking';

describe('vector search ranking', () => {
  it('ranks the full candidate set while excluding incompatible or malformed vectors', () => {
    const candidates = Array.from({ length: 1000 }, (_, index) => ({
      id: `unrelated-${index}`, embedding: [0, 1], embeddingModel: 'model@1',
    }));
    expect(rankSearchVectors({ query: [1, 0], embeddingModel: 'model@1', floor: 0.38,
      candidates: [...candidates,
        { id: 'relevant', embedding: [1, 0], embeddingModel: 'model@1' },
        { id: 'different-model', embedding: [1, 0], embeddingModel: 'model@2' },
        { id: 'invalid', embedding: [NaN, 0], embeddingModel: 'model@1' },
        { id: 'wrong-dimensions', embedding: [1], embeddingModel: 'model@1' },
      ],
    })).toEqual([['relevant', 1]]);
  });
});
