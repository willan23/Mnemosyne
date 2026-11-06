/**
 * Export soberano: payload local em claro (cofre desbloqueado) + grafo,
 * empacotado em ZIP ou JSON+manifest. Cifra opcional do arquivo com
 * passphrase (AES-GCM + PBKDF2 via utils/crypto).
 */

import JSZip from 'jszip';
import {
  deriveAesKeyFromPassphrase,
  encryptBytesAesGcm,
} from './crypto';
import { isMemoryCryptoReady } from '../services/memoryCrypto';

export const SOVEREIGN_EXPORT_FORMAT = 'mnemosyne.sovereign-export' as const;
export const SOVEREIGN_EXPORT_VERSION = 1 as const;
export const EXPORT_PASSPHRASE_MIN_LENGTH = 8;
export const EXPORT_KDF_ITERATIONS = 250_000;

export class SovereignExportLockedError extends Error {
  constructor(message = 'O cofre tem de estar desbloqueado para exportar texto em claro.') {
    super(message);
    this.name = 'SovereignExportLockedError';
  }
}

export interface SovereignExportMemoryInput {
  id: string;
  text: string;
  title?: string | null;
  tags?: string[];
  category?: string | null;
  timestamp: number;
  updatedAt?: number | null;
  connections?: string[];
  position?: [number, number, number] | null;
  celestialType?: string | null;
  importance?: number | null;
  semanticClusterId?: string | null;
  parentId?: string | null;
  encLocked?: boolean;
}

export interface SovereignExportMemoryRecord {
  id: string;
  text: string;
  title: string | null;
  tags: string[];
  category: string | null;
  timestamp: number;
  updatedAt: number | null;
  connections: string[];
  position: [number, number, number] | null;
  celestialType: string | null;
  importance: number | null;
  semanticClusterId: string | null;
  parentId: string | null;
}

export interface SovereignExportGraphNode {
  id: string;
  title: string | null;
  tags: string[];
  position: [number, number, number] | null;
}

export interface SovereignExportGraphEdge {
  source: string;
  target: string;
}

export interface SovereignExportManifest {
  format: typeof SOVEREIGN_EXPORT_FORMAT;
  version: typeof SOVEREIGN_EXPORT_VERSION;
  exportedAt: string;
  memoryCount: number;
  edgeCount: number;
  passphraseProtected: boolean;
  notes: string[];
}

export interface SovereignExportPayload {
  manifest: SovereignExportManifest;
  memories: SovereignExportMemoryRecord[];
  graph: {
    nodes: SovereignExportGraphNode[];
    edges: SovereignExportGraphEdge[];
  };
}

export interface EncryptedExportEnvelope {
  v: 1;
  alg: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ct: string;
  originalName: string;
  contentType: 'application/zip' | 'application/json';
}

export interface BuildSovereignExportOptions {
  vaultUnlocked: boolean;
  exportedAt?: string;
  passphraseProtected?: boolean;
}

const EXPORT_README = [
  'Mnemosyne — export soberano',
  '',
  'Este arquivo foi gerado no teu dispositivo. O texto das memórias foi',
  'decifrado localmente (o cofre tinha de estar desbloqueado).',
  '',
  'Ficheiros:',
  '  manifest.json  — versão, data, contagens',
  '  memories.json  — texto, título, tags, categoria, timestamps',
  '  graph.json     — nós (posições, tags) e arestas (conexões)',
  '',
  'O que NÃO entra neste arquivo:',
  '  - embeddings (existem em claro no Firestore, trade-off de pesquisa;',
  '    podes regenerá-los localmente a partir do texto)',
  '  - anexos binários (ficam na cloud / storage)',
  '  - a tua frase BIP-39 (nunca sai do dispositivo neste fluxo)',
  '',
  'Se cifrate o ZIP com passphrase, o ficheiro .enc.json usa AES-GCM-256',
  'e PBKDF2-SHA-256. Sem a passphrase o arquivo é ilegível.',
].join('\n');

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function asPosition(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (![x, y, z].every(Number.isFinite)) return null;
  return [x, y, z];
}

function normalizeMemory(input: SovereignExportMemoryInput): SovereignExportMemoryRecord {
  return {
    id: input.id,
    text: typeof input.text === 'string' ? input.text : '',
    title: typeof input.title === 'string' && input.title.trim() ? input.title : null,
    tags: Array.isArray(input.tags) ? input.tags.filter((tag) => typeof tag === 'string') : [],
    category: typeof input.category === 'string' && input.category.trim() ? input.category : null,
    timestamp: typeof input.timestamp === 'number' ? input.timestamp : 0,
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : null,
    connections: Array.isArray(input.connections)
      ? input.connections.filter((id) => typeof id === 'string' && id.length > 0)
      : [],
    position: asPosition(input.position),
    celestialType: typeof input.celestialType === 'string' ? input.celestialType : null,
    importance: typeof input.importance === 'number' && Number.isFinite(input.importance)
      ? input.importance
      : null,
    semanticClusterId: typeof input.semanticClusterId === 'string' ? input.semanticClusterId : null,
    parentId: typeof input.parentId === 'string' ? input.parentId : null,
  };
}

