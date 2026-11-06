export type EmbeddingWorkerCommand =
  | { type: 'initialize' }
  | { type: 'embed'; text: string };

export type EmbeddingWorkerRequest = EmbeddingWorkerCommand & {
  id: number;
  profile?: import('./embeddingProfile').EmbeddingProfileId;
};

export type EmbeddingWorkerResponse =
  | { id: number; ok: true; embedding?: number[] }
  | { id: number; ok: false; error: string };
