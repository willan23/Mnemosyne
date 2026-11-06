import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ['2001:db8::', 32], // documentation
  ['2001::', 32], // Teredo
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation
] as const) {
  blockedIpv6.addSubnet(network, prefix, 'ipv6');
}

export interface ExternalPage {
  status: number;
  url: string;
  contentType: string;
  body: string;
  location?: string;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    const value = address.toLowerCase();
    return /^[23][0-9a-f]{0,3}:/.test(value) &&
      !blockedIpv6.check(value, 'ipv6');
  }
  return false;
}

export function validateExternalUrl(input: string): URL {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') ||
      url.username || url.password || isIP(hostname) || hostname.startsWith('[') ||
      hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') ||
      hostname === 'metadata.google.internal') {
    throw new Error('URL externa não permitida');
  }
  return url;
}

export async function resolvePublicAddress(
  hostname: string,
  resolver: typeof lookup = lookup,
): Promise<{ address: string; family: number }> {
  const records = await resolver(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
    throw new Error('Destino de rede não permitido');
  }
  return records[0];
}

function requestPinnedPage(url: URL, address: string, family: number): Promise<ExternalPage> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: url.hostname,
      servername: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { 'user-agent': 'MnemosyneResearch/1.0', accept: 'text/html' },
      lookup: (_hostname, _options, callback) => callback(null, address, family),
    }, (res) => {
      const status = res.statusCode || 0;
      const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
      const contentType = String(res.headers['content-type'] || '');
      if (status >= 300 && status < 400) {
        res.resume();
        resolve({ status, url: url.toString(), contentType, body: '', location });
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          req.destroy(new Error('Resposta externa demasiado grande'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, url: url.toString(), contentType, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Timeout de pesquisa externa')));
    req.on('error', reject);
    req.end();
  });
}

/** DNS is checked for every hop, then the checked address is pinned for the TLS request. */
export async function safeFetchExternalUrl(
  input: string,
  dependencies: {
    resolver?: typeof lookup;
    requestPage?: typeof requestPinnedPage;
  } = {},
): Promise<ExternalPage> {
  let current = input;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = validateExternalUrl(current);
    const pinned = await resolvePublicAddress(url.hostname, dependencies.resolver);
    const response = await (dependencies.requestPage || requestPinnedPage)(url, pinned.address, pinned.family);
    if (response.status < 300 || response.status >= 400) return response;
    if (!response.location || hop === MAX_REDIRECTS) throw new Error('Redirecionamento externo inválido');
    current = new URL(response.location, url).toString();
  }
  throw new Error('Limite de redirecionamentos externos excedido');
}
