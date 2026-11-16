import type { SemanticConnectionMemory } from './semanticConnectionBackfill';

/** Metadata-only revision key. No memory text or vector values are persisted. */
export function semanticProposalRevision(memories: SemanticConnectionMemory[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const feed = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 16777619);
      h2 = Math.imul(h2 ^ code, 2246822507);
    }
  };
  for (const memory of memories) {
    feed(JSON.stringify([
      memory.id,
      memory.updatedAt || 0,
      memory.embeddingModel || '',
      (memory.connections || []).slice().sort(),
      memory.embedding?.length || 0,
      memory.viewHash || '',
    ]));
  }
  return `${memories.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

export function readSemanticProposalCursor(
  raw: string | null,
  revision: string,
  count: number,
): number {
  if (!raw) return 0;
  try {
    const saved = JSON.parse(raw) as { revision?: unknown; next?: unknown };
    return saved.revision === revision && typeof saved.next === 'number' &&
      Number.isInteger(saved.next) && saved.next >= 0 && saved.next <= count
      ? saved.next : 0;
  } catch {
    return 0;
  }
}

export function readSemanticProposalProgress(
  raw: string | null,
  revision: string,
  count: number,
  utcDay: number,
): { next: number; processedToday: number } {
  const next = readSemanticProposalCursor(raw, revision, count);
  if (!raw) return { next, processedToday: 0 };
  try {
    const saved = JSON.parse(raw) as { day?: unknown; processedToday?: unknown };
    const processedToday = saved.day === utcDay &&
      typeof saved.processedToday === 'number' &&
      Number.isInteger(saved.processedToday) && saved.processedToday >= 0
      ? saved.processedToday : 0;
    return { next, processedToday };
  } catch {
    return { next, processedToday: 0 };
  }
}
