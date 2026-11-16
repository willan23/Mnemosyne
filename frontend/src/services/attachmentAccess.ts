/** Legacy cloud attachment reads require fresh authorization, including the object's uploader. */
import { getFunctions, httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import app, { auth } from '../firebase';
import type { Attachment } from '../types/attachments';
import { isMemoryCryptoReady, onMemoryCryptoChanged } from './memoryCrypto';
import { getTeamKeyCacheGeneration, onTeamKeyChanged } from './teamVault';
const denied = () => new Error('Não foi possível aceder ao anexo.');
export function ownerUidFromAttachmentPath(path: string): string | null {
  const parts = path.split('/');
  return new TextEncoder().encode(path).length <= 1024 && !path.includes('\\') &&
    !Array.from(path).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) && parts[0] === 'attachments' && parts.length >= 3 &&
    parts.slice(1).every(part => part.length > 0 && part !== '.' && part !== '..') ? parts[1] : null;
}
export function parseStorageObjectPathFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password || url.hash) return null;
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
    if (!match || decodeURIComponent(match[1]) !== app.options.storageBucket) return null;
    const path = decodeURIComponent(match[2]); return ownerUidFromAttachmentPath(path) ? path : null;
  } catch { return null; }
}
function signedUrlMatches(value: unknown, path: string): value is string {
  try {
    if (typeof value !== 'string') return false;
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'storage.googleapis.com' && !url.port && !url.username && !url.password && !url.hash &&
      decodeURIComponent(url.pathname) === `/${app.options.storageBucket}/${path}` && !url.searchParams.has('token') &&
      url.searchParams.get('response-content-disposition') === 'attachment; filename="attachment"' &&
      url.searchParams.get('response-content-type') === 'application/octet-stream';
  } catch { return false; }
}
function localDataUrl(value: string): string | null {
  if (value.length > 280 * 1024 * 1024) return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  const mime = match[1]; const payload = match[2];
  const header = Uint8Array.from(atob(payload.slice(0, 32)), char => char.charCodeAt(0));
  const prefix = (...bytes: number[]) => bytes.every((byte, index) => header[index] === byte);
  const image = (mime === 'image/png' && prefix(137, 80, 78, 71, 13, 10, 26, 10)) ||
    (mime === 'image/jpeg' && prefix(255, 216, 255)) ||
    (mime === 'image/gif' && (prefix(71, 73, 70, 56, 55, 97) || prefix(71, 73, 70, 56, 57, 97))) ||
    (mime === 'image/webp' && prefix(82, 73, 70, 70) && [87, 69, 66, 80].every((byte, index) => header[index + 8] === byte));
  const bytes = payload.length / 4 * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
  if (image && bytes <= 25 * 1024 * 1024) return value;
  const riff = prefix(82, 73, 70, 70); const ogg = prefix(79, 103, 103, 83); const webm = prefix(26, 69, 223, 163);
  const mp4 = [102, 116, 121, 112].every((byte, index) => header[index + 4] === byte);
  const audio = (['audio/wav', 'audio/x-wav'].includes(mime) && riff && [87, 65, 86, 69].every((byte, index) => header[index + 8] === byte)) ||
    (mime === 'audio/ogg' && ogg) || (mime === 'audio/webm' && webm) || (mime === 'audio/mp4' && mp4) ||
    (mime === 'audio/mpeg' && (prefix(73, 68, 51) || (header[0] === 255 && (header[1] & 224) === 224)));
  const video = (mime === 'video/mp4' && mp4) || (mime === 'video/webm' && webm) || (mime === 'video/ogg' && ogg);
  if ((audio && bytes <= 50 * 1024 * 1024) || (video && bytes <= 200 * 1024 * 1024)) return value;
  // Existing local/transmission documents stay local and download as opaque bytes, including code.
  if (bytes <= 25 * 1024 * 1024 && ['text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/json', 'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'].includes(mime)) return `data:application/octet-stream;base64,${payload}`;
  return null;
}
export type ResolvedAttachment = Attachment & { readSourceUrl: string; readExpiresAt?: number; release?: () => void };
export interface AttachmentAccessResource { url: string; expiresAt?: number; release?: () => void; metadata?: Pick<Attachment, 'name' | 'type' | 'size' | 'mimeType'> }
async function resolveEncryptedAccess(value: string, sessionId: string): Promise<AttachmentAccessResource> {
  const uid = auth.currentUser?.uid; const generation = getTeamKeyCacheGeneration();
  if (!uid) throw denied();
  let changed = false; let url: string | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
  let stopAuth = () => undefined as void; let stopVault = () => undefined as void; let stopTeam = () => undefined as void;
  const release = () => { changed = true; clearTimeout(timer); if (url) { URL.revokeObjectURL(url); url = undefined; } stopAuth(); stopVault(); stopTeam();
    window.removeEventListener('mnemosyne:local-ai-config', release); window.removeEventListener('storage', release); };
  stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) release(); });
  stopVault = onMemoryCryptoChanged(release); stopTeam = onTeamKeyChanged(release);
  window.addEventListener('mnemosyne:local-ai-config', release); window.addEventListener('storage', release);
  let opened: Awaited<ReturnType<typeof import('./encryptedAttachmentRead').readEncryptedAttachment>> | undefined;
  try {
    const { readEncryptedAttachment } = await import('./encryptedAttachmentRead');
    opened = await readEncryptedAttachment(value, sessionId);
    if (changed || auth.currentUser?.uid !== uid || !isMemoryCryptoReady() || getTeamKeyCacheGeneration() !== generation || opened.expiresAt <= Date.now()) throw denied();
    url = URL.createObjectURL(new Blob([new Uint8Array(opened.bytes).buffer], { type: opened.metadata.mimeType }));
    timer = setTimeout(release, opened.expiresAt - Date.now());
    return { url, expiresAt: opened.expiresAt, release, metadata: { name: opened.metadata.name,
      type: opened.metadata.delivery === 'preview' ? opened.metadata.category : 'document',
      size: opened.metadata.plainBytes, mimeType: opened.metadata.mimeType } };
  } catch { release(); throw denied(); }
  finally { opened?.bytes.fill(0); }
}
async function resolveAttachmentAccess(value: string, options?: { sessionId?: string }): Promise<AttachmentAccessResource> {
  if (!isMemoryCryptoReady()) throw denied();
  if (value.startsWith('mnemosyne-attachment:')) {
    if (!options?.sessionId) throw denied(); return resolveEncryptedAccess(value, options.sessionId);
  }
  // Locally created blobs are not cloud requests. Active data URLs are never rendered as links.
  if (value.startsWith('blob:') && new URL(value.slice(5)).origin === window.location.origin) return { url: value };
  if (value.startsWith('data:')) {
    const safe = localDataUrl(value); if (!safe) throw denied(); return { url: safe };
  }
  const uid = auth.currentUser?.uid; const path = parseStorageObjectPathFromUrl(value);
  if (!uid || !path || !options?.sessionId) throw denied();
  let changed = false;
  const stop = onAuthStateChanged(auth, user => { if (user?.uid !== uid) changed = true; });
  const stopCrypto = onMemoryCryptoChanged(() => { changed = true; });
  try {
    const mint = httpsCallable(getFunctions(app, 'europe-west1'), 'mintAttachmentReadUrl');
    const response = await mint({ objectPath: path, sessionId: options.sessionId });
    const payload = response.data as { url?: unknown; expiresAt?: unknown; objectPath?: unknown };
    if (changed || !isMemoryCryptoReady() || auth.currentUser?.uid !== uid || payload.objectPath !== path || !signedUrlMatches(payload.url, path) ||
        typeof payload.expiresAt !== 'number' || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now() ||
        payload.expiresAt > Date.now() + 120_000) throw denied();
    return { url: payload.url, expiresAt: payload.expiresAt };
  } catch { throw denied(); } finally { stop(); stopCrypto(); }
}
export async function resolveAttachmentUrl(value: string, options?: { sessionId?: string }): Promise<string> {
  try { return (await resolveAttachmentAccess(value, options)).url; } catch { throw denied(); }
}
/** Download callers release freshly decrypted blobs when finished; previews also expire and revoke on context changes. */
export async function resolveAttachmentDownload(value: string, options?: { sessionId?: string }): Promise<AttachmentAccessResource> {
  try { return await resolveAttachmentAccess(value, options); } catch { throw denied(); }
}
export async function resolveAttachments(attachments: Attachment[], options?: { sessionId?: string }): Promise<ResolvedAttachment[]> {
  // Each rejected reference is hidden; never substitute its old persistent token or arbitrary external URL.
  const results = await Promise.all(attachments.map(async item => {
    try {
      const access = await resolveAttachmentAccess(item.url, options);
      return { ...item, ...access.metadata, url: access.url, readSourceUrl: item.url, readExpiresAt: access.expiresAt, release: access.release };
    } catch { return null; }
  }));
  return results.filter(item => item !== null);
}
