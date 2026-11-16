import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as writer from '../../scripts/write-version';
import { mnemosyneVersionPlugin } from '../../scripts/versionPlugin';

// Keep the unit lifecycle test independent of Vite's Node-only esbuild runtime in JSDOM.
// The actual Vite configuration and artifact identity are checked by the CLI/build checks.
vi.mock('vite', () => ({ loadEnv: () => ({
  VITE_APP_VERSION: process.env.VITE_APP_VERSION,
  VITE_APP_BUILD_ID: process.env.VITE_APP_BUILD_ID,
}) }));
beforeEach(() => { vi.stubEnv('VITE_APP_VERSION', ''); vi.stubEnv('VITE_APP_BUILD_ID', ''); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('version plugin lifecycle', () => {
  it('embeds and writes exactly one payload throughout a build', () => {
    const writes = vi.spyOn(writer, 'writeVersionFiles').mockImplementation(payload => payload);
    const creates = vi.spyOn(writer, 'createVersionPayload');
    const plugin = mnemosyneVersionPlugin();
    const config = plugin.config({}, { command: 'build', mode: 'production' });
    plugin.buildStart(); plugin.closeBundle();
    expect(creates).toHaveBeenCalledTimes(1);
    const payload = creates.mock.results[0].value;
    expect(writes).toHaveBeenCalledTimes(3);
    for (const [written] of writes.mock.calls) expect(written).toBe(payload);
    expect(config.define).toEqual({
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(payload.version),
      'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(payload.buildId),
      'import.meta.env.VITE_APP_BUILT_AT': JSON.stringify(payload.builtAt),
    });
  });

  it.each(['development', 'test', 'production'])('never writes manifests for serve, including preview/test mode %s', mode => {
    const writes = vi.spyOn(writer, 'writeVersionFiles').mockImplementation(payload => payload);
    const plugin = mnemosyneVersionPlugin();
    const config = plugin.config({}, { command: 'serve', mode, isPreview: mode === 'production' });
    plugin.buildStart(); plugin.closeBundle();
    expect(config.define['import.meta.env.VITE_APP_BUILD_ID']).toBe('"dev"');
    expect(writes).not.toHaveBeenCalled();
  });

  it('creates a new identity when resolving another build with a reused plugin', () => {
    vi.stubEnv('VITE_APP_BUILD_ID', '');
    vi.spyOn(writer, 'writeVersionFiles').mockImplementation(payload => payload);
    const plugin = mnemosyneVersionPlugin();
    const first = plugin.config({}, { command: 'build', mode: 'production' });
    const second = plugin.config({}, { command: 'build', mode: 'production' });
    expect(first.define['import.meta.env.VITE_APP_BUILD_ID']).not.toBe(second.define['import.meta.env.VITE_APP_BUILD_ID']);
  });

  it('fails before writing when the canonical version configuration is inconsistent', () => {
    vi.stubEnv('VITE_APP_VERSION', '999.0.0');
    const writes = vi.spyOn(writer, 'writeVersionFiles').mockImplementation(payload => payload);
    expect(() => mnemosyneVersionPlugin().config({}, { command: 'build', mode: 'production' })).toThrow('coincidir');
    expect(writes).not.toHaveBeenCalled();
  });

  it('propagates manifest persistence failures', () => {
    const failure = new Error('Synthetic manifest failure');
    vi.spyOn(writer, 'writeVersionFiles').mockImplementation(() => { throw failure; });
    expect(() => mnemosyneVersionPlugin().config({}, { command: 'build', mode: 'production' })).toThrow(failure);
  });
});
