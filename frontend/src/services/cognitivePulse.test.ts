import { describe, expect, it } from 'vitest';
import type { SessionData } from '../hooks/useSessions';
import {
  buildCognitivePulse,
  markPulseSeen,
  resetPulseSeen,
  shouldShowPulseToday,
} from './cognitivePulse';

const memory = (partial: Partial<SessionData> & { id: string; text: string }): SessionData => ({
  id: partial.id,
  uid: 'u1',
  text: partial.text,
  title: partial.title || partial.text.slice(0, 24),
  timestamp: partial.timestamp ?? Date.now() - 40 * 24 * 60 * 60 * 1000,
  updatedAt: partial.updatedAt ?? partial.timestamp ?? Date.now() - 40 * 24 * 60 * 60 * 1000,
  connections: partial.connections || [],
  tags: partial.tags || [],
  importance: partial.importance ?? 0.5,
  ...partial,
});

describe('cognitive pulse', () => {
  it('builds daily pulse with constellation label and stats', () => {
    const now = Date.now();
    const sessions = [
      memory({
        id: 'a',
        text: 'Nunca devo confiar apenas em automação cega para decisões críticas.',
        timestamp: now - 45 * 24 * 60 * 60 * 1000,
        updatedAt: now - 45 * 24 * 60 * 60 * 1000,
        tags: ['decisao'],
      }),
      memory({
        id: 'b',
        text: 'Sempre vou confiar em automação para decisões críticas do produto.',
        timestamp: now - 2 * 24 * 60 * 60 * 1000,
        updatedAt: now - 2 * 24 * 60 * 60 * 1000,
        tags: ['decisao'],
      }),
      memory({
        id: 'c',
        text: 'Ideia solitária sem ligações no grafo cognitivo',
        timestamp: now - 10 * 24 * 60 * 60 * 1000,
        updatedAt: now - 10 * 24 * 60 * 60 * 1000,
        connections: [],
      }),
    ];

    const pulse = buildCognitivePulse(sessions, now);
    expect(pulse.stats.memories).toBe(3);
    expect(pulse.constellationLabel.length).toBeGreaterThan(3);
    expect(pulse.title).toContain('Pulso');
    expect(pulse.highlights.length).toBeGreaterThan(0);
  });

  it('tracks once-per-day visibility per user', () => {
    const uid = 'pulse-user-test';
    resetPulseSeen(uid);
    expect(shouldShowPulseToday(uid)).toBe(true);
    markPulseSeen(uid);
    expect(shouldShowPulseToday(uid)).toBe(false);
    resetPulseSeen(uid);
    expect(shouldShowPulseToday(uid)).toBe(true);
  });
});
