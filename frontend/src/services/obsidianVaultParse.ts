/**
 * Parser de vault Obsidian: frontmatter YAML simples, [[wikilinks]], pastas → lanes.
 * Só corre no cliente. Não envia plaintext a nenhum servidor.
 */

import {
  detectProjectStatus,
  detectTaxonomyLane,
  type ProjectStatus,
  type TaxonomyLane,
} from '../utils/taxonomy';

export interface ObsidianFrontmatter {
  title?: string;
  tags: string[];
  status?: ProjectStatus | null;
  aliases: string[];
  raw: Record<string, string | string[]>;
}

export interface ParsedObsidianNote {
  /** Caminho relativo normalizado (posix), ex. A Diário/semana-1.md */
  path: string;
  fileName: string;
  /** Nome sem extensão */
  stem: string;
  title: string;
  body: string;
  /** Corpo sem frontmatter */
  content: string;
  frontmatter: ObsidianFrontmatter;
  wikilinks: string[];
  lane: TaxonomyLane | null;
  projectStatus: ProjectStatus | null;
  topFolder: string | null;
}

export interface ObsidianParseStats {
  notes: number;
  withFrontmatter: number;
  wikilinkRefs: number;
  lanes: Partial<Record<TaxonomyLane, number>>;
}

const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;

export function stripObsidianExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '');
}

export function normalizeWikiTarget(raw: string): string {
  const withoutAlias = raw.split('|')[0]?.trim() ?? '';
  const withoutHeading = withoutAlias.split('#')[0]?.trim() ?? '';
  return withoutHeading
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .replace(/\.markdown$/i, '')
    .trim();
}

export function wikiLookupKey(value: string): string {
  return normalizeWikiTarget(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrai [[targets]] do markdown (sem blocos de código simples). */
export function extractWikilinks(markdown: string): string[] {
  const withoutCode = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');
  const links: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(withoutCode)) !== null) {
    const target = normalizeWikiTarget(match[1]);
    if (target) links.push(target);
  }
  return Array.from(new Set(links));
}

function parseYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseYamlList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((part) => parseYamlScalar(part))
    .filter(Boolean);
}

/**
 * Frontmatter YAML mínimo (chave: valor / listas [a, b]).
 * Não pretende ser um parser YAML completo — cobre o que a maioria dos vaults usa.
 */
export function parseFrontmatter(markdown: string): { frontmatter: ObsidianFrontmatter; body: string } {
  const empty: ObsidianFrontmatter = { tags: [], aliases: [], raw: {}, status: null };
  if (!markdown.startsWith('---')) {
    return { frontmatter: empty, body: markdown };
  }
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter: empty, body: markdown };
  }
  const block = markdown.slice(3, end).replace(/^\r?\n/, '');
  const body = markdown.slice(end + 4).replace(/^\r?\n/, '');
  const raw: Record<string, string | string[]> = {};

  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const valueRaw = trimmed.slice(colon + 1).trim();
    if (!key) continue;
    if (valueRaw.startsWith('[')) {
      raw[key] = parseYamlList(valueRaw);
    } else if (valueRaw) {
      raw[key] = parseYamlScalar(valueRaw);
    }
  }

  const tagsValue = raw.tags;
  const tags = Array.isArray(tagsValue)
    ? tagsValue.map(String)
    : typeof tagsValue === 'string'
      ? tagsValue.split(/[,\s]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean)
      : [];

  const aliasesValue = raw.aliases ?? raw.alias;
  const aliases = Array.isArray(aliasesValue)
    ? aliasesValue.map(String)
    : typeof aliasesValue === 'string'
      ? [aliasesValue]
      : [];

  const statusRaw = typeof raw.status === 'string'
    ? raw.status
    : typeof raw.project === 'string'
      ? raw.project
      : typeof raw.state === 'string'
        ? raw.state
        : null;

  const title = typeof raw.title === 'string' ? raw.title : undefined;

  return {
    frontmatter: {
      title,
      tags,
      aliases,
      status: detectProjectStatus(statusRaw),
      raw,
    },
    body,
  };
}

function topFolderFromPath(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  // Preferir o primeiro segmento que mapeia A–E (ignora raiz tipo "Starter Founder/")
  for (const part of parts.slice(0, -1)) {
    if (detectTaxonomyLane(part)) return part;
  }
  return parts[0];
}

