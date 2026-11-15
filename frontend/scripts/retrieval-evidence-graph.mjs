/** Evaluation only. Lexical links are evidence hints, never identity or permission proofs. */
export const EVIDENCE_GRAPH_POLICY = Object.freeze({
  version: 4, candidates: 16, cachedKeys: 64, keyChars: 128, textChars: 120_000,
  queryChars: 4096, spanWords: 4, maxHops: 2, maxAnchorFraction: .5, denseFloor: .82, densePairs: 64,
  requiresLexicalBridge: true, weakComponentFallback: 'original-ranking',
});
const fail = () => { throw Error('evidence_graph_unavailable'); };
const normal = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const primitiveId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const validScore = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

function cues(text, scoringTerms) {
  const allowed = new Set(scoringTerms(text)), terms = new Set(), compounds = new Set(), compoundParts = new Set();
  const add = (target, key) => {
    if (key && key.length <= EVIDENCE_GRAPH_POLICY.keyChars && terms.size + compounds.size < EVIDENCE_GRAPH_POLICY.cachedKeys) target.add(key);
  };
  for (const match of text.matchAll(/(?:^|[^\p{L}\p{N}])([\p{Lu}][\p{L}\p{N}'’_-]{1,}(?:[ \t]+[\p{Lu}][\p{L}\p{N}'’_-]{1,}){0,3})/gu)) {
    const words = match[1].split(/[ \t]+/).map(normal);
    for (const word of words) if (allowed.has(word)) add(terms, word);
    if (words.length > 1 && words.every(word => allowed.has(word))) {
      const key = words.join(' '); add(compounds, key);
      if (compounds.has(key)) for (const word of words) compoundParts.add(word);
    }
  }
  return { terms, compounds, singles: new Set([...terms].filter(term => !compoundParts.has(term))) };
}
const intersects = (a, b) => [...a].some(key => b.has(key));
const conflictingCompounds = (a, b) => !intersects(a, b) && [...a].some(left => [...b].some(right => left.split(' ')[0] === right.split(' ')[0]));

