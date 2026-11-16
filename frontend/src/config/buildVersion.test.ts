import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildVersionPayload, versionEnvironment } from '../../scripts/buildVersion';

const create = (overrides: Partial<Parameters<typeof buildVersionPayload>[0]> = {}) =>
  buildVersionPayload({ packageVersion: '1.0.8', tauriVersion: '1.0.8', development: false, env: {}, ...overrides });

afterEach(() => vi.useRealTimers());

describe('production build identity', () => {
  it('distinguishes two builds at the same instant with the same version', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'));
    const first = create(), second = create();
    expect(first.builtAt).toBe(second.builtAt);
    expect(first.buildId).not.toBe(second.buildId);
    expect(first.buildId).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    expect(first).toMatchObject({ version: '1.0.8', channel: 'production', notes: '' });
  });

  it('uses dev only for development and preserves a deliberate explicit identity', () => {
    expect(create({ development: true }).buildId).toBe('dev');
    expect(create({ development: true }).channel).toBe('development');
    const result = create({ env: { VITE_APP_BUILD_ID: ' release-42.ab_cd ', VITE_APP_VERSION: ' 1.0.8 ', VITE_APP_CHANNEL: 'beta', VITE_APP_RELEASE_NOTES: 'Alteração sintética' } });
    expect(result).toMatchObject({ buildId: 'release-42.ab_cd', version: '1.0.8', channel: 'beta', notes: 'Alteração sintética' });
  });

  it.each(['dev', '../escape', 'with spaces', 'line\nbreak', '_initial', 'a'.repeat(129)])('rejects an invalid production build identity (%j)', buildId => {
    expect(() => create({ env: { VITE_APP_BUILD_ID: buildId } })).toThrow('identificador');
  });

  it.each(['1.0', 'v1.0.8', '01.0.8', '1.0.8-01', '1.0.8+', ' 1.0.8', '1.0.8\n', null])('rejects malformed canonical versions (%j)', version => {
    expect(() => create({ packageVersion: version, tauriVersion: undefined })).toThrow('inválida');
  });

  it('accepts canonical prerelease and metadata, with exact native version agreement', () => {
    expect(create({ packageVersion: '1.0.8-rc.2+release.04', tauriVersion: '1.0.8-rc.2+release.04' }).version).toBe('1.0.8-rc.2+release.04');
    expect(() => create({ tauriVersion: '1.0.7' })).toThrow('coincidir');
    expect(() => create({ env: { VITE_APP_VERSION: '2.0.0' } })).toThrow('coincidir');
    expect(create({ tauriVersion: undefined }).version).toBe('1.0.8');
  });

  it('copies only the four public version settings from the environment', () => {
    expect(versionEnvironment({ VITE_APP_VERSION: '1.0.8', VITE_APP_BUILD_ID: 'fixture', VITE_APP_CHANNEL: 'production', VITE_APP_RELEASE_NOTES: '', UNRELATED_SETTING: 'private-fixture', VITE_UNRELATED: 'other-fixture' }))
      .toEqual({ VITE_APP_VERSION: '1.0.8', VITE_APP_BUILD_ID: 'fixture', VITE_APP_CHANNEL: 'production', VITE_APP_RELEASE_NOTES: '' });
  });
});
