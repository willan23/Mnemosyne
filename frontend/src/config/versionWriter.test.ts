import { afterEach, expect, it, vi } from 'vitest';
import * as writer from '../../scripts/versionFiles';
import { createVersionPayload, writeVersionFiles } from '../../scripts/write-version';
import { isNewerRelease } from './appVersion';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('identifies a new production build of the same version without requiring a custom Git environment variable', () => {
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VITE_APP_VERSION', ''); vi.stubEnv('VITE_APP_BUILD_ID', '');
  vi.stubEnv('GIT_COMMIT_SHA', ''); vi.stubEnv('GITHUB_SHA', '');
  const first = createVersionPayload(), second = createVersionPayload();
  expect(first.version).toBe(second.version);
  expect(isNewerRelease(first, second)).toBe(true);
});

it('fails the build when the dist manifest cannot be written instead of suppressing the failure', () => {
  const failure = new Error('Synthetic dist manifest failure');
  const write = vi.spyOn(writer, 'writeVersionFile').mockImplementation(file => {
    if (file.replaceAll('\\', '/').endsWith('/dist/version.json')) throw failure;
  });
  expect(() => writeVersionFiles({ version: '1.0.8', buildId: 'synthetic', builtAt: 'synthetic', channel: 'test', notes: '' })).toThrow(failure);
  expect(write).toHaveBeenCalledTimes(2);
});
