import { randomUUID } from 'node:crypto';
import { parseReleaseVersion } from '../src/utils/releaseVersion';

export interface VersionEnvironment {
  VITE_APP_VERSION?: string;
  VITE_APP_BUILD_ID?: string;
  VITE_APP_CHANNEL?: string;
  VITE_APP_RELEASE_NOTES?: string;
}
export interface VersionPayload { version: string; buildId: string; builtAt: string; channel: string; notes: string }

/** Only public version settings enter this object; other environment values are not copied. */
export function versionEnvironment(source: Record<string, string | undefined>): VersionEnvironment {
  return { VITE_APP_VERSION: source.VITE_APP_VERSION, VITE_APP_BUILD_ID: source.VITE_APP_BUILD_ID,
    VITE_APP_CHANNEL: source.VITE_APP_CHANNEL, VITE_APP_RELEASE_NOTES: source.VITE_APP_RELEASE_NOTES };
}

export function buildVersionPayload(input: { packageVersion: unknown; tauriVersion?: unknown; development: boolean; env: VersionEnvironment }): VersionPayload {
  const version = input.packageVersion;
  if (typeof version !== 'string' || !parseReleaseVersion(version)) throw new Error('A versão do package frontend é inválida.');
  if (input.tauriVersion !== undefined && input.tauriVersion !== version) throw new Error('As versões frontend e Tauri têm de coincidir.');
  const override = input.env.VITE_APP_VERSION?.trim();
  if (override && override !== version) throw new Error('VITE_APP_VERSION tem de coincidir com a versão do package frontend.');
  const explicit = input.env.VITE_APP_BUILD_ID?.trim();
  if (explicit && (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(explicit) || (!input.development && explicit === 'dev'))) {
    throw new Error('O identificador explícito do build é inválido para este modo.');
  }
  return { version, buildId: explicit || (input.development ? 'dev' : randomUUID()), builtAt: new Date().toISOString(),
    channel: input.env.VITE_APP_CHANNEL || (input.development ? 'development' : 'production'), notes: input.env.VITE_APP_RELEASE_NOTES || '' };
}
