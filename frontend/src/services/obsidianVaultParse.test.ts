/**
 * Testes do parser Obsidian — fixture real, sem mocks de rede.
 */

import { describe, expect, it } from 'vitest';
import {
  buildWikilinkIndex,
  extractWikilinks,
  looksLikeObsidianVault,
  parseFrontmatter,
  parseObsidianMarkdown,
  resolveNoteConnections,
  wikiLookupKey,
} from './obsidianVaultParse';
import { detectTaxonomyLane, celestialTypeForLane } from '../utils/taxonomy';
import { STARTER_FOUNDER_NOTES, STARTER_FOUNDER_NOTE_COUNT } from '../data/starterFounder';
import { parseStarterFounderNotes } from './starterUniverse';

describe('obsidianVaultParse', () => {
  it('extrai wikilinks com alias e heading', () => {
    const links = extractWikilinks('Ver [[Nota Base|alias]] e [[Outra#secção]] mais `[[ignorar]]`');
    expect(links).toEqual(['Nota Base', 'Outra']);
  });

  it('parseia frontmatter YAML simples', () => {
    const md = `---
title: Hello
tags: [a, b]
status: active
---

Corpo com [[Link]].`;
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter.title).toBe('Hello');
    expect(frontmatter.tags).toEqual(['a', 'b']);
    expect(frontmatter.status).toBe('active');
    expect(body).toContain('Corpo');
    expect(extractWikilinks(body)).toEqual(['Link']);
  });

  it('detecta lane pela pasta de topo', () => {
    const note = parseObsidianMarkdown(
      'B Projetos/app.md',
      '---\ntitle: App\n---\n\nTexto',
    );
    expect(note.lane).toBe('B');
    expect(note.topFolder).toBe('B Projetos');
    expect(celestialTypeForLane(note.lane)).toBe('planet');
  });

  it('resolve wikilinks por título e stem', () => {
    const a = parseObsidianMarkdown('C Fundamentos/e2ee-real.md', '---\ntitle: E2EE real\n---\n\nx');
    const b = parseObsidianMarkdown(
      'A Diário/x.md',
      '---\ntitle: Diario\n---\n\nVer [[E2EE real]] e [[e2ee-real]].',
    );
    const created = [
      { id: 'id-a', note: a },
      { id: 'id-b', note: b },
    ];
    const index = buildWikilinkIndex(created);
    expect(index.get(wikiLookupKey('E2EE real'))).toBe('id-a');
    const { resolved, unresolved } = resolveNoteConnections(b, index, 'id-b');
    expect(resolved).toContain('id-a');
    expect(unresolved).toEqual([]);
  });

  it('looksLikeObsidianVault com maioria markdown', () => {
    const files = [
      new File(['a'], 'a.md', { type: 'text/markdown' }),
      new File(['b'], 'b.md', { type: 'text/markdown' }),
      new File(['c'], 'c.txt', { type: 'text/plain' }),
    ];
    expect(looksLikeObsidianVault(files)).toBe(true);
  });
});

describe('taxonomy', () => {
  it('mapeia aliases de pasta', () => {
    expect(detectTaxonomyLane('A Diário')).toBe('A');
    expect(detectTaxonomyLane('projects')).toBe('B');
    expect(detectTaxonomyLane('Biblioteca')).toBe('E');
  });
});

describe('starterFounder seed', () => {
  it('tem contagem alinhada e paths A–E', () => {
    expect(STARTER_FOUNDER_NOTES.length).toBe(STARTER_FOUNDER_NOTE_COUNT);
    const notes = parseStarterFounderNotes();
    expect(notes.length).toBe(STARTER_FOUNDER_NOTE_COUNT);
    const sample = STARTER_FOUNDER_NOTES[0].markdown;
    expect(extractWikilinks(sample).length).toBeGreaterThan(0);
    expect(notes.some((n) => n.wikilinks.length > 0)).toBe(true);
    const wikilinkRefs = notes.reduce((sum, n) => sum + n.wikilinks.length, 0);
    expect(wikilinkRefs).toBeGreaterThan(20);
    expect(notes.filter((n) => n.lane === 'A').length).toBeGreaterThan(0);
    expect(notes.filter((n) => n.lane === 'B').length).toBeGreaterThan(0);
    expect(notes.filter((n) => n.lane === 'C').length).toBeGreaterThan(0);
    expect(notes.filter((n) => n.lane === 'D').length).toBeGreaterThan(0);
    expect(notes.filter((n) => n.lane === 'E').length).toBeGreaterThan(0);
  });

  it('resolve a maioria dos wikilinks internos do pack', () => {
    const notes = parseStarterFounderNotes();
    const created = notes.map((note, i) => ({ id: `n${i}`, note }));
    const index = buildWikilinkIndex(created);
    let resolved = 0;
    let total = 0;
    for (const row of created) {
      const result = resolveNoteConnections(row.note, index, row.id);
      total += row.note.wikilinks.length;
      resolved += result.resolved.length;
    }
    expect(total).toBeGreaterThan(0);
    expect(resolved / total).toBeGreaterThanOrEqual(0.55);
  });
});
