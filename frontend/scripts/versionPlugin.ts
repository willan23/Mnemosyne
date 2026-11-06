import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv, type ConfigEnv, type Plugin, type UserConfig } from 'vite';
import { createVersionPayload, writeVersionFiles } from './write-version';
import { versionEnvironment, type VersionPayload } from './buildVersion';

/** One payload per resolved build; tests/dev/preview cannot overwrite production manifests. */
export function mnemosyneVersionPlugin() {
  let payload: VersionPayload | undefined;
  let publishing = false;
  const write = () => {
    if (!publishing) return;
    if (!payload) throw new Error('O contexto da versão do build não foi preparado.');
    writeVersionFiles(payload);
  };
  return {
    name: 'mnemosyne-version',
    config(_config: UserConfig, context: ConfigEnv) {
      publishing = context.command === 'build';
      const env = loadEnv(context.mode, join(dirname(fileURLToPath(import.meta.url)), '..'), 'VITE_');
      payload = createVersionPayload({ development: !publishing, env: versionEnvironment(env) });
      write();
      return { define: {
        'import.meta.env.VITE_APP_VERSION': JSON.stringify(payload.version),
        'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(payload.buildId),
        'import.meta.env.VITE_APP_BUILT_AT': JSON.stringify(payload.builtAt),
      } };
    },
    buildStart() { write(); },
    closeBundle() { write(); },
  } satisfies Plugin;
}