function buildGraph(memories: SovereignExportMemoryRecord[]): SovereignExportPayload['graph'] {
  const idSet = new Set(memories.map((memory) => memory.id));
  const nodes: SovereignExportGraphNode[] = memories.map((memory) => ({
    id: memory.id,
    title: memory.title,
    tags: memory.tags,
    position: memory.position,
  }));

  const seen = new Set<string>();
  const edges: SovereignExportGraphEdge[] = [];
  for (const memory of memories) {
    for (const target of memory.connections) {
      if (!idSet.has(target) || target === memory.id) continue;
      const [source, dest] = memory.id < target ? [memory.id, target] : [target, memory.id];
      const key = `${source}|${dest}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target: dest });
    }
  }

  return { nodes, edges };
}

export function isVaultReadyForExport(vaultUnlocked = isMemoryCryptoReady()): boolean {
  return vaultUnlocked === true;
}

/**
 * Constrói o payload soberano (JSON). Testável sem JSZip.
 * Recusa cofre bloqueado e memórias ainda cifradas (encLocked).
 */
export function buildSovereignExportPayload(
  memories: SovereignExportMemoryInput[],
  options: BuildSovereignExportOptions
): SovereignExportPayload {
  if (!options.vaultUnlocked) {
    throw new SovereignExportLockedError();
  }

  const lockedCount = memories.filter((memory) => memory.encLocked).length;
  if (lockedCount > 0) {
    throw new SovereignExportLockedError(
      `${lockedCount} memória(s) ainda cifradas. Desbloqueia o cofre antes de exportar.`
    );
  }

  const records = memories.map(normalizeMemory);
  const graph = buildGraph(records);
  const exportedAt = options.exportedAt ?? new Date().toISOString();

  return {
    manifest: {
      format: SOVEREIGN_EXPORT_FORMAT,
      version: SOVEREIGN_EXPORT_VERSION,
      exportedAt,
      memoryCount: records.length,
      edgeCount: graph.edges.length,
      passphraseProtected: Boolean(options.passphraseProtected),
      notes: [
        'Texto e título decifrados localmente; a API e o Firestore não viram este plaintext neste passo.',
        'Embeddings não são incluídos (existem em claro na cloud como trade-off de pesquisa semântica).',
        'Anexos binários não entram neste arquivo.',
      ],
    },
    memories: records,
    graph,
  };
}

/** Ficheiros do arquivo (sem JSZip) — o que os testes devem asserir. */
export function serializeSovereignExportFiles(payload: SovereignExportPayload): Record<string, string> {
  return {
    'manifest.json': `${JSON.stringify(payload.manifest, null, 2)}\n`,
    'memories.json': `${JSON.stringify(payload.memories, null, 2)}\n`,
    'graph.json': `${JSON.stringify(payload.graph, null, 2)}\n`,
    'README.txt': `${EXPORT_README}\n`,
  };
}

export async function encryptExportBytes(
  plain: ArrayBuffer,
  passphrase: string,
  originalName = 'mnemosyne-export.zip',
  contentType: EncryptedExportEnvelope['contentType'] = 'application/zip'
): Promise<EncryptedExportEnvelope> {
  if (passphrase.trim().length < EXPORT_PASSPHRASE_MIN_LENGTH) {
    throw new Error(`A passphrase deve ter pelo menos ${EXPORT_PASSPHRASE_MIN_LENGTH} caracteres.`);
  }

  const salt = new Uint8Array(16);
  window.crypto.getRandomValues(salt);
  const key = await deriveAesKeyFromPassphrase(passphrase, salt, EXPORT_KDF_ITERATIONS);
  const sealed = await encryptBytesAesGcm(plain, key);

  return {
    v: 1,
    alg: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    iterations: EXPORT_KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: sealed.iv,
    ct: bytesToBase64(new Uint8Array(sealed.cipherBytes)),
    originalName,
    contentType,
  };
}

export async function decryptExportBytes(
  envelope: EncryptedExportEnvelope,
  passphrase: string
): Promise<ArrayBuffer> {
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ct);
  const key = await deriveAesKeyFromPassphrase(passphrase, salt, envelope.iterations);
  return window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer },
    key,
    ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer
  );
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function packageSovereignExportZip(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

export interface DownloadSovereignExportOptions {
  vaultUnlocked: boolean;
  passphrase?: string;
  exportedAt?: string;
}

function dateStamp(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Empacota e descarrega o export. Com passphrase, o ZIP é cifrado (AES-GCM)
 * e o ficheiro descarregado é um envelope JSON — não o ZIP em claro.
 */
export async function downloadSovereignExport(
  memories: SovereignExportMemoryInput[],
  options: DownloadSovereignExportOptions
): Promise<{ filename: string; encrypted: boolean; memoryCount: number }> {
  const passphrase = options.passphrase?.trim() ?? '';
  const payload = buildSovereignExportPayload(memories, {
    vaultUnlocked: options.vaultUnlocked,
    exportedAt: options.exportedAt,
    passphraseProtected: passphrase.length > 0,
  });
  const files = serializeSovereignExportFiles(payload);
  const zipBytes = await packageSovereignExportZip(files);
  const stamp = dateStamp(payload.manifest.exportedAt);

  if (passphrase.length > 0) {
    const envelope = await encryptExportBytes(
      zipBytes,
      passphrase,
      `mnemosyne-export-${stamp}.zip`,
      'application/zip'
    );
    const filename = `mnemosyne-export-${stamp}.enc.json`;
    triggerBrowserDownload(
      new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }),
      filename
    );
    return { filename, encrypted: true, memoryCount: payload.manifest.memoryCount };
  }

  const filename = `mnemosyne-export-${stamp}.zip`;
  triggerBrowserDownload(new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' }), filename);
  return { filename, encrypted: false, memoryCount: payload.manifest.memoryCount };
}