/** Callers supply real ACL eligibility before any text is read and again before IDs are returned. */
export function selectEvidenceGraph({ query, candidates, ranked, limit, floor, scoringTerms, isEligible, edges = [] }) {
  if (typeof query !== 'string' || !query.trim() || query.length > EVIDENCE_GRAPH_POLICY.queryChars ||
      !Array.isArray(candidates) || candidates.length > EVIDENCE_GRAPH_POLICY.candidates || !Array.isArray(ranked) ||
      ranked.length !== candidates.length || !Number.isInteger(limit) || limit < 1 || limit > EVIDENCE_GRAPH_POLICY.candidates ||
      !validScore(floor) || typeof scoringTerms !== 'function' || typeof isEligible !== 'function' ||
      !Array.isArray(edges) || edges.length > EVIDENCE_GRAPH_POLICY.densePairs) fail();
  const byId = new Map(), keys = new Map();
  for (const row of candidates) {
    if (!row || row.encLocked || row.deletedAt != null || row.teamScopeAmbiguous || !isEligible(row) ||
        !primitiveId(row.id) || byId.has(row.id)) fail();
    const text = row.text;
    if (typeof text !== 'string' || text.length > EVIDENCE_GRAPH_POLICY.textChars) fail();
    byId.set(row.id, row); keys.set(row.id, cues(text, scoringTerms));
  }
  const seen = new Set();
  for (const row of ranked) {
    if (!row || !primitiveId(row.id) || !byId.has(row.id) || seen.has(row.id) || !validScore(row.relevance) ||
        row.singleRelevance !== undefined && !validScore(row.singleRelevance) ||
        row.contextPartnerId !== undefined && (!primitiveId(row.contextPartnerId) || !byId.has(row.contextPartnerId) || row.contextPartnerId === row.id || !validScore(row.singleRelevance))) fail();
    seen.add(row.id);
  }
  const dense = new Map(), seenEdges = new Set();
  for (const edge of edges) {
    if (!edge || !primitiveId(edge.leftId) || !primitiveId(edge.rightId) || !byId.has(edge.leftId) || !byId.has(edge.rightId) || edge.leftId === edge.rightId || edge.score !== undefined && !validScore(edge.score)) fail();
    const key = JSON.stringify([edge.leftId, edge.rightId].sort()); if (seenEdges.has(key)) fail(); seenEdges.add(key);
    if (edge.denseSimilarity == null) continue;
    const left = byId.get(edge.leftId), right = byId.get(edge.rightId), score = edge.denseSimilarity;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < -1 || score > 1 ||
        typeof left.embeddingModel !== 'string' || !left.embeddingModel || left.embeddingModel.length > 1024 || left.embeddingModel !== right.embeddingModel) fail();
    if (score < EVIDENCE_GRAPH_POLICY.denseFloor || conflictingCompounds(keys.get(edge.leftId).compounds, keys.get(edge.rightId).compounds)) continue;
    for (const [from, to] of [[edge.leftId, edge.rightId], [edge.rightId, edge.leftId]]) { let neighbors = dense.get(from); if (!neighbors) { neighbors = new Set(); dense.set(from, neighbors); } neighbors.add(to); }
  }
  const normalizedQuery = ' ' + normal(query).replace(/[^\p{L}\p{N}'’_-]+/gu, ' ').trim() + ' ', postings = new Map();
  for (const [id, cue] of keys) for (const key of [...cue.terms, ...cue.compounds]) {
    if (!normalizedQuery.includes(' ' + key + ' ')) continue;
    let ids = postings.get(key); if (!ids) { ids = new Set(); postings.set(key, ids); } ids.add(id);
  }
  const anchors = [...postings].filter(([, ids]) => ids.size <= candidates.length * EVIDENCE_GRAPH_POLICY.maxAnchorFraction);
  const compoundAnchors = anchors.filter(([key]) => key.includes(' '));
  const chosenAnchors = anchors.filter(([key]) => key.includes(' ') || !compoundAnchors.some(([full]) => full.split(' ').includes(key)));
  const roots = new Set(chosenAnchors.flatMap(([, ids]) => [...ids])), paths = new Map();
  const orderedRoots = ranked.filter(row => roots.has(row.id));
  for (const row of orderedRoots) paths.set(row.id, { id: row.id, kind: 'anchor', seedId: row.id, depth: 0 });
  const queue = orderedRoots.map(row => row.id);
  for (let at = 0; at < queue.length; at++) {
    const id = queue[at], prior = paths.get(id); if (prior.depth === EVIDENCE_GRAPH_POLICY.maxHops) continue;
    const left = keys.get(id);
    for (const row of ranked) {
      if (paths.has(row.id)) continue;
      const right = keys.get(row.id), compound = intersects(left.compounds, right.compounds);
      const term = intersects(left.singles, right.singles), semantic = dense.get(id)?.has(row.id);
      if (!compound && !term && !semantic) continue;
      paths.set(row.id, { id: row.id, kind: compound ? 'compound' : term ? 'term' : 'dense', seedId: prior.seedId, depth: prior.depth + 1 }); queue.push(row.id);
    }
  }
  const component = ranked.filter(row => paths.has(row.id));
  const admitted = ranked.some(row => row.relevance >= floor);
  const hasBridge = [...paths.values()].some(row => row.kind === 'compound' || row.kind === 'term');
  const supported = component.some(row => (row.singleRelevance ?? row.relevance) >= floor) ||
    edges.some(edge => paths.has(edge.leftId) && paths.has(edge.rightId) && edge.score !== undefined && edge.score >= floor);
  // A heading or a translated topic alone cannot justify restricting semantic results.
  // Scope support must come from an individual score or a pair inside that component.
  const usedGraph = admitted && hasBridge && supported;
  const scoped = usedGraph ? component : ranked;
  const selected = admitted ? scoped.slice(0, limit) : [];
  for (const row of candidates) if (!isEligible(row) || row.encLocked || row.deletedAt != null || row.teamScopeAmbiguous) fail();
  return {
    admitted, usedGraph, candidates: candidates.length, reachable: paths.size,
    hits: selected.map(row => usedGraph ? paths.get(row.id) : { id: row.id, kind: 'ranking', depth: 0 }),
  };
}
