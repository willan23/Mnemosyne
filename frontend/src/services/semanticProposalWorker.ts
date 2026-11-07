import {
  buildSemanticRelationProposalsForSource,
  type SemanticConnectionMemory,
} from './semanticConnectionBackfill';
import type { SemanticProposalWorkerRequest, SemanticProposalWorkerResponse } from './semanticProposalWorkerProtocol';

let memories: SemanticConnectionMemory[] = [];
let byId = new Map<string, SemanticConnectionMemory>();

self.addEventListener('message', (event: MessageEvent<SemanticProposalWorkerRequest>) => {
  const request = event.data;
  let response: SemanticProposalWorkerResponse;
  try {
    if (request.type === 'load') {
      memories = request.memories;
      byId = new Map(memories.map((memory) => [memory.id, memory]));
      response = { id: request.id, ok: true };
    } else {
      const source = byId.get(request.sourceId);
      response = { id: request.id, ok: true,
        proposals: source ? buildSemanticRelationProposalsForSource(source, memories) : [] };
    }
  } catch {
    response = { id: request.id, ok: false };
  }
  self.postMessage(response);
});
