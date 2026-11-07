/**
 * Motor de pesquisa de memórias — ranking textual + semântico + operadores.
 * Usado pela Command Palette e pelo filtro do grafo.
 */

export interface SearchableMemory {
  id: string;
  encLocked?: boolean;
  title?: string;
  text?: string;
  tags?: string[];
  category?: string;
  celestialType?: string;
  timestamp?: number;
  updatedAt?: number;
  semanticScore?: number;
  embedding?: number[];
  nodes?: Array<{ id: string; label: string; type: string }>;
}

export interface MemorySearchHit {
  memory: SearchableMemory;
  score: number;
  matchKind: 'exact' | 'title' | 'text' | 'tag' | 'semantic' | 'mixed';
  snippet: string;
  matchedTags: string[];
}

/** Immutable per-document text preparation for an ephemeral local index. */
export interface PreparedSearchMemory {
  memory: SearchableMemory;
  title: string;
  body: string;
  tags: string[];
  corpusTokens: Set<string>;
  indexTerms: Set<string>;
}

export interface ParsedSearchQuery {
  raw: string;
  text: string;
  tags: string[];
  category?: string;
  entities?: string[];
  after?: number;
  before?: number;
  invalidFilter?: boolean;
}

const STOP = new Set([
  'a', 'as', 'o', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'um', 'uma',
  'para', 'por', 'com', 'no', 'na', 'nos', 'nas', 'the', 'and', 'or', 'of', 'to',
  // Function words must not provide lexical evidence for an unrelated question.
  // Keep full-title/full-phrase matches above token scoring, including names.
  'ao', 'aos', 'pelo', 'pela', 'pelos', 'pelas', 'se', 'que', 'quem', 'qual', 'quais',
  'quando', 'onde', 'como', 'quanto', 'quantos', 'quanta', 'quantas', 'esta', 'estao',
  'este', 'estes', 'estas', 'isto', 'isso', 'foi', 'ser', 'ate', 'desde', 'sobre',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'which', 'what', 'when', 'where',
  'why', 'how', 'who', 'whom', 'whose', 'this', 'that', 'these', 'those', 'at', 'on',
  'in', 'for', 'with', 'from', 'by', 'it', 'its',
  'le', 'les', 'la', 'un', 'une', 'des', 'du', 'au', 'aux', 'et', 'ou', 'en', 'dans',
  'avec', 'pour', 'par', 'sur', 'ce', 'cet', 'cette', 'ces', 'est', 'sont', 'etait',
  'quel', 'quelle', 'quels', 'quelles', 'quand', 'comment', 'qui', 'dont',
]);

