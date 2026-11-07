/**
 * Metadados usados pelo plugin Vite. O manifesto é emitido com o bundle.
 * npm run version:write executa o build completo para conservar a coerência.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeVersionFile } from './versionFiles';
import { buildVersionPayload, versionEnvironment, type VersionEnvironment, type VersionPayload } from './buildVersion';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function readVersion(file: string, optional = false): unknown {
  try {
    const version: unknown = JSON.parse(readFileSync(file, 'utf8')).version;
    if (typeof version !== 'string') throw new Error('Version field missing');
    return version;
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Os metadados de versão da aplicação não podem ser lidos.');
  }
}

export function createVersionPayload(options: { development?: boolean; env?: VersionEnvironment } = {}): VersionPayload {
  return buildVersionPayload({ packageVersion: readVersion(join(root, 'package.json')),
    tauriVersion: readVersion(join(root, 'src-tauri', 'tauri.conf.json'), true),
    development: options.development ?? process.env.NODE_ENV === 'development', env: options.env ?? versionEnvironment(process.env) });
}

export function writeVersionFiles(payload: VersionPayload) {
  const publicDir = join(root, 'public');
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  writeVersionFile(join(publicDir, 'version.json'), json);
  // Both manifests must be written successfully for the build to be valid.
  writeVersionFile(join(root, 'dist', 'version.json'), json);
  return payload;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  throw new Error('O manifesto de versão é emitido pelo build completo. Executa npm run build ou npm run version:write.');
}
