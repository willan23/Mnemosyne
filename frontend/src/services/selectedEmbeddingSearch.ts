import type { SessionData } from '../hooks/useSessions';
import { legacyEmbeddingService, embeddingServiceForProfile } from './embeddingService';
import { LEGACY_EMBEDDING_SPACE, embeddingSpaceOf } from './embeddingModel';
import { embeddingProfile, embeddingProfileForSpace, embeddingProfileSpace, type EmbeddingProfileId } from './embeddingProfile';
import { readPreparedEmbedding } from './embeddingReindex';
import type { SearchVectorCandidate, SearchVectorRequest } from './searchVectorRanking';
import type { PreparedEmbeddingSearchCache } from './preparedEmbeddingSearchCache';

/** Each group is compared only to a query produced by its own model. */
export async function searchSelectedEmbeddingProfile(uid: string, profile: EmbeddingProfileId | null,
  candidates: SessionData[], text: string, signal: AbortSignal,
  rank: (request: SearchVectorRequest, signal: AbortSignal) => Promise<Map<string, number>>,
  cache?: PreparedEmbeddingSearchCache) {
  const groups = new Map<string, { profile: EmbeddingProfileId | null; candidates: SearchVectorCandidate[] }>();
  const ids = new Set<string>();
  const check = () => { if (signal.aborted) throw new Error('Search cancelled'); };
  const add = (candidate: SearchVectorCandidate) => {
    const space = embeddingSpaceOf(candidate.embeddingModel), sourceProfile = embeddingProfileForSpace(space);
    if (space !== LEGACY_EMBEDDING_SPACE && sourceProfile === null) return;
    // Invalid persisted shapes must not start another model download. Full numeric
    // validation and cosine arithmetic remain in the ranking Worker.
    if (!Array.isArray(candidate.embedding) || !candidate.embedding.length ||
        (sourceProfile !== null && candidate.embedding.length !== embeddingProfile(sourceProfile).dimensions)) return;
    let group = groups.get(space);
    if (!group) { group = { profile: sourceProfile, candidates: [] }; groups.set(space, group); }
    group.candidates.push(candidate);
  };
  for (const memory of candidates) {
    check();
    if (ids.has(memory.id)) throw new Error('Duplicate search candidate');
    ids.add(memory.id);
    if (memory.encLocked || memory.deletedAt != null || memory.teamScopeAmbiguous) continue;
    const saved = profile === null ? null : cache ? await cache.read(uid, profile, memory, signal)
      : await readPreparedEmbedding(uid, profile, () => memory, { signal });
    check();
    if (saved) {
      if (profile === null || saved.space !== embeddingProfileSpace(profile)) throw new Error('Prepared embedding profile mismatch');
      add({ id: memory.id, embedding: saved.vector, embeddingModel: saved.space });
    } else if (memory.embedding?.length) add({ id: memory.id, embedding: memory.embedding, embeddingModel: memory.embeddingModel });
  }
  const scores = new Map<string, number>();
  // Reuse one query per actual space, including persisted pinned vectors without
  // local checkpoints. A local selection overlays eligible prepared vectors only.
  for (const [space, group] of groups) {
    check();
    const service = group.profile === null ? legacyEmbeddingService : embeddingServiceForProfile(group.profile);
    const query = await service.getEmbedding(text);
    check();
    const ranked = await rank({ candidates: group.candidates, query, embeddingModel: space, floor: 0.38 }, signal);
    check();
    for (const [id, score] of ranked) scores.set(id, score);
  }
  return scores;
}
