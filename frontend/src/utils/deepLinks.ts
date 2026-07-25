/**
 * Deep-links Mnemosyne:
 *   /?memory=<id>              — foca memória no grafo (privado, auth)
 *   /universe?memory=<id>      — foca no Universo 3D (privado, auth)
 *   /share/<id>                — cápsula cifrada pública (passphrase out-of-band)
 *   /share/<id>#k=<b64url>     — opcional: passphrase no fragmento (não vai ao servidor)
 */

export function readMemoryIdFromSearch(search: string): string | null {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const id = params.get('memory') || params.get('m');
    if (!id || id.length < 4) return null;
    return id;
  } catch {
    return null;
  }
}

export function buildMemoryDeepLink(memoryId: string, mode: 'graph' | 'universe' = 'graph'): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (mode === 'universe') {
    return `${origin}/universe?memory=${encodeURIComponent(memoryId)}`;
  }
  return `${origin}/?memory=${encodeURIComponent(memoryId)}`;
}

export function buildCapsuleDeepLink(shareId: string, passphrase?: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = `${origin}/share/${encodeURIComponent(shareId)}`;
  if (!passphrase) return base;
  // Fragment (#) nunca é enviado ao servidor HTTP — só existe no browser do destinatário
  return `${base}#k=${utf8ToBase64Url(passphrase)}`;
}

export function readPassphraseFromHash(hash: string): string | null {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!raw) return null;
    const params = new URLSearchParams(raw.includes('=') ? raw : `k=${raw}`);
    const k = params.get('k');
    if (!k) return null;
    return base64UrlToUtf8(k);
  } catch {
    return null;
  }
}

export function stripMemoryFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('memory') && !url.searchParams.has('m')) return;
    url.searchParams.delete('memory');
    url.searchParams.delete('m');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  } catch {
    // ignore
  }
}

function utf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToUtf8(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = window.atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
