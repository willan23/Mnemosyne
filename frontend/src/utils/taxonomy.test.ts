/**
 * Testes taxonomy — lanes e estados.
 */

import { describe, expect, it } from 'vitest';
import {
  detectProjectStatus,
  detectTaxonomyLane,
  laneTag,
  parseLaneTag,
  parseProjectStatusTag,
} from '../utils/taxonomy';

describe('taxonomy helpers', () => {
  it('parseia tags lane/status', () => {
    expect(parseLaneTag(['foo', 'lane:C'])).toBe('C');
    expect(parseProjectStatusTag(['status:done'])).toBe('done');
    expect(laneTag('A')).toBe('lane:A');
  });

  it('detecta status em PT/EN', () => {
    expect(detectProjectStatus('em curso')).toBe('active');
    expect(detectProjectStatus('planeado')).toBe('planned');
    expect(detectProjectStatus('concluído')).toBe('done');
  });

  it('detecta lane por letra prefixada', () => {
    expect(detectTaxonomyLane('A - Diario')).toBe('A');
    expect(detectTaxonomyLane('01-B-projetos')).toBe('B');
  });
});
