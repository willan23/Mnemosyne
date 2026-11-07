/**
 * Parser tolerante para embeddings vindos do Firestore.
 * Aceita arrays numéricos ou strings JSON legadas; nunca lança.
 */
export function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) {
    // Dropping one corrupt coordinate changes the vector space and can create
    // false semantic matches with a different-dimensional embedding.
    return value.every((item) => typeof item === 'number' && Number.isFinite(item))
      ? value as number[]
      : [];
  }
  if (typeof value === 'string') {
    try {
      return parseEmbedding(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  return [];
}
