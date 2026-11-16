import { afterEach, describe, expect, it } from 'vitest';
import { setMemoryCryptoMnemonic } from './memoryCrypto';
import { advanceReview, createReviewItem } from './reviewInbox';

const WORDS = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
];

afterEach(() => {
  setMemoryCryptoMnemonic(null);
  localStorage.clear();
});

describe('local review inbox', () => {
  it('preserves priority and the existing spaced repetition schedule', () => {
    setMemoryCryptoMnemonic(WORDS);
    const item = createReviewItem('source-1', 'Qual foi a decisão secreta?', 3, 1_000);
    expect(item.dueAt).toBe(1_000);
    const good = advanceReview(item, 'good', 2_000);
    expect(good.dueAt).toBe(2_000 + 86_400_000);
    expect(advanceReview(good, 'easy', 3_000).intervalDays).toBe(3);
    expect(advanceReview(good, 'again', 4_000).dueAt).toBe(4_000 + 600_000);
    expect(good.priority).toBe(3); expect(good.completedCount).toBe(1);
  });

  it('refuses invalid source, priority, dates and schedule actions before creating unusable reviews', () => {
    expect(() => createReviewItem('foreign/path', 'Synthetic', 1)).toThrow();
    expect(() => createReviewItem('source', 'Synthetic', 5 as 1)).toThrow();
    expect(() => createReviewItem('source', 'Synthetic', 1, Infinity)).toThrow();
    expect(() => advanceReview(createReviewItem('source', 'Synthetic', 1), 'invalid' as 'good')).toThrow();
  });
});
