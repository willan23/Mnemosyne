/**
 * Gera public/version.json e injeta env vars de build.
 * Usado pelo plugin Vite e pode correr standalone: node scripts/write-version.mjs
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version !== '0.0.0'
      ? pkg.version
      : null;
  } catch {
    return null;
  }
}

function readTauriVersion() {
  try {
    const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    return typeof conf.version === 'string' ? conf.version : null;
  } catch {
    return null;
  }
}

export function createVersionPayload() {
  const version = process.env.VITE_APP_VERSION
    || readTauriVersion()
    || readPackageVersion()
    || '1.0.7';
  const isDev = process.env.NODE_ENV === 'development';
  const buildId = process.env.VITE_APP_BUILD_ID
    || (isDev
      ? 'dev'
      : createHash('sha1')
          .update(`${version}-${process.env.GIT_COMMIT_SHA || 'rel'}`)
          .digest('hex')
          .slice(0, 12));
  const builtAt = new Date().toISOString();

  return {
    version,
    buildId,
    builtAt,
    channel: process.env.VITE_APP_CHANNEL || 'production',
    notes: process.env.VITE_APP_RELEASE_NOTES || '',
  };
}

export function writeVersionFiles(payload = createVersionPayload()) {
  const publicDir = join(root, 'public');
  mkdirSync(publicDir, { recursive: true });
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(join(publicDir, 'version.json'), json, 'utf8');
  // Also write to dist if it exists (post-build safety)
  try {
    const distDir = join(root, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'version.json'), json, 'utf8');
  } catch {
    // dist may not exist yet
  }
  return payload;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const payload = writeVersionFiles();
  console.log('Wrote version.json', payload);
}
