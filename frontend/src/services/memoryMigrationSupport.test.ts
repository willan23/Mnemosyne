import { describe, expect, it } from 'vitest';
import {
  finishMigrationCheckpoint,
  migrationCheckpointKey,
  readMigrationCheckpoint,
  retryMigrationOperation,
  writeMigrationCheckpoint,
  type MigrationCheckpointStore,
} from './memoryMigrationSupport';

function memoryStore(): MigrationCheckpointStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe('legacy memory migration checkpoint', () => {
  it('persists only cursor metadata and clears it on completion', () => {
    const store = memoryStore();
    const key = migrationCheckpointKey('alice');
    expect(writeMigrationCheckpoint(store, key, { v: 1, phase: 'sessions', after: 'session-2' })).toBe(true);
    expect(readMigrationCheckpoint(store, key)).toEqual({ v: 1, phase: 'sessions', after: 'session-2' });
    expect(store.getItem(key)).not.toContain('synthetic secret');
    finishMigrationCheckpoint(store, key);
    expect(readMigrationCheckpoint(store, key)).toBeNull();
    expect(store.getItem(key)).toBeNull();
  });

  it('rejects malformed cursors and a retained complete marker', () => {
    const store = memoryStore();
    const key = migrationCheckpointKey('alice');
    for (const value of [
      '{',
      JSON.stringify({ v: 2, phase: 'sessions', after: 'a' }),
      JSON.stringify({ v: 1, phase: 'sessions', after: 'parent/child' }),
      JSON.stringify({ v: 1, phase: 'sessions', after: '' }),
      JSON.stringify({ v: 1, phase: 'complete' }),
    ]) {
      store.setItem(key, value);
      expect(readMigrationCheckpoint(store, key)).toBeNull();
    }
  });
});

describe('legacy memory migration retry', () => {
  it('backs off and retries transient errors three times', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await retryMigrationOperation(async () => {
      attempts += 1;
      if (attempts < 4) throw { code: 'unavailable' };
      return 'done';
    }, () => {}, async (delay) => { delays.push(delay); });
    expect(result).toBe('done');
    expect(attempts).toBe(4);
    expect(delays).toEqual([250, 500, 1000]);
  });

  it('does not retry permanent failures or a cancelled run', async () => {
    let attempts = 0;
    await expect(retryMigrationOperation(async () => {
      attempts += 1;
      throw { code: 'permission-denied' };
    }, () => {}, async () => {})).rejects.toMatchObject({ code: 'permission-denied' });
    expect(attempts).toBe(1);

    let active = true;
    await expect(retryMigrationOperation(async () => {
      attempts += 1;
      throw { code: 'aborted' };
    }, () => { if (!active) throw new Error('cancelled'); }, async () => { active = false; }))
      .rejects.toThrow('cancelled');
    expect(attempts).toBe(2);
  });
});
