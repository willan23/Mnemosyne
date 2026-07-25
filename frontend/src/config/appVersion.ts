/**
 * Versão da app embutida no build.
 * VITE_APP_VERSION / VITE_APP_BUILD_ID vêm do vite.config (plugin de versão).
 */

export const APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || '0.0.0';

export const APP_BUILD_ID =
  (import.meta.env.VITE_APP_BUILD_ID as string | undefined)?.trim() || 'dev';

export interface RemoteAppVersion {
  version: string;
  buildId: string;
  builtAt?: string;
  channel?: string;
  notes?: string;
}

export function isNewerRelease(local: RemoteAppVersion, remote: RemoteAppVersion): boolean {
  if (!remote.version && !remote.buildId) return false;

  // Semver check if versions differ
  if (remote.version && local.version && remote.version !== local.version) {
    return compareSemver(remote.version, local.version) > 0;
  }

  // Build ID check if versions match but build IDs differ (ignoring dev builds)
  if (remote.buildId && local.buildId && remote.buildId !== 'dev' && local.buildId !== 'dev') {
    return remote.buildId !== local.buildId;
  }

  return false;
}

/** Compare a.b.c style versions. Returns >0 if a>b, 0 equal, <0 if a<b. */
export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function localReleaseMeta(): RemoteAppVersion {
  return {
    version: APP_VERSION,
    buildId: APP_BUILD_ID,
  };
}
