import profiles from './embeddingProfiles.json';

export type EmbeddingProfileId = keyof typeof profiles;

export function embeddingProfile(id: EmbeddingProfileId) {
  if (!Object.prototype.hasOwnProperty.call(profiles, id)) throw new Error('Unknown embedding profile');
  const profile = profiles[id];
  if (!/^[a-f0-9]{40}$/.test(profile.revision) || profile.dtype !== 'q8' ||
      profile.pooling !== 'mean' || profile.normalize !== true || profile.dimensions !== 384) {
    throw new Error('Unsupported embedding profile');
  }
  return profile;
}

export function embeddingProfileSpace(id: EmbeddingProfileId): string {
  const profile = embeddingProfile(id);
  return `${profile.modelId}@${profile.revision}:${profile.dtype}:${profile.pooling}:norm`;
}

const profilesBySpace = new Map<string, EmbeddingProfileId>(
  (Object.keys(profiles) as EmbeddingProfileId[]).map(id => [embeddingProfileSpace(id), id]),
);

/** Only complete, pinned spaces may select a local model; never accept a model URL from data. */
export function embeddingProfileForSpace(space: unknown): EmbeddingProfileId | null {
  return typeof space === 'string' ? profilesBySpace.get(space.trim()) ?? null : null;
}
