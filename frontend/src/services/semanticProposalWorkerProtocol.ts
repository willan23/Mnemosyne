import type { SemanticConnectionMemory, SemanticRelationProposal } from './semanticConnectionBackfill';

export type SemanticProposalWorkerCommand =
  | { type: 'load'; memories: SemanticConnectionMemory[] }
  | { type: 'rank'; sourceId: string };

export type SemanticProposalWorkerRequest = SemanticProposalWorkerCommand & { id: number };

export type SemanticProposalWorkerResponse =
  | { id: number; ok: true; proposals?: SemanticRelationProposal[] }
  | { id: number; ok: false };