export function parseObsidianMarkdown(
  relativePath: string,
  markdown: string,
): ParsedObsidianNote {
  const path = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = path.split('/');
  const fileName = parts[parts.length - 1] || path;
  const stem = stripObsidianExtension(fileName);
  const { frontmatter, body } = parseFrontmatter(markdown);
  const topFolder = topFolderFromPath(path);
  const lane = detectTaxonomyLane(topFolder) || detectTaxonomyLane(frontmatter.raw.lane as string | undefined);
  const projectStatus = frontmatter.status
    || detectProjectStatus(frontmatter.raw.status as string | undefined)
    || (lane === 'B' ? 'active' : null);
  const title = frontmatter.title?.trim() || stem;
  const wikilinks = extractWikilinks(body);

  return {
    path,
    fileName,
    stem,
    title,
    body: markdown,
    content: body.trim(),
    frontmatter,
    wikilinks,
    lane,
    projectStatus,
    topFolder,
  };
}

export function isMarkdownVaultFile(file: File): boolean {
  const name = (file.webkitRelativePath || file.name).toLowerCase();
  return name.endsWith('.md') || name.endsWith('.markdown');
}

/** Heurística: vault Obsidian se ≥40% markdown ou ≥3 .md com wikilinks/frontmatter. */
export function looksLikeObsidianVault(files: File[]): boolean {
  if (files.length === 0) return false;
  const md = files.filter(isMarkdownVaultFile);
  if (md.length === 0) return false;
  if (md.length / files.length >= 0.4) return true;
  return md.length >= 3;
}

export async function parseObsidianFiles(files: File[], assertCurrent: () => void = () => {}): Promise<{
  notes: ParsedObsidianNote[];
  stats: ObsidianParseStats;
  skipped: string[];
}> {
  const notes: ParsedObsidianNote[] = [];
  const skipped: string[] = [];
  const lanes: Partial<Record<TaxonomyLane, number>> = {};

  for (const file of files) {
    assertCurrent();
    if (!isMarkdownVaultFile(file)) {
      skipped.push(file.webkitRelativePath || file.name);
      continue;
    }
    const relative = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    if (relative.split('/').some((part) => part === '.obsidian' || part === '.trash')) {
      skipped.push(relative);
      continue;
    }
    try {
      let text = '';
      if (typeof file.text === 'function') {
        try {
          text = await file.text();
          assertCurrent();
        } catch {
          assertCurrent();
          text = '';
        }
      }
      if (!text) {
        const buffer = await file.arrayBuffer();
        assertCurrent();
        text = new TextDecoder('utf-8').decode(buffer);
      }
      if (!text) {
        skipped.push(relative);
        continue;
      }
      const note = parseObsidianMarkdown(relative, text);
      if (!note.content.trim() && !note.frontmatter.title) {
        skipped.push(relative);
        continue;
      }
      notes.push(note);
      if (note.lane) lanes[note.lane] = (lanes[note.lane] || 0) + 1;
    } catch {
      assertCurrent();
      skipped.push(file.webkitRelativePath || file.name);
    }
  }

  notes.sort((a, b) => a.path.localeCompare(b.path, 'pt'));
  assertCurrent();

  const stats: ObsidianParseStats = {
    notes: notes.length,
    withFrontmatter: notes.filter((n) => Object.keys(n.frontmatter.raw).length > 0).length,
    wikilinkRefs: notes.reduce((sum, n) => sum + n.wikilinks.length, 0),
    lanes,
  };

  return { notes, stats, skipped };
}

/**
 * Resolve wikilinks → ids. Chaves: path completo, stem, title, aliases.
 */
export function buildWikilinkIndex(
  notes: Array<{ id: string; note: ParsedObsidianNote }>,
): Map<string, string> {
  const index = new Map<string, string>();
  const set = (key: string, id: string) => {
    const k = wikiLookupKey(key);
    if (!k) return;
    if (!index.has(k)) index.set(k, id);
  };

  for (const { id, note } of notes) {
    set(note.path, id);
    set(stripObsidianExtension(note.path), id);
    set(note.stem, id);
    set(note.title, id);
    for (const alias of note.frontmatter.aliases) set(alias, id);
    // basename path segments for nested notes
    const parts = stripObsidianExtension(note.path).split('/');
    if (parts.length > 1) {
      set(parts[parts.length - 1], id);
    }
  }
  return index;
}

export function resolveNoteConnections(
  note: ParsedObsidianNote,
  index: Map<string, string>,
  selfId: string,
): { resolved: string[]; unresolved: string[] } {
  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const link of note.wikilinks) {
    const id = index.get(wikiLookupKey(link));
    if (id && id !== selfId) resolved.push(id);
    else unresolved.push(link);
  }
  return {
    resolved: Array.from(new Set(resolved)),
    unresolved: Array.from(new Set(unresolved)),
  };
}

export function summarizeParseStats(stats: ObsidianParseStats): string {
  const laneBits = Object.entries(stats.lanes)
    .map(([lane, count]) => `${lane}:${count}`)
    .join(' ');
  return `${stats.notes} notas · ${stats.wikilinkRefs} wikilinks · frontmatter ${stats.withFrontmatter}${laneBits ? ` · ${laneBits}` : ''}`;
}
