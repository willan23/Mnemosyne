/**
 * Motor de pesquisa de memórias — ranking textual + semântico + operadores.
 * Usado pela Command Palette e pelo filtro do grafo.
 */

export interface SearchableMemory {
  id: string;
  title?: string;
  text?: string;
  tags?: string[];
  category?: string;
  celestialType?: string;
  timestamp?: number;
  updatedAt?: number;
  semanticScore?: number;
  embedding?: number[];
}

export interface MemorySearchHit {
  memory: SearchableMemory;
  score: number;
  matchKind: 'exact' | 'title' | 'text' | 'tag' | 'semantic' | 'mixed';
  snippet: string;
  matchedTags: string[];
}

export interface ParsedSearchQuery {
  raw: string;
  text: string;
  tags: string[];
  category?: string;
}

const STOP = new Set([
  'a', 'as', 'o', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'um', 'uma',
  'para', 'por', 'com', 'no', 'na', 'nos', 'nas', 'the', 'and', 'or', 'of', 'to',
]);

/** Interpreta `tag:trabalho #ideia cat:nota consulta livre` */
export function parseSearchQuery(input: string): ParsedSearchQuery {
  const raw = input.trim();
  if (!raw) return { raw: '', text: '', tags: [] };

  const tags: string[] = [];
  let category: string | undefined;
  const parts: string[] = [];

  for (const token of raw.split(/\s+/)) {
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
  };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9à-ÿ]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
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

function textScore(memory: SearchableMemory, queryText: string): {
  score: number;
  kind: MemorySearchHit['matchKind'];
} {
  if (!queryText) return { score: 0, kind: 'text' };
  const q = normalize(queryText);
  const title = normalize(memory.title || '');
  const body = normalize(memory.text || '');
  const tags = (memory.tags || []).map((t) => normalize(t));

  if (title === q) return { score: 1, kind: 'exact' };
  if (title.includes(q)) return { score: 0.92, kind: 'title' };
  if (tags.some((t) => t === q || t.includes(q))) return { score: 0.84, kind: 'tag' };
  if (body.includes(q)) return { score: 0.72, kind: 'text' };

  const qTokens = tokens(queryText);
  if (!qTokens.length) return { score: 0, kind: 'text' };

  const corpus = `${title} ${body} ${tags.join(' ')}`;
  const corpusTokens = new Set(tokens(corpus));
  let hit = 0;
  for (const token of qTokens) {
    if (corpusTokens.has(token) || [...corpusTokens].some((c) => c.includes(token) || token.includes(c))) {
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

/**
 * Rankeia memórias com query textual + scores semânticos opcionais.
 */
export function searchMemories(
  memories: SearchableMemory[],
  queryInput: string,
  options?: {
    semanticScores?: Map<string, number>;
    limit?: number;
    semanticFloor?: number;
  }
): MemorySearchHit[] {
  const parsed = parseSearchQuery(queryInput);
  if (!parsed.raw) return [];

  const semanticFloor = options?.semanticFloor ?? 0.38;
  const limit = options?.limit ?? 24;
  const scores = options?.semanticScores;
  const hits: MemorySearchHit[] = [];

  for (const memory of memories) {
    if (!passesTagFilter(memory, parsed.tags)) continue;
    if (!passesCategoryFilter(memory, parsed.category)) continue;

    const textual = textScore(memory, parsed.text);
    const semantic = scores?.get(memory.id) ?? memory.semanticScore ?? 0;
    const hasTextQuery = parsed.text.length > 0;

    // Só tags/categoria: incluir todas as que passam o filtro
    if (!hasTextQuery && (parsed.tags.length || parsed.category)) {
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
      memory: { ...memory, semanticScore: semantic || memory.semanticScore },
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

const RECENT_KEY = 'mnemosyne.search.recent.v1';
const MAX_RECENT = 8;

export function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function pushRecentSearch(query: string): void {
  const q = query.trim();
  if (q.length < 2) return;
  try {
    const prev = readRecentSearches().filter((item) => item.toLowerCase() !== q.toLowerCase());
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, MAX_RECENT)));
  } catch {
    // ignore
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
}
