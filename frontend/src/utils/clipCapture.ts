/**
 * Captura web (clipper) — parser partilhado.
 *
 * O clip chega num fragmento versionado (~1.5 KB) ou via sessionStorage
 * (página intermediária /clipper.html). Nunca se injeta HTML cru:
 * tags são removidas, URLs limitadas a http(s), e o texto é limitado.
 */

export const PENDING_CLIP_KEY = 'mnemosyne.pendingClip.v1';
export const CLIP_TAG = 'clipped';
export const CLIP_MAX_QUERY_BYTES = 1500;
export const CLIP_FRAGMENT_PREFIX = '#mnemosyne-clip=v1&';
export const CLIP_MAX_TITLE_CHARS = 180;
export const CLIP_MAX_TEXT_CHARS = 1200;
export const CLIP_MAX_URL_CHARS = 500;
export const CLIPPER_APP_ORIGIN = 'https://mnemosyne-one.web.app';
export const CLIPPER_LANDING_PATH = '/clipper.html';

export interface ClipPayload {
  title: string;
  url: string;
  text: string;
}

const removeControlChars = (value: string): string => Array.from(value)
  .filter((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  })
  .join('');

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_, raw) => {
      const code = Number(raw);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return ' ';
      try {
        return String.fromCodePoint(code);
      } catch {
        return ' ';
      }
    });
}

