/** Storage representation only. RPCs and in-memory views continue to use numeric arrays. */
export const MAX_STORED_EMBEDDING_DIMENSIONS = 4096;
const MAX_JSON_CHARACTERS = 150_000;

export function readStoredEmbedding(value: unknown): number[] | null {
  let vector = value;
  if (typeof vector === 'string') {
    if (vector.length > MAX_JSON_CHARACTERS) return null;
    try { vector = JSON.parse(vector) as unknown; } catch { return null; }
  }
  if (!Array.isArray(vector) || vector.length > MAX_STORED_EMBEDDING_DIMENSIONS) return null;
  // Iteration also observes sparse positions as undefined; never shift coordinates.
  for (const coordinate of vector) if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) return null;
  return vector as number[];
}

export function serializeStoredEmbedding(value: unknown): string {
  const vector = readStoredEmbedding(value);
  if (!vector) throw new Error('Invalid embedding storage value');
  // JSON's normal number encoding round-trips finite doubles, except signed zero.
  return '[' + vector.map(coordinate => Object.is(coordinate, -0) ? '-0' : String(coordinate)).join(',') + ']';
}

/** Call after request validation/digesting, only at the current-document write boundary. */
export function storedEmbeddingMetadata(metadata: object): Record<string, unknown> {
  const result = { ...metadata } as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(result, 'embedding') && result.embedding != null) {
    result.embedding = serializeStoredEmbedding(result.embedding);
  }
  return result;
}
