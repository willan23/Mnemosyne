import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
