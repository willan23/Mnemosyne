/**
 * Taxonomia humana A–E (rampa cognitiva, não pastas no schema).
 * Mapeia nomes de pasta / tags para lane + tipo celeste existente.
 */

import type { CelestialType } from '../types/universe';

export type TaxonomyLane = 'A' | 'B' | 'C' | 'D' | 'E';

export type ProjectStatus = 'planned' | 'active' | 'done';

export const TAXONOMY_LANES: readonly TaxonomyLane[] = ['A', 'B', 'C', 'D', 'E'] as const;

export const TAXONOMY_LABELS: Record<TaxonomyLane, { pt: string; en: string }> = {
  A: { pt: 'Diário', en: 'Journal' },
  B: { pt: 'Projetos', en: 'Projects' },
  C: { pt: 'Fundamentos', en: 'Foundations' },
  D: { pt: 'Ferramentas', en: 'Tools' },
  E: { pt: 'Biblioteca', en: 'Library' },
};

/** Cores de filtro HUD (não substituem CELESTIAL_CONFIGS). */
export const TAXONOMY_COLORS: Record<TaxonomyLane, string> = {
  A: '#44ddff',
  B: '#4488ff',
  C: '#aaccff',
  D: '#aaaaaa',
  E: '#ff44aa',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, { pt: string; en: string }> = {
  planned: { pt: 'Planeado', en: 'Planned' },
  active: { pt: 'Em curso', en: 'In progress' },
  done: { pt: 'Concluído', en: 'Done' },
};

const LANE_ALIASES: Record<TaxonomyLane, string[]> = {
  A: ['a', 'diario', 'diário', 'journal', 'daily', 'log', 'inbox'],
  B: ['b', 'projetos', 'projects', 'project', 'produto', 'product', 'building'],
  C: ['c', 'fundamentos', 'foundations', 'fundamentals', 'concepts', 'conceitos', 'base'],
  D: ['d', 'ferramentas', 'tools', 'tooling', 'stack', 'ops'],
  E: ['e', 'biblioteca', 'library', 'refs', 'references', 'leitura', 'reading', 'papers'],
};

const STATUS_ALIASES: Record<ProjectStatus, string[]> = {
  planned: ['planned', 'planeado', 'planejado', 'todo', 'backlog', 'ideia'],
  active: ['active', 'em curso', 'em_curso', 'doing', 'wip', 'progress', 'curso'],
  done: ['done', 'concluido', 'concluído', 'completo', 'finished', 'shipped'],
};

export function normalizeTaxonomyToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .trim();
}

/** Extrai lane a partir do nome da pasta de topo ou de um token livre. */
export function detectTaxonomyLane(raw: string | null | undefined): TaxonomyLane | null {
  if (!raw?.trim()) return null;
  const token = normalizeTaxonomyToken(raw);
  // "A Diário", "A - Projetos", "01-A-diario"
  const letterMatch = token.match(/(?:^|[^a-z])([abcde])(?:\b|[^a-z])/i)
    || token.match(/^([abcde])[\s\-_.]/);
  if (letterMatch) {
    const letter = letterMatch[1].toUpperCase() as TaxonomyLane;
    if (TAXONOMY_LANES.includes(letter)) return letter;
  }
  for (const lane of TAXONOMY_LANES) {
    if (LANE_ALIASES[lane].some((alias) => token === alias || token.startsWith(`${alias} `) || token.includes(` ${alias}`))) {
      return lane;
    }
  }
  return null;
}

export function detectProjectStatus(raw: string | null | undefined): ProjectStatus | null {
  if (!raw?.trim()) return null;
  const token = normalizeTaxonomyToken(raw);
  for (const status of Object.keys(STATUS_ALIASES) as ProjectStatus[]) {
    if (STATUS_ALIASES[status].some((alias) => token === alias || token.includes(alias))) {
      return status;
    }
  }
  return null;
}

export function celestialTypeForLane(lane: TaxonomyLane | null | undefined): CelestialType {
  switch (lane) {
    case 'A':
      return 'comet';
    case 'B':
      return 'planet';
    case 'C':
      return 'star';
    case 'D':
      return 'moon';
    case 'E':
      return 'nebula';
    default:
      return 'planet';
  }
}

export function laneTag(lane: TaxonomyLane): string {
  return `lane:${lane}`;
}

export function parseLaneTag(tags: string[] | null | undefined): TaxonomyLane | null {
  if (!tags?.length) return null;
  for (const tag of tags) {
    const match = /^lane:([ABCDE])$/i.exec(tag.trim());
    if (match) return match[1].toUpperCase() as TaxonomyLane;
  }
  return null;
}

export function parseProjectStatusTag(tags: string[] | null | undefined): ProjectStatus | null {
  if (!tags?.length) return null;
  for (const tag of tags) {
    const match = /^status:(planned|active|done)$/i.exec(tag.trim());
    if (match) return match[1].toLowerCase() as ProjectStatus;
  }
  return null;
}