/** Remove HTML/script e normaliza espaços. O resultado é texto simples. */
export function stripHtml(input: string): string {
  return decodeBasicEntities(
    String(input)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n').map(removeControlChars).join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeClipField(raw: unknown, maxChars: number): string {
  const stripped = stripHtml(typeof raw === 'string' ? raw : String(raw ?? ''));
  if (!stripped) return '';
  if (stripped.length <= maxChars) return stripped;
  return `${stripped.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function sanitizeClipUrl(raw: unknown): string {
  const cleaned = stripHtml(typeof raw === 'string' ? raw : String(raw ?? ''));
  if (!cleaned) return '';
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const href = url.toString();
    return href.length > CLIP_MAX_URL_CHARS ? href.slice(0, CLIP_MAX_URL_CHARS) : href;
  } catch {
    return '';
  }
}

function encodeClipQuery(clip: ClipPayload): string {
  const params = new URLSearchParams();
  if (clip.title) params.set('title', clip.title);
  if (clip.url) params.set('url', clip.url);
  if (clip.text) params.set('text', clip.text);
  return params.toString();
}

function shrinkField(value: string, step: number): string {
  if (value.length <= 1) return '';
  const next = value.slice(0, Math.max(0, value.length - step)).replace(/…$/, '').trimEnd();
  if (!next) return '';
  return `${next}…`;
}

/** Limita os campos codificados; o caller reserva os bytes do prefixo. */
export function truncateClipToQueryBudget(
  clip: ClipPayload,
  maxBytes = CLIP_MAX_QUERY_BYTES,
): ClipPayload {
  let title = clip.title;
  let url = clip.url;
  let text = clip.text;
  const encoded = () => encodeClipQuery({ title, url, text });

  while (utf8ByteLength(encoded()) > maxBytes && text.length > 0) {
    text = shrinkField(text, 24);
  }
  while (utf8ByteLength(encoded()) > maxBytes && title.length > 0) {
    title = shrinkField(title, 12);
  }
  while (utf8ByteLength(encoded()) > maxBytes && url.length > 0) {
    url = url.slice(0, Math.max(0, url.length - 24));
  }
  return { title, url, text };
}

export function parseClipPayload(input: unknown): ClipPayload | null {
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  const title = sanitizeClipField(rec.title, CLIP_MAX_TITLE_CHARS);
  const url = sanitizeClipUrl(rec.url);
  const text = sanitizeClipField(rec.text ?? rec.selection, CLIP_MAX_TEXT_CHARS);
  if (!title && !url && !text) return null;
  return { title, url, text };
}

export function parseClipFromSearch(search: string): ClipPayload | null {
  try {
    if (utf8ByteLength(search) > CLIP_MAX_QUERY_BYTES) return null;
    decodeURIComponent(search.replace(/\+/g, ' '));
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    for (const key of ['title', 'url', 'text', 'selection']) if (params.getAll(key).length > 1) return null;
    if (params.has('text') && params.has('selection')) return null;
    return parseClipPayload({
      title: params.get('title') || '',
      url: params.get('url') || '',
      text: params.get('text') || params.get('selection') || '',
    });
  } catch {
    return null;
  }
}

/** Protocolo v1: fragmento limitado, sem campos desconhecidos ou repetidos. */
export function parseClipFromHash(hash: string): ClipPayload | null {
  if (!hash.startsWith(CLIP_FRAGMENT_PREFIX) || utf8ByteLength(hash) > CLIP_MAX_QUERY_BYTES) return null;
  try {
    const raw = hash.slice(CLIP_FRAGMENT_PREFIX.length);
    decodeURIComponent(raw.replace(/\+/g, ' ')); // URLSearchParams tolera percent-encoding inválido.
    const params = new URLSearchParams(raw);
    const allowed = new Set(['title', 'url', 'text']);
    for (const key of params.keys()) {
      if (!allowed.has(key) || params.getAll(key).length !== 1) return null;
    }
    return parseClipPayload({title: params.get('title') || '', url: params.get('url') || '', text: params.get('text') || ''});
  } catch {
    return null;
  }
}

export function clipIngressFailed(): boolean {
  return typeof window !== 'undefined' && (window as Window & {__mnemosyneClipIngressFailed?: boolean}).__mnemosyneClipIngressFailed === true;
}

/** Defesa adicional quando o asset inicial falha; não arrancar a UI de captura. */
export function verifyClipIngressBootstrap(): void {
  const status = window as Window & {__mnemosyneClipIngressReady?: boolean; __mnemosyneClipIngressFailed?: boolean};
  if (status.__mnemosyneClipIngressReady === true) return;
  const url = new URL(window.location.href);
  const requested = url.pathname === '/clip' || url.hash.startsWith('#mnemosyne-clip=') || url.hash === '#mnemosyne-clip' || ['title', 'url', 'text', 'selection'].some(key => url.searchParams.has(key));
  if (!requested) return;
  ingestClipFromLocation();
  status.__mnemosyneClipIngressFailed = true;
}

export function clipIngressErrorCopy(language: string): {title: string; body: string} {
  const lang = language.toLowerCase();
  if (lang.startsWith('pt-br')) return {title: 'Não foi possível receber o clip', body: 'A entrada é inválida, já existe um clip na fila ou o armazenamento local está indisponível. Volte à extensão depois de resolver a fila ou o armazenamento.'};
  if (lang.startsWith('pt')) return {title: 'Não foi possível receber o clip', body: 'A entrada é inválida, já existe um clip na fila ou o armazenamento local está indisponível. Volta à extensão depois de resolver a fila ou o armazenamento.'};
  if (lang.startsWith('fr')) return {title: 'Impossible de recevoir l’extrait', body: 'L’entrée est invalide, un extrait est déjà en attente ou le stockage local est indisponible. Réessayez depuis l’extension après avoir résolu la file ou le stockage.'};
  return {title: 'Could not receive the clip', body: 'The input is invalid, a clip is already queued, or local storage is unavailable. Return to the extension after resolving the queue or storage.'};
}

export function readPendingClip(ownerUid?: string): ClipPayload | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CLIP_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data == null || typeof data !== 'object' || Array.isArray(data)) return null;
    if ('ownerUid' in data && (typeof data.ownerUid !== 'string' || !data.ownerUid || data.ownerUid.includes('/') || data.ownerUid !== ownerUid)) return null;
    return parseClipPayload(data);
  } catch {
    return null;
  }
}

export function writePendingClip(clip: ClipPayload, ownerUid?: string): boolean {
  try {
    if (ownerUid !== undefined && (!ownerUid || ownerUid.length > 128 || ownerUid.includes('/'))) return false;
    const raw = JSON.stringify(ownerUid === undefined ? clip : {...clip, ownerUid});
    sessionStorage.setItem(PENDING_CLIP_KEY, raw);
    return sessionStorage.getItem(PENDING_CLIP_KEY) === raw;
  } catch {
    // Quota / modo privado — o caller trata ausência de clip.
    return false;
  }
}

export function clearPendingClip(): void {
  try {
    sessionStorage.removeItem(PENDING_CLIP_KEY);
  } catch {
    // ignore
  }
}

export function consumePendingClip(ownerUid?: string): ClipPayload | null {
  const clip = readPendingClip(ownerUid);
  if (clip) clearPendingClip();
  return clip;
}

export function formatClipMemoryText(clip: ClipPayload): string {
  const lines: string[] = [];
  if (clip.title) lines.push(clip.title);
  if (clip.url) lines.push(clip.url);
  if (clip.text) {
    if (lines.length) lines.push('');
    lines.push(clip.text);
  }
  return lines.join('\n').trim();
}

export function clipMemoryTitle(clip: ClipPayload): string {
  if (clip.title) return clip.title;
  if (clip.url) {
    try {
      return new URL(clip.url).hostname.replace(/^www\./, '') || 'Clip web';
    } catch {
      return 'Clip web';
    }
  }
  return 'Clip web';
}

export function buildClipperLandingUrl(
  clip: ClipPayload,
  origin = CLIPPER_APP_ORIGIN,
): string {
  const sanitized = parseClipPayload(clip);
  if (!sanitized) return `${origin}${CLIPPER_LANDING_PATH}`;
  const trimmed = truncateClipToQueryBudget(sanitized, CLIP_MAX_QUERY_BYTES - utf8ByteLength(CLIP_FRAGMENT_PREFIX));
  const query = encodeClipQuery(trimmed);
  const base = `${origin.replace(/\/$/, '')}${CLIPPER_LANDING_PATH}`;
  return query ? `${base}${CLIP_FRAGMENT_PREFIX}${query}` : base;
}

/** Executada antes dos módulos da SPA. Limpa o URL mesmo se a fila não puder ser guardada.
 * Compatibilidade com queries antigas não desfaz o primeiro pedido HTTP já enviado.
 */
export function ingestClipFromLocation(): ClipPayload | null {
  if (typeof window === 'undefined') return null;
  const status = window as Window & {__mnemosyneClipIngressFailed?: boolean};
  try {
    const url = new URL(window.location.href);
    const hadClipHash = url.hash.startsWith('#mnemosyne-clip=') || url.hash === '#mnemosyne-clip';
    const hadClipParams =
      url.searchParams.has('title') ||
      url.searchParams.has('url') ||
      url.searchParams.has('text') ||
      url.searchParams.has('selection');
    const hasInput = hadClipHash || hadClipParams;
    const clip = hadClipHash && hadClipParams ? null : hadClipHash
      ? parseClipFromHash(url.hash)
      : hadClipParams && utf8ByteLength(url.search) <= CLIP_MAX_QUERY_BYTES
        ? parseClipFromSearch(url.search) : null;
    if (hadClipParams) {
      url.searchParams.delete('title');
      url.searchParams.delete('url');
      url.searchParams.delete('text');
      url.searchParams.delete('selection');
    }
    if (hadClipHash) url.hash = '';
    if (url.pathname === '/clip') {
      url.pathname = '/';
    }
    if (hasInput || window.location.pathname === '/clip') {
      const next = `${url.pathname}${url.search}${url.hash}`;
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(window.history.state, '', next);
      }
    }
    if (!hasInput) return readPendingClip();
    // Nunca substituir uma captura anterior, incluindo uma fila ligada a outro UID.
    if (!clip || sessionStorage.getItem(PENDING_CLIP_KEY) !== null || !writePendingClip(clip)) {
      status.__mnemosyneClipIngressFailed = true;
      return null;
    }
    status.__mnemosyneClipIngressFailed = false;
    return clip;
  } catch {
    status.__mnemosyneClipIngressFailed = true;
    return null;
  }
}
