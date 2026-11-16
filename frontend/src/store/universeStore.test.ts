import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryObject } from '../types/universe';

const STORAGE_KEY = 'mnemosyne-universe-preferences';

async function loadStore() {
  vi.resetModules();
  return import('./universeStore');
}

describe('universeStore preferences', () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('persists only the selected universe type', async () => {
    const { useUniverseStore } = await loadStore();

    useUniverseStore.getState().setUniverseType('solar');

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')).toMatchObject({
      state: { universeType: 'solar' },
    });
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('memories');
  });

  it('migrates the old garden preset to the solar system preset', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: { universeType: 'garden' },
      version: 0,
    }));

    const { useUniverseStore } = await loadStore();

    expect(useUniverseStore.getState().universeType).toBe('solar');
  });

  it('keeps the selected memory when an authorized snapshot refreshes its content', async () => {
    const { useUniverseStore } = await loadStore();
    const memory: MemoryObject = { id: 'synthetic-memory', uid: 'alice', text: '', celestialType: 'star',
      position: [0, 0, 0], embedding: [], connections: [], importance: 0.5, timestamp: 1, updatedAt: 1 };
    useUniverseStore.getState().loadMemories([memory]);
    useUniverseStore.getState().selectMemory(memory.id);
    const refreshed = { ...memory, updatedAt: 2, persistedStateDigest: 'new-authoritative-digest' };
    useUniverseStore.getState().loadMemories([refreshed]);
    expect(useUniverseStore.getState().selectedMemoryId).toBe(memory.id);
    expect(useUniverseStore.getState().memories[0]).toEqual(refreshed);
  });

  it('withdraws selection when the memory disappears and does not restore it after a scope reset', async () => {
    const { useUniverseStore } = await loadStore();
    const memory: MemoryObject = { id: 'synthetic-memory', uid: 'alice', text: '', celestialType: 'star',
      position: [0, 0, 0], embedding: [], connections: [], importance: 0.5, timestamp: 1, updatedAt: 1 };
    const other = { ...memory, id: 'synthetic-other' };
    useUniverseStore.getState().loadMemories([memory, other]);
    useUniverseStore.getState().selectMemory(memory.id);
    useUniverseStore.getState().loadMemories([other]);
    expect(useUniverseStore.getState().selectedMemoryId).toBeNull();
    useUniverseStore.getState().loadMemories([memory]);
    expect(useUniverseStore.getState().selectedMemoryId).toBeNull();
    useUniverseStore.getState().selectMemory(memory.id);
    useUniverseStore.getState().loadMemories([]);
    useUniverseStore.getState().loadMemories([{ ...memory, uid: 'bob' }]);
    expect(useUniverseStore.getState().selectedMemoryId).toBeNull();
  });
});
