/**
 * Smoke: GET /api/v1/memories sem Bearer → 401.
 * Uso: npm run build && npm run example:unauth
 */
import { MnemosyneApiError, MnemosyneClient } from '../dist/index.js';

const baseUrl = process.env.MNEMOSYNE_BASE_URL || 'https://mnemosyne-one.web.app';
const client = new MnemosyneClient({ apiKey: '', baseUrl });

try {
  await client.listMemories();
  console.error('expected 401 without API key');
  process.exit(1);
} catch (error) {
  if (error instanceof MnemosyneApiError && error.status === 401) {
    console.log('ok: unauthenticated listMemories → 401');
    process.exit(0);
  }
  console.error(error);
  process.exit(1);
}
