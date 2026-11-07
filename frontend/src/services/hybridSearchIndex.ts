import { normalizeSearchValue, parseSearchQuery, prepareSearchMemory, searchMemories, searchScoringTerms,
  type PreparedSearchMemory } from '../utils/searchMemories';
import { structuredMemorySearch } from './structuredMemorySearch';
import { assertSearchDocument, HYBRID_SEARCH_LIMITS, SEARCH_CONTEXT_POLICY, validSearchId, type HybridSearchDocument,
  type HybridSearchHit, type HybridSearchRequest, type HybridPrepareRequest, type HybridRankRequest,
  type HybridPreparedResult, type HybridRankedResult, type HybridContextRequest, type HybridContextResult, type HybridContextCandidate } from './hybridSearchProtocol';
import {prepareSearchContextTerms,type SearchContextKey} from './searchContextKeys';

type Postings = Map<string, Set<string>>;
type TableName = 'terms' | 'tags' | 'rawTags' | 'categories' | 'rawCategories' | 'entities';
type QueryDefinition=Pick<HybridPrepareRequest,'query'|'filters'|'now'|'limit'|'floor'|'sortByTimestamp'>;
type Entry = { document: HybridSearchDocument; prepared: PreparedSearchMemory; chars: number; contextTerms:string[]; keys: Record<TableName, Set<string>> };
const tableNames: TableName[] = ['terms', 'tags', 'rawTags', 'categories', 'rawCategories', 'entities'];

/** Local-only index. Contains authorized plaintext; destroy it when its vault scope changes. */
export class HybridSearchIndex {
  private entries = new Map<string, Entry>();
  private tables: Record<TableName, Postings> = { terms: new Map(), tags: new Map(), rawTags: new Map(), categories: new Map(), rawCategories: new Map(), entities: new Map() };
  private times: Array<{ time: number; id: string }> = [];
  private order = new Map<string, number>();
  private chars = 0;
  private nextOrdinal = 0;
  private revision = 0;
  private pending: { request: QueryDefinition; eligible: Set<string>; hits:Array<Pick<HybridSearchHit,'id'|'score'>> } | null = null;

  clear() {
    this.entries.clear(); this.times = []; this.order.clear(); this.chars = 0; this.nextOrdinal = 0; this.pending = null;
    for (const name of tableNames) this.tables[name].clear();
    this.revision++;
  }

  handle(request: HybridSearchRequest): HybridPreparedResult | HybridRankedResult | HybridContextResult {
    try {
      if (!request || request.v !== 1 || !Number.isSafeInteger(request.id) || request.id < 1) throw Error();
      if (request.type === 'prepare') return this.prepare(request);
      if (request.type === 'rank') return this.rank(request);
      if (request.type === 'context') return this.context(request);
      throw Error();
    } catch {
      this.clear();
      throw new Error('hybrid_index_unavailable');
    }
  }