/** Interpreta `tag:trabalho #ideia cat:nota consulta livre` */
export function parseSearchQuery(input: string): ParsedSearchQuery {
  const raw = input.trim();
  if (!raw) return { raw: '', text: '', tags: [] };

  const tags: string[] = [];
  let category: string | undefined;
  const entities: string[] = [];
  let after: number | undefined;
  let before: number | undefined;
  let invalidFilter = false;
  const parts: string[] = [];

  for (const token of raw.match(/(?:[^\s"]+|"[^"]*")+/g) || []) {
    const entityOp = token.match(/^entity:(.*)$/i);
    if (entityOp) {
      const value = entityOp[1].replace(/^"(.*)"$/, '$1').trim();
      if (!value || value.includes('"')) invalidFilter = true;
      else entities.push(normalize(value));
      continue;
    }
    const dateOp = token.match(/^(after|before):(.*)$/i);
    if (dateOp) {
      const value = dateOp[2];
      const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) invalidFilter = true;
      else if (dateOp[1].toLowerCase() === 'after') after = Math.max(after ?? -Infinity, timestamp);
      else before = Math.min(before ?? Infinity, timestamp);
      continue;
    }
    const hash = token.match(/^#([\wÀ-ÿ-]+)$/i);
    const tagOp = token.match(/^tag:([\wÀ-ÿ-]+)$/i);
    const catOp = token.match(/^(?:cat|category|tipo):([\wÀ-ÿ-]+)$/i);
    if (hash) {
      tags.push(hash[1].toLowerCase());
      continue;
    }
    if (tagOp) {
      tags.push(tagOp[1].toLowerCase());
      continue;
    }
    if (catOp) {
      category = catOp[1].toLowerCase();
      continue;
    }
    parts.push(token);
  }

  return {
    raw,
    text: parts.join(' ').trim(),
    tags: Array.from(new Set(tags)),
    category,
    entities: Array.from(new Set(entities)), after, before,
    invalidFilter: invalidFilter || (after !== undefined && before !== undefined && after >= before),
  };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export { normalize as normalizeSearchValue };

export function searchIndexTerms(value: string): string[] {
  return normalize(value).split(/[^a-z0-9à-ÿ]+/i).filter(Boolean);
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9à-ÿ]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

export { tokens as searchScoringTerms };

export function prepareSearchMemory(memory: SearchableMemory): PreparedSearchMemory {
  const title = normalize(memory.title || '');
  const body = normalize(memory.text || '');
  const tags = (memory.tags || []).map(normalize);
  const corpus = `${title} ${body} ${tags.join(' ')}`;
  return { memory, title, body, tags, corpusTokens: new Set(tokens(corpus)), indexTerms: new Set(searchIndexTerms(corpus)) };
}

function buildSnippet(text: string, query: string, max = 120): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const q = normalize(query);
  const hay = normalize(compact);
  const idx = q ? hay.indexOf(q.split(/\s+/)[0] || q) : -1;
  if (idx < 0) {
    return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
  }
  const start = Math.max(0, idx - 28);
  const slice = compact.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${slice}${start + max < compact.length ? '…' : ''}`;
}

function textScore(memory: SearchableMemory, queryText: string, prepared?: PreparedSearchMemory): {
  score: number;
  kind: MemorySearchHit['matchKind'];
} {
  if (!queryText) return { score: 0, kind: 'text' };
  const q = normalize(queryText);
  const title = prepared?.title ?? normalize(memory.title || '');
  const body = prepared?.body ?? normalize(memory.text || '');
  const tags = prepared?.tags ?? (memory.tags || []).map((t) => normalize(t));

  if (title === q) return { score: 1, kind: 'exact' };
  if (title.includes(q)) return { score: 0.92, kind: 'title' };
  if (tags.some((t) => t === q || t.includes(q))) return { score: 0.84, kind: 'tag' };
  if (body.includes(q)) return { score: 0.72, kind: 'text' };

  const qTokens = tokens(queryText);
  if (!qTokens.length) return { score: 0, kind: 'text' };

  const corpusTokens = prepared?.corpusTokens ?? new Set(tokens(`${title} ${body} ${tags.join(' ')}`));
  let hit = 0;
  for (const token of qTokens) {
    if (corpusTokens.has(token) || [...corpusTokens].some((candidate) => {
      const shorter = token.length <= candidate.length ? token : candidate;
      const longer = token.length > candidate.length ? token : candidate;
      // Bound prefix matching to close word forms. Arbitrary substrings made
      // e.g. a question about a station match a stationery invoice.
      return shorter.length >= 4 && shorter.length / longer.length >= 0.8 && longer.startsWith(shorter);
    })) {
      hit += 1;
    }
  }
  const ratio = hit / qTokens.length;
  if (ratio <= 0) return { score: 0, kind: 'text' };
  return {
    score: 0.35 + ratio * 0.45,
    kind: title && qTokens.some((t) => title.includes(t)) ? 'title' : 'text',
  };
}

function passesTagFilter(memory: SearchableMemory, requiredTags: string[]): boolean {
  if (!requiredTags.length) return true;
  const tags = (memory.tags || []).map((t) => normalize(t));
  return requiredTags.every((tag) => tags.some((t) => t === tag || t.includes(tag)));
}

function passesCategoryFilter(memory: SearchableMemory, category?: string): boolean {
  if (!category) return true;
  const cat = normalize(memory.category || '');
  const type = normalize(memory.celestialType || '');
  return cat.includes(category) || type.includes(category);
}

export function filterSearchCandidates<T extends SearchableMemory>(memories: readonly T[], queryInput: string): T[] {
  const parsed = parseSearchQuery(queryInput);
  if (parsed.invalidFilter) return [];
  return memories.filter((memory) => !memory.encLocked &&
    (parsed.after === undefined || (Number.isFinite(memory.timestamp) && memory.timestamp! >= parsed.after)) &&
    (parsed.before === undefined || (Number.isFinite(memory.timestamp) && memory.timestamp! < parsed.before)) &&
    (parsed.entities || []).every(entity => Array.isArray(memory.nodes) &&
      memory.nodes.some(node => typeof node?.label === 'string' && normalize(node.label) === entity)) &&
    passesTagFilter(memory, parsed.tags) && passesCategoryFilter(memory, parsed.category));
}

/**
 * Rankeia memórias com query textual + scores semânticos opcionais.
 */
export function searchMemories(
  memories: readonly SearchableMemory[],
  queryInput: string,
  options?: {
    semanticScores?: Map<string, number>;
    limit?: number;
    semanticFloor?: number;
    prepared?: ReadonlyMap<string, PreparedSearchMemory>;
  }
): MemorySearchHit[] {
  const parsed = parseSearchQuery(queryInput);
  if (!parsed.raw) return [];

  const semanticFloor = options?.semanticFloor ?? 0.38;
  const limit = options?.limit ?? 24;
  const scores = options?.semanticScores;
  const hits: MemorySearchHit[] = [];

  for (const memory of filterSearchCandidates(memories, queryInput)) {

    const cached = options?.prepared?.get(memory.id);
    const textual = textScore(memory, parsed.text, cached?.memory === memory ? cached : undefined);
    const semantic = scores ? scores.get(memory.id) ?? 0 : memory.semanticScore ?? 0;
    const hasTextQuery = parsed.text.length > 0;

    // Só tags/categoria: incluir todas as que passam o filtro
    if (!hasTextQuery && (parsed.tags.length || parsed.category || parsed.entities?.length ||
      parsed.after !== undefined || parsed.before !== undefined)) {
      hits.push({
        memory,
        score: 0.55 + Math.min(0.3, (memory.tags?.length || 0) * 0.05),
        matchKind: 'tag',
        snippet: buildSnippet(memory.text || memory.title || '', ''),
        matchedTags: (memory.tags || []).filter((t) =>
          parsed.tags.some((pt) => normalize(t).includes(pt))
        ),
      });
      continue;
    }

    if (!hasTextQuery) continue;

    const strongText = textual.score >= 0.35;
    const strongSemantic = semantic >= semanticFloor;
    if (!strongText && !strongSemantic) continue;

    let score = Math.max(textual.score, semantic * 0.95);
    if (strongText && strongSemantic) {
      score = Math.min(1, textual.score * 0.55 + semantic * 0.55 + 0.08);
    }

    // Recência leve
    const age = Date.now() - (memory.updatedAt || memory.timestamp || 0);
    if (age > 0 && age < 14 * 86_400_000) score = Math.min(1, score + 0.03);

    let matchKind: MemorySearchHit['matchKind'] = textual.kind;
    if (strongSemantic && textual.score < 0.35) matchKind = 'semantic';
    else if (strongSemantic && strongText) matchKind = 'mixed';

    hits.push({
      memory: { ...memory, semanticScore: semantic },
      score,
      matchKind,
      snippet: buildSnippet(memory.text || memory.title || '', parsed.text),
      matchedTags: (memory.tags || []).filter((t) => {
        const nt = normalize(t);
        return parsed.tags.some((pt) => nt.includes(pt)) || tokens(parsed.text).some((qt) => nt.includes(qt));
      }),
    });
  }

  return hits
    .sort((a, b) => b.score - a.score || (b.memory.timestamp || 0) - (a.memory.timestamp || 0))
    .slice(0, limit);
}

