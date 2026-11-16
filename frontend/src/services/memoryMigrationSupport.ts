export interface MigrationCheckpointStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type MigrationCheckpoint =
  | { v: 1; phase: 'sessions' | 'nested'; after: string | null }
  | { v: 1; phase: 'complete' };

type ActiveMigrationCheckpoint = Extract<MigrationCheckpoint, { after: string | null }>;

export const migrationCheckpointKey = (uid: string) => `mnemosyne.memory-migration.v1.${uid}`;

/** Invalid or completed state starts a fresh verification pass. */
export function readMigrationCheckpoint(
  store: MigrationCheckpointStore | undefined,
  key: string,
): ActiveMigrationCheckpoint | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.v !== 1 || parsed.phase === 'complete') return null;
    if (parsed.phase !== 'sessions' && parsed.phase !== 'nested') return null;
    if (parsed.after !== null &&
        (typeof parsed.after !== 'string' || parsed.after.length === 0 ||
         parsed.after.length > 1500 || parsed.after.includes('/'))) return null;
    return parsed as ActiveMigrationCheckpoint;
  } catch {
    return null;
  }
}

export function writeMigrationCheckpoint(
  store: MigrationCheckpointStore | undefined,
  key: string,
  checkpoint: MigrationCheckpoint,
): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(checkpoint));
    return true;
  } catch {
    return false;
  }
}

export function finishMigrationCheckpoint(store: MigrationCheckpointStore | undefined, key: string): void {
  if (!store) return;
  // The complete marker prevents a stale last-page cursor from hiding new
  // legacy records if removal is denied by the browser.
  writeMigrationCheckpoint(store, key, { v: 1, phase: 'complete' });
  try {
    store.removeItem(key);
  } catch {
    // A complete marker is safe to retain.
  }
}

const TRANSIENT_CODES = new Set(['unavailable', 'deadline-exceeded', 'aborted', 'resource-exhausted']);

export function isTransientMigrationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

export async function retryMigrationOperation<T>(
  operation: () => Promise<T>,
  assertActive: () => void,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    assertActive();
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 3 || !isTransientMigrationError(error)) throw error;
      await sleep(250 * (2 ** attempt));
    }
  }
}