  private lowerTime(value: number) {
    let low = 0, high = this.times.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.times[middle].time < value) low = middle + 1; else high = middle; }
    return low;
  }

  private remove(id: string) {
    const old = this.entries.get(id); if (!old) return;
    for (const name of tableNames) for (const key of old.keys[name]) {
      const posting = this.tables[name].get(key); posting?.delete(id); if (!posting?.size) this.tables[name].delete(key);
    }
    if (old.document.timestamp !== undefined) {
      let at = this.lowerTime(old.document.timestamp);
      while (at < this.times.length && this.times[at].time === old.document.timestamp) {
        if (this.times[at].id === id) { this.times.splice(at, 1); break; } at++;
      }
    }
    this.chars -= old.chars; this.entries.delete(id); this.order.delete(id);
  }

  private upsert(document: HybridSearchDocument) {
    assertSearchDocument(document);
    let chars = [document.title, document.text, document.category, document.celestialType, ...(document.tags || []), ...(document.nodes || []).flatMap(node => [node.label, node.id, node.type])]
      .reduce<number>((sum, value) => sum + (value?.length || 0), 0);
    const previous = this.entries.get(document.id);
    if (this.chars - (previous?.chars || 0) + chars > HYBRID_SEARCH_LIMITS.indexedChars) throw Error();
    const prepared = prepareSearchMemory(document);
    const contextTerms=prepareSearchContextTerms(document,prepared.corpusTokens);chars+=contextTerms.reduce((sum,key)=>sum+key.length,0);
    if(this.chars-(previous?.chars||0)+chars>HYBRID_SEARCH_LIMITS.indexedChars)throw Error();
    const ordinal = this.order.get(document.id); this.remove(document.id);
    const entry: Entry = { document, prepared, chars, contextTerms, keys: {
      terms: prepared.indexTerms, tags: new Set((document.tags || []).map(normalizeSearchValue)), rawTags: new Set(document.tags || []),
      categories: new Set([document.category, document.celestialType].filter((value): value is string => typeof value === 'string').map(normalizeSearchValue)),
      rawCategories: new Set(document.category === undefined ? [] : [document.category]),
      entities: new Set((document.nodes || []).map(node => normalizeSearchValue(node.label))),
    } };
    this.entries.set(document.id, entry); this.chars += chars;
    this.order.set(document.id, ordinal ?? this.nextOrdinal++);
    for (const name of tableNames) for (const key of entry.keys[name]) {
      let posting = this.tables[name].get(key); if (!posting) { posting = new Set(); this.tables[name].set(key, posting); } posting.add(document.id);
    }
    if (document.timestamp !== undefined) this.times.splice(this.lowerTime(document.timestamp), 0, { time: document.timestamp, id: document.id });
  }

  private matching(table: Postings, predicate: (value: string) => boolean) {
    const result = new Set<string>(); for (const [key, ids] of table) if (predicate(key)) for (const id of ids) result.add(id); return result;
  }

  private ordered(ids: Iterable<string>, request: QueryDefinition) {
    return [...ids].sort((a, b) => {
      const time = request.sortByTimestamp ? (this.entries.get(b)!.document.timestamp ?? 0) - (this.entries.get(a)!.document.timestamp ?? 0) : 0;
      return time || (this.order.get(a) ?? Infinity) - (this.order.get(b) ?? Infinity);
    });
  }

  private eligible(request: QueryDefinition) {
    const parsed = parseSearchQuery(request.query); if (parsed.invalidFilter) return new Set<string>();
    const constraints: Set<string>[] = [];
    for (const entity of parsed.entities || []) constraints.push(new Set(this.tables.entities.get(entity) || []));
    for (const tag of parsed.tags) constraints.push(this.matching(this.tables.tags, value => value === tag || value.includes(tag)));
    if (parsed.category) constraints.push(this.matching(this.tables.categories, value => value.includes(parsed.category!)));
    if (request.filters.tags.length) constraints.push(this.matching(this.tables.rawTags, value => request.filters.tags.includes(value)));
    if (request.filters.category) constraints.push(new Set(this.tables.rawCategories.get(request.filters.category) || []));
    if (parsed.after !== undefined || parsed.before !== undefined) constraints.push(new Set(this.times.slice(this.lowerTime(parsed.after ?? -Infinity), this.lowerTime(parsed.before ?? Infinity)).map(row => row.id)));
    constraints.sort((a, b) => a.size - b.size);
    const base = constraints[0] ? [...constraints[0]].filter(id => constraints.every(values => values.has(id))) : [...this.entries.keys()];
    const documents = this.ordered(base, request).map(id => this.entries.get(id)!.document);
    return new Set(structuredMemorySearch(documents, request.query, request.filters, request.now).map(document => document.id));
  }

  private hits(request: QueryDefinition, eligible: Set<string>, scores: Map<string, number>): HybridSearchHit[] {
    const parsed = parseSearchQuery(request.query); if (!parsed.raw || parsed.invalidFilter) return [];
    const terms = searchScoringTerms(parsed.text);
    // This is a superset, not a new scoring rule. It preserves phrase, substring,
    // diacritic and close-prefix matches; exact scoring remains in searchMemories.
    let lexical = !terms.length || request.floor <= 0 ? new Set(eligible) : this.matching(this.tables.terms, value => terms.some(term => value.includes(term) || term.includes(value)));
    lexical = new Set([...lexical].filter(id => eligible.has(id)));
    for (const [id, score] of scores) if (score >= request.floor && eligible.has(id)) lexical.add(id);
    const ids = this.ordered(lexical, request), documents = ids.map(id => this.entries.get(id)!.document);
    const prepared = new Map(ids.map(id => [id, this.entries.get(id)!.prepared]));
    return searchMemories(documents, request.query, { semanticScores: scores, semanticFloor: request.floor, limit: request.limit, prepared })
      .map(hit => ({ id: hit.memory.id, score: hit.score, semanticScore: hit.memory.semanticScore ?? 0,
        matchKind: hit.matchKind, snippet: hit.snippet, matchedTags: hit.matchedTags }));
  }

  private prepare(request: HybridPrepareRequest): HybridPreparedResult {
    this.pending = null;
    if (!Array.isArray(request.changed) || !Array.isArray(request.removed) || request.changed.length > HYBRID_SEARCH_LIMITS.documents ||
      request.removed.length > HYBRID_SEARCH_LIMITS.documents || request.removed.some(id => !validSearchId(id)) ||
      typeof request.query !== 'string' || request.query.length > 8192 || !Number.isFinite(request.now) || !Number.isFinite(request.floor) || request.floor < -1 || request.floor > 1 ||
      !Number.isInteger(request.limit) || request.limit < 1 || request.limit > HYBRID_SEARCH_LIMITS.results ||
      !request.filters || typeof request.filters.dateRange !== 'string' || request.filters.dateRange.length > 32 || !Array.isArray(request.filters.tags) ||
      request.filters.tags.length > 1000 || request.filters.tags.some(tag => typeof tag !== 'string' || tag.length > 512) ||
      (request.filters.category !== undefined && (typeof request.filters.category !== 'string' || request.filters.category.length > 512)) ||
      (request.sortByTimestamp !== undefined && request.sortByTimestamp !== true) ||
      (request.sortByTimestamp !== undefined && request.order !== undefined)) throw Error();
    if (new Set(request.changed.map(document => document.id)).size !== request.changed.length || new Set(request.removed).size !== request.removed.length) throw Error();
    for (const id of request.removed) this.remove(id);
    for (const document of request.changed) this.upsert(document);
    if (this.entries.size > HYBRID_SEARCH_LIMITS.documents) throw Error();
    if (request.order !== undefined) {
      if (!Array.isArray(request.order) || request.order.length !== this.entries.size || new Set(request.order).size !== request.order.length || request.order.some(id => !validSearchId(id) || !this.entries.has(id))) throw Error();
      this.order = new Map(request.order.map((id, index) => [id, index]));
      this.nextOrdinal = Math.max(this.nextOrdinal, request.order.length);
    }
    const captured:QueryDefinition={query:request.query,filters:{dateRange:request.filters.dateRange,tags:[...request.filters.tags],category:request.filters.category},now:request.now,limit:request.limit,floor:request.floor,sortByTimestamp:request.sortByTimestamp};
    const eligible = this.eligible(captured),hits=this.hits(captured,eligible,new Map()); this.revision++; this.pending = { request:captured, eligible, hits:hits.map(({id,score})=>({id,score})) };
    return { revision: this.revision, candidateIds: this.ordered(eligible, request), hits,
      stats: { indexed: this.entries.size, changed: request.changed.length, removed: request.removed.length, normalized: request.changed.length } };
  }

  private rank(request: HybridRankRequest): HybridRankedResult {
    if (!this.pending || request.revision !== this.revision || !Array.isArray(request.scores) || request.scores.length > this.pending.eligible.size) throw Error();
    const scores = new Map<string, number>();
    for (const row of request.scores) {
      if (!Array.isArray(row) || row.length !== 2 || !validSearchId(row[0]) || !this.pending.eligible.has(row[0]) || !Number.isFinite(row[1]) || row[1] < -1.000001 || row[1] > 1.000001 || scores.has(row[0])) throw Error();
      scores.set(row[0], row[1]);
    }
    const hits=this.hits(this.pending.request,this.pending.eligible,scores);this.pending.hits=hits.map(({id,score})=>({id,score}));
    return { revision: this.revision, hits };
  }

  private context(request:HybridContextRequest):HybridContextResult {
    if(!this.pending||request.revision!==this.revision||Object.keys(request).some(key=>!['v','type','id','revision'].includes(key)))throw Error();
    const {eligible,hits}=this.pending,policy=SEARCH_CONTEXT_POLICY,seeds=hits.slice(0,policy.seeds),chosen=new Map<string,HybridContextCandidate>();
    const add=(row:HybridContextCandidate)=>{if(chosen.size<policy.candidates&&!chosen.has(row.id))chosen.set(row.id,row);};
    for(const seed of seeds)add({id:seed.id,kind:'seed',matchedKeys:0});
    for(const hit of hits)if(hit.score>=policy.strongFloor)add({id:hit.id,kind:'strong',matchedKeys:0});
    const stats={seeds:seeds.length,anchors:0,postingVisits:0,skippedBroad:0,expanded:0},parsed=parseSearchQuery(this.pending.request.query),queryTerms=new Set(searchScoringTerms(parsed.text)),queryText=normalizeSearchValue(parsed.text);
    const neighbors=new Map<string,{weights:Map<string,number>;viaSeedId:string;best:number;viaKind:'entity-context'|'term-context'}>();
    if(chosen.size<policy.candidates&&parsed.text.trim()&&!parsed.invalidFilter)for(const seed of seeds){
      const entry=this.entries.get(seed.id)!,keys=function*():Generator<SearchContextKey>{for(const key of entry.keys.entities)if(key.trim()&&key.length<=policy.keyChars)yield{kind:'entity',key};for(const key of entry.contextTerms)yield{kind:'term',key};};
      let used=0;const seenKeys=new Set<string>();for(const anchor of keys()){
        if(seenKeys.has(anchor.key))continue;seenKeys.add(anchor.key);
        if(anchor.kind==='term'||!anchor.key.includes(' ')?queryTerms.has(anchor.key):queryText.includes(anchor.key))continue;
        if(used++>=policy.anchorsPerSeed)break;stats.anchors++;
        const postings=anchor.kind==='entity'?[{posting:this.tables.entities.get(anchor.key),kind:'entity-context' as const},{posting:this.tables.terms.get(anchor.key),kind:'term-context' as const}]:[{posting:this.tables.terms.get(anchor.key),kind:'term-context' as const}];
        for(const {posting,kind}of postings){if(!posting)continue;if(posting.size>policy.postingLimit){stats.skippedBroad++;continue;}
          for(const id of posting){stats.postingVisits++;if(!eligible.has(id)||chosen.has(id))continue;
            const weight=seed.score/posting.size;let neighbor=neighbors.get(id);if(!neighbor){neighbor={weights:new Map(),viaSeedId:seed.id,best:weight,viaKind:kind};neighbors.set(id,neighbor);}
            neighbor.weights.set(anchor.key,Math.max(neighbor.weights.get(anchor.key)??0,weight));if(weight>neighbor.best||weight===neighbor.best&&kind==='entity-context'&&neighbor.viaKind!=='entity-context'){neighbor.best=weight;neighbor.viaSeedId=seed.id;neighbor.viaKind=kind;}
          }
        }
      }
    }
    const ordered=this.ordered(neighbors.keys(),this.pending.request),ordinal=new Map(ordered.map((id,index)=>[id,index]));
    const weight=(id:string)=>[...neighbors.get(id)!.weights.values()].reduce((sum,value)=>sum+value,0);
    ordered.sort((a,b)=>weight(b)-weight(a)||ordinal.get(a)!-ordinal.get(b)!);
    for(const id of ordered){const neighbor=neighbors.get(id)!;add({id,kind:neighbor.viaKind,matchedKeys:neighbor.weights.size,viaSeedId:neighbor.viaSeedId});}
    for(const hit of hits)add({id:hit.id,kind:'retained',matchedKeys:0});
    stats.expanded=[...chosen.values()].filter(row=>row.kind==='entity-context'||row.kind==='term-context').length;
    return{revision:this.revision,candidates:[...chosen.values()],stats};
  }
}
