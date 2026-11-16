/**
 * CORS allowlist aligned with product origins (web, Firebase Hosting, Tauri, local Vite).
 * Extra origins: PUBLIC_API_CORS_EXTRA_ORIGINS=https://a.com,https://b.com
 */

export const PRODUCT_ORIGINS = new Set([
  'https://mnemosyne-one.com',
  'https://www.mnemosyne-one.com',
  'https://mnemosyne-one.web.app',
  'https://mnemosyne-one.firebaseapp.com',
  'http://localhost:5173',
  'http://localhost:1420',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:1420',
  'tauri://localhost',
  'https://tauri.localhost',
]);

export function extraCorsOriginsFromEnv(raw = process.env.PUBLIC_API_CORS_EXTRA_ORIGINS): string[] {
  if (!raw || !raw.trim()) return [];
  const origins: string[] = [];
  for (const item of raw.split(',')) {
    try {
      const parsed = new URL(item.trim());
      if (parsed.origin) origins.push(parsed.origin);
    } catch {
      // skip invalid
    }
  }
  return origins;
}

export function isAllowedOrigin(origin: string, extra: string[] = extraCorsOriginsFromEnv()): boolean {
  if (!origin) return false;
  if (PRODUCT_ORIGINS.has(origin)) return true;
  return extra.includes(origin);
}
