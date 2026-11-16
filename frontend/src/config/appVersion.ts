/**
 * Versão da app embutida no build.
 * VITE_APP_VERSION / VITE_APP_BUILD_ID vêm do vite.config (plugin de versão).
 */
import { parseReleaseVersion, compareReleaseVersions } from '../utils/releaseVersion';

export const APP_VERSION =
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || '0.0.0';

export const APP_BUILD_ID =
  (import.meta.env.VITE_APP_BUILD_ID as string | undefined)?.trim() || 'dev';
export const APP_BUILT_AT =
  (import.meta.env.VITE_APP_BUILT_AT as string | undefined)?.trim() || '';

export interface RemoteAppVersion {
  version: string;
  buildId: string;
  builtAt?: string;
  channel?: string;
  notes?: string;
}

export function isNewerRelease(local: RemoteAppVersion, remote: RemoteAppVersion): boolean {
  if (typeof remote.version !== 'string' || typeof remote.buildId !== 'string' ||
      typeof local.version !== 'string' || typeof local.buildId !== 'string') return false;
  if (!remote.version && !remote.buildId) return false;
  const remoteVersion = remote.version ? parseReleaseVersion(remote.version.replace(/^v/i, '')) : null;
  const localVersion = local.version ? parseReleaseVersion(local.version.replace(/^v/i, '')) : null;
  if ((remote.version && !remoteVersion) || (local.version && !localVersion)) return false;

  // Semver check if versions differ
  if (remoteVersion && localVersion) {
    const difference = compareReleaseVersions(remoteVersion, localVersion);
    if (difference) return difference > 0;
  }

  // Build ID check if versions match but build IDs differ (ignoring dev builds)
  if (remote.buildId && local.buildId && remote.buildId !== 'dev' && local.buildId !== 'dev') {
    return remote.buildId !== local.buildId;
  }

  return false;
}

/** Compare SemVer precedence; build metadata does not affect ordering. Malformed versions compare equal. */
export function compareSemver(a: string, b: string): number {
  const first = parseReleaseVersion(a.replace(/^v/i, '')), second = parseReleaseVersion(b.replace(/^v/i, ''));
  return first && second ? compareReleaseVersions(first, second) : 0;
}

export function localReleaseMeta(): RemoteAppVersion {
  return {
    version: APP_VERSION,
    buildId: APP_BUILD_ID,
    builtAt: APP_BUILT_AT,
  };
}
