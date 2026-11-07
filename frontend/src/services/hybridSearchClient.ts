import { HYBRID_SEARCH_LIMITS, SEARCH_CONTEXT_POLICY, projectSearchDocument, validSearchId, type HybridPreparedResult,
  type HybridSearchFilters, type HybridSearchHit, type HybridSearchRequest, type HybridSearchSource, type HybridContextResult, type HybridContextCandidate } from './hybridSearchProtocol';
import { HybridSearchCorpus, type HybridCorpusSnapshot } from './hybridSearchCorpus';

export type HybridSearchLease = HybridPreparedResult;
export interface HybridSearchInput {
  memories?: HybridSearchSource[]; corpus?: HybridCorpusSnapshot; query: string; filters: HybridSearchFilters;
  now?: number; limit?: number; floor?: number;
}
const unavailable = () => new Error('hybrid_search_unavailable');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

/** Ephemeral authorized corpus. No storage or network; dispose on any vault scope change. */
export class HybridSearchClient {
  private worker: Worker | null = null;
  private indexed = new Map<string, HybridSearchSource>();
  private source: HybridSearchSource[] | null = null;
  private corpus: HybridCorpusSnapshot | null = null;
  private current: { lease: HybridSearchLease; eligible: Set<string>; limit: number; hits:Array<Pick<HybridSearchHit,'id'|'score'>>; isCurrent: () => boolean } | null = null;
  private cancel: (() => void) | null = null;
  private sequence = 0;

  dispose() {
    this.cancel?.();
    this.worker?.terminate(); this.worker = null;
    this.indexed.clear(); this.source = null; this.corpus = null; this.current = null; this.sequence++;
  }

