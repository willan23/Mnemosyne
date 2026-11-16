/**
 * Existing vectors were written without a model marker. Keep their original
 * space until a separately planned reindex has completed.
 *
 * The model download was historically unpinned, so this marker does not prove
 * an exact weights revision. Pinning or changing weights requires a new space.
 */
export const LEGACY_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const LEGACY_EMBEDDING_SPACE = 'Xenova/all-MiniLM-L6-v2@legacy-main';

// New vectors always identify the reviewed weights and processing parameters.
// Missing historical markers keep the legacy interpretation below.
export const CURRENT_EMBEDDING_PROFILE = 'multilingualCandidate' as const;
export const CURRENT_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const CURRENT_EMBEDDING_SPACE = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2@2c4055b12046f11709e9df2c122e59ffbdc2f900:q8:mean:norm';

export function embeddingSpaceOf(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : LEGACY_EMBEDDING_SPACE;
}

export function sameEmbeddingSpace(a: unknown, b: unknown): boolean {
  return embeddingSpaceOf(a) === embeddingSpaceOf(b);
}