  private exchange(request: HybridSearchRequest, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (signal.aborted) { this.dispose(); return Promise.reject(unavailable()); }
    if (!this.worker) this.worker = new Worker(new URL('./hybridSearchWorker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timeout); signal.removeEventListener('abort', fail);
        this.cancel = null; worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      };
      const fail = () => {
        if (settled) return;
        settled = true; cleanup(); this.dispose(); reject(unavailable());
      };
      const timeout = window.setTimeout(fail, 30_000);
      this.cancel = fail; signal.addEventListener('abort', fail, { once: true });
      worker.onerror = fail; worker.onmessageerror = fail;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return;
        if (!record(event.data)) { fail(); return; }
        if (event.data.id !== request.id) return; // A reply to an obsolete request cannot settle this one.
        if (event.data.ok !== true) { fail(); return; }
        settled = true; cleanup(); resolve(event.data);
      };
      try { worker.postMessage(request); } catch { fail(); }
    });
  }

  private hits(value: unknown, eligible: Set<string>, limit: number): HybridSearchHit[] {
    if (!Array.isArray(value) || value.length > limit) throw unavailable();
    const seen = new Set<string>();
    return value.map(row => {
      if (!record(row) || !validSearchId(row.id) || !eligible.has(row.id) || seen.has(row.id) ||
        typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 1 ||
        typeof row.semanticScore !== 'number' || !Number.isFinite(row.semanticScore) || Math.abs(row.semanticScore) > 1.000001 ||
        typeof row.matchKind !== 'string' || !['exact', 'title', 'text', 'tag', 'semantic', 'mixed'].includes(row.matchKind) ||
        typeof row.snippet !== 'string' || row.snippet.length > 122 || !Array.isArray(row.matchedTags) ||
        row.matchedTags.length > 1000 || row.matchedTags.some(tag => typeof tag !== 'string' || tag.length > HYBRID_SEARCH_LIMITS.fieldChars)) throw unavailable();
      seen.add(row.id);
      return { id: row.id, score: row.score, semanticScore: row.semanticScore,
        matchKind: row.matchKind as HybridSearchHit['matchKind'], snippet: row.snippet, matchedTags: [...row.matchedTags] };
    });
  }

  async prepare(input: HybridSearchInput, signal: AbortSignal): Promise<HybridSearchLease> {
    this.cancel?.(); this.current = null;
    let id = ++this.sequence;
    try {
      if (signal.aborted || Boolean(input.corpus) === Boolean(input.memories)) throw unavailable();
      let next = this.indexed, changed: ReturnType<typeof projectSearchDocument>[], removed: string[], order: string[] | undefined;
      let size: number, has: (key: string) => boolean, isCurrent = () => true;
      if (input.corpus) {
        const patch = HybridSearchCorpus.read(input.corpus, this.corpus);
        if (patch.rebuild && this.worker) { this.dispose(); id = ++this.sequence; }
        changed = patch.changed.map(projectSearchDocument); removed = patch.removed;
        size = patch.size; has = patch.has; isCurrent = patch.isCurrent;
      } else {
        if (this.corpus) { this.dispose(); id = ++this.sequence; }
        const memories = input.memories!;
        if (memories.length > HYBRID_SEARCH_LIMITS.documents) throw unavailable();
        next = new Map<string, HybridSearchSource>();
        for (const memory of memories) {
          // Do not even project locked or tombstoned records into the Worker payload.
          if (memory.encLocked || memory.deletedAt) continue;
          if (!validSearchId(memory.id) || next.has(memory.id)) throw unavailable();
          next.set(memory.id, memory);
        }
        changed = [...next.values()].filter(memory => this.indexed.get(memory.id) !== memory).map(projectSearchDocument);
        removed = [...this.indexed.keys()].filter(key => !next.has(key));
        order = this.source !== memories ? [...next.keys()] : undefined;
        size = next.size; has = key => next.has(key);
      }
      const limit = input.limit ?? 500;
      const response = await this.exchange({ v: 1, type: 'prepare', id, changed, removed,
        order, sortByTimestamp: input.corpus ? true : undefined,
        query: input.query, filters: input.filters, now: input.now ?? Date.now(), limit, floor: input.floor ?? .38 }, signal);
      if (id !== this.sequence || signal.aborted || !isCurrent()) throw unavailable();
      if (!Number.isSafeInteger(response.revision) || (response.revision as number) < 1 || !Array.isArray(response.candidateIds) ||
        response.candidateIds.length > size || !record(response.stats)) throw unavailable();
      const eligible = new Set<string>();
      for (const key of response.candidateIds) {
        if (!validSearchId(key) || !has(key) || eligible.has(key)) throw unavailable(); eligible.add(key);
      }
      const stats = response.stats;
      if (stats.indexed !== size || stats.changed !== changed.length || stats.removed !== removed.length || stats.normalized !== changed.length) throw unavailable();
      const lease: HybridSearchLease = { revision: response.revision as number, candidateIds: [...eligible],
        hits: this.hits(response.hits, eligible, limit), stats: { indexed: size, changed: changed.length, removed: removed.length, normalized: changed.length } };
      this.indexed = input.corpus ? new Map() : next; this.source = input.memories ?? null; this.corpus = input.corpus ?? null;
      this.current = { lease, eligible, limit, hits:lease.hits.map(({id,score})=>({id,score})), isCurrent };
      return lease;
    } catch {
      if (id === this.sequence) this.dispose();
      throw unavailable();
    }
  }

  async rank(lease: HybridSearchLease, scores: Map<string, number>, signal: AbortSignal): Promise<HybridSearchHit[]> {
    // An obsolete caller must not cancel the new caller's request/index.
    if (this.current?.lease !== lease || this.cancel || !this.current.isCurrent()) throw unavailable();
    const current = this.current, id = ++this.sequence;
    try {
      const rows = [...scores];
      if (rows.some(([key, score]) => !current.eligible.has(key) || !Number.isFinite(score) || Math.abs(score) > 1.000001)) throw unavailable();
      const response = await this.exchange({ v: 1, type: 'rank', id, revision: lease.revision, scores: rows }, signal);
      if (this.current !== current || id !== this.sequence || signal.aborted || !current.isCurrent() || response.revision !== lease.revision) throw unavailable();
      const hits=this.hits(response.hits,current.eligible,current.limit);current.hits=hits.map(({id,score})=>({id,score}));return hits;
    } catch {
      if (id === this.sequence) this.dispose();
      throw unavailable();
    }
  }

  /** Returns bounded context candidates only; it does not change the displayed ranking. */
  async context(lease:HybridSearchLease,signal:AbortSignal):Promise<HybridContextResult> {
    if(this.current?.lease!==lease||this.cancel||!this.current.isCurrent())throw unavailable();
    const current=this.current,id=++this.sequence,revision=lease.revision,policy=SEARCH_CONTEXT_POLICY,seeds=current.hits.slice(0,policy.seeds).map(row=>row.id),seedIds=new Set(seeds),rawIds=new Set(current.hits.map(row=>row.id)),strongIds=new Set(current.hits.filter(row=>row.score>=policy.strongFloor).map(row=>row.id));
    try{
      const response=await this.exchange({v:1,type:'context',id,revision},signal);
      if(this.current!==current||id!==this.sequence||signal.aborted||!current.isCurrent()||response.revision!==revision||Object.keys(response).some(key=>!['id','ok','revision','candidates','stats'].includes(key))||!Array.isArray(response.candidates)||response.candidates.length>policy.candidates||!record(response.stats)||Array.isArray(response.stats))throw unavailable();
      const seen=new Set<string>(),candidates:HybridContextCandidate[]=response.candidates.map((row,index)=>{
        if(!record(row)||Array.isArray(row)||Object.keys(row).some(key=>!['id','kind','matchedKeys','viaSeedId'].includes(key))||!validSearchId(row.id)||!current.eligible.has(row.id)||seen.has(row.id)||typeof row.kind!=='string'||!['seed','strong','term-context','entity-context','retained'].includes(row.kind)||!Number.isInteger(row.matchedKeys))throw unavailable();
        const context=row.kind==='term-context'||row.kind==='entity-context';
        if(context){if(typeof row.matchedKeys!=='number'||row.matchedKeys<1||row.matchedKeys>policy.seeds*policy.anchorsPerSeed||!validSearchId(row.viaSeedId)||!seedIds.has(row.viaSeedId))throw unavailable();}
        else if(row.matchedKeys!==0||row.viaSeedId!==undefined||row.kind==='seed'&&(index>=seeds.length||seeds[index]!==row.id)||row.kind==='strong'&&!strongIds.has(row.id)||row.kind==='retained'&&!rawIds.has(row.id))throw unavailable();
        if(index<seeds.length&&(row.kind!=='seed'||row.id!==seeds[index]))throw unavailable();seen.add(row.id);
        return{id:row.id,kind:row.kind as HybridContextCandidate['kind'],matchedKeys:row.matchedKeys as number,...(context?{viaSeedId:row.viaSeedId as string}:{})};
      });
      if(candidates.length<seeds.length)throw unavailable();const stats=response.stats,expectedKeys=['seeds','anchors','postingVisits','skippedBroad','expanded'];
      if(Object.keys(stats).some(key=>!expectedKeys.includes(key))||expectedKeys.some(key=>typeof stats[key]!=='number'||!Number.isSafeInteger(stats[key])||(stats[key] as number)<0)||stats.seeds!==seeds.length||(stats.anchors as number)>seeds.length*policy.anchorsPerSeed||(stats.postingVisits as number)>(stats.anchors as number)*policy.postingLimit*policy.postingSources||(stats.skippedBroad as number)>(stats.anchors as number)*policy.postingSources||stats.expanded!==candidates.filter(row=>row.kind==='term-context'||row.kind==='entity-context').length||candidates.some(row=>row.matchedKeys>(stats.anchors as number))||(stats.postingVisits as number)<candidates.reduce((sum,row)=>sum+row.matchedKeys,0))throw unavailable();
      return{revision,candidates,stats:{seeds:stats.seeds as number,anchors:stats.anchors as number,postingVisits:stats.postingVisits as number,skippedBroad:stats.skippedBroad as number,expanded:stats.expanded as number}};
    }catch{if(id===this.sequence)this.dispose();throw unavailable();}
  }
}
