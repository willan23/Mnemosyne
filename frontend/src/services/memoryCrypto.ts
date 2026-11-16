/**
 * Cifragem em repouso do conteúdo das novas memórias e migração do legado.
 *
 * Os campos sensíveis (`text` e `title`) são cifrados com AES-GCM-256 e uma
 * chave derivada da mnemónica de 12 palavras (PBKDF2, salt dedicado).
 * Novas escritas guardam o envelope `enc: { v, iv, ct }`. Documentos históricos
 * sem envelope podem ainda conter texto em claro até à migração no cliente.
 *
 * Compatibilidade:
 * - Documentos legados (sem `enc`) continuam legíveis em texto claro.
 * - A migração é lazy (regravar cifra) + em lote via `migrateLegacyMemoriesToEncrypted`.
 *
 * Trade-off documentado: embeddings, tags, categoria, conexões e posições
 * permanecem em claro porque são necessários para índices/queries locais e
 * podem revelar informação semântica e devem ser tratados como dados sensíveis.
 */

import {
  collection,
  type DocumentData,
  documentId,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  getDocs,
  getDocFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  decryptTextAesGcm,
  deriveAesKeyFromMnemonic,
  encryptTextAesGcm,
} from '../utils/crypto';
import {
  finishMigrationCheckpoint,
  migrationCheckpointKey,
  readMigrationCheckpoint,
  retryMigrationOperation,
  writeMigrationCheckpoint,
  type MigrationCheckpointStore,
} from './memoryMigrationSupport';
import type {PersonalMemoryMutationDeps} from './personalMemoryMutation';
import type {PersonalMigrationSource} from './personalMigrationRecovery';

export const MEMORY_ENC_VERSION = 1 as const;
const MEMORY_KEY_SALT = 'mnemosyne:memories:v1';
const MEMORY_CRYPTO_EVENT = 'mnemosyne:memory-crypto-changed';
const MIGRATION_KEY_CHANGED = 'Migração interrompida porque a mnemónica ativa mudou. Verifica a chave e repete apenas após confirmar o backup.';

export interface EncryptedMemoryEnvelope {
  v: typeof MEMORY_ENC_VERSION;
  iv: string;
  ct: string;
}

export interface MemorySecretFields {
  text: string;
  title: string | null;
}

/** Campos que substituem `text`/`title` no documento Firestore cifrado. */
export interface EncryptedMemoryDocFields {
  text: '';
  title: null;
  enc: EncryptedMemoryEnvelope;
}

export const LOCKED_MEMORY_PLACEHOLDER =
  'Memória cifrada — desbloqueia a sessão com a tua frase de 12 palavras.';

export class MemoryCryptoLockedError extends Error {
  constructor() {
    super('Desbloqueia a mnemónica de 12 palavras antes de gravar ou ler memórias cifradas.');
    this.name = 'MemoryCryptoLockedError';
  }
}

export class MemoryMigrationCancelledError extends Error {
  constructor() {
    super('Migração interrompida. Os registos já cifrados permanecem intactos; podes repetir a operação.');
    this.name = 'MemoryMigrationCancelledError';
  }
}

let activeKeyPromise: Promise<CryptoKey> | null = null;
let activeFingerprint: string | null = null;

function notifyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MEMORY_CRYPTO_EVENT));
  }
}

/** Define (ou limpa) a mnemónica ativa usada para cifrar/decifrar memórias. */
export function setMemoryCryptoMnemonic(mnemonic: string[] | null): void {
  if (!mnemonic || mnemonic.length !== 12) {
    if (activeKeyPromise === null && activeFingerprint === null) return;
    activeKeyPromise = null;
    activeFingerprint = null;
    notifyChanged();
    return;
  }

  const fingerprint = mnemonic.join(' ').toLowerCase();
  if (fingerprint === activeFingerprint && activeKeyPromise) return;

  activeFingerprint = fingerprint;
  activeKeyPromise = deriveAesKeyFromMnemonic(mnemonic, MEMORY_KEY_SALT);
  notifyChanged();
}

/** Permite injetar uma CryptoKey diretamente (testes). */
export function setMemoryCryptoKeyForTests(key: CryptoKey | null): void {
  activeKeyPromise = key ? Promise.resolve(key) : null;
  activeFingerprint = key ? 'test-key' : null;
  notifyChanged();
}

export function isMemoryCryptoReady(): boolean {
  return activeKeyPromise !== null;
}

/** Subscreve mudanças de estado da chave (unlock/lock). Devolve unsubscribe. */
export function onMemoryCryptoChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(MEMORY_CRYPTO_EVENT, callback);
  return () => window.removeEventListener(MEMORY_CRYPTO_EVENT, callback);
}

async function getActiveKey(): Promise<CryptoKey> {
  if (!activeKeyPromise) throw new MemoryCryptoLockedError();
  return activeKeyPromise;
}

/** Attachment key wrapping uses a bound binary payload; the active vault key never leaves this module. */
export async function encryptMemoryBinary(bytes: Uint8Array, aad: Uint8Array): Promise<{ iv: string; ct: string }> {
  if (bytes.byteLength !== 32 || aad.byteLength < 1 || aad.byteLength > 2048) throw new MemoryCryptoLockedError();
  const promise = activeKeyPromise;
  const key = await getActiveKey();
  if (!promise || activeKeyPromise !== promise) throw new MemoryCryptoLockedError();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer, additionalData: new Uint8Array(aad).buffer }, key, new Uint8Array(bytes).buffer);
  if (activeKeyPromise !== promise) throw new MemoryCryptoLockedError();
  return { iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(encrypted))) };
}
export async function decryptMemoryBinary(envelope: { iv: string; ct: string }, aad: Uint8Array): Promise<Uint8Array> {
  if (!/^[A-Za-z0-9+/]{16}$/.test(envelope.iv) || !/^[A-Za-z0-9+/]{64}$/.test(envelope.ct) ||
      aad.byteLength < 1 || aad.byteLength > 2048) throw new MemoryCryptoLockedError();
  const promise = activeKeyPromise;
  const key = await getActiveKey();
  if (!promise || activeKeyPromise !== promise) throw new MemoryCryptoLockedError();
  const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv).buffer, additionalData: new Uint8Array(aad).buffer }, key, decode(envelope.ct).buffer));
  if (activeKeyPromise !== promise) { bytes.fill(0); throw new MemoryCryptoLockedError(); }
  return bytes;
}

export function isEncryptedMemoryEnvelope(value: unknown): value is EncryptedMemoryEnvelope {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 3 &&
    (value as EncryptedMemoryEnvelope).v === MEMORY_ENC_VERSION &&
    typeof (value as EncryptedMemoryEnvelope).iv === 'string' &&
    (value as EncryptedMemoryEnvelope).iv.length > 0 &&
    typeof (value as EncryptedMemoryEnvelope).ct === 'string' &&
    (value as EncryptedMemoryEnvelope).ct.length > 0
  );
}

/** Cifra `text`/`title` num envelope versionado com IV único por documento. */
export async function encryptMemoryFields(fields: {
  text: string;
  title?: string | null;
}): Promise<EncryptedMemoryEnvelope> {
  const key = await getActiveKey();
  const payload: MemorySecretFields = {
    text: fields.text ?? '',
    title: fields.title?.trim() ? fields.title : null,
  };
  const sealed = await encryptTextAesGcm(JSON.stringify(payload), key);
  return { v: MEMORY_ENC_VERSION, iv: sealed.iv, ct: sealed.data };
}

export async function decryptMemoryEnvelope(
  envelope: EncryptedMemoryEnvelope
): Promise<MemorySecretFields> {
  const key = await getActiveKey();
  const plaintext = await decryptTextAesGcm({ iv: envelope.iv, data: envelope.ct }, key);
  const parsed = JSON.parse(plaintext) as Partial<MemorySecretFields>;
  return {
    text: typeof parsed.text === 'string' ? parsed.text : '',
    title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : null,
  };
}
/** Re-encrypt a valid memory payload with a fresh IV, preserving its exact JSON bytes. */
export async function recipherMemoryEnvelope(envelope: EncryptedMemoryEnvelope): Promise<EncryptedMemoryEnvelope> {
  if (!isEncryptedMemoryEnvelope(envelope)) throw new MemoryCryptoLockedError();
  const promise = activeKeyPromise, key = await getActiveKey();
  if (!promise || activeKeyPromise !== promise) throw new MemoryCryptoLockedError();
  const plaintext = await decryptTextAesGcm({ iv: envelope.iv, data: envelope.ct }, key);
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).some(field => !['text', 'title'].includes(field)) ||
      typeof (parsed as { text?: unknown }).text !== 'string' ||
      (parsed as { title?: unknown }).title !== undefined && (parsed as { title?: unknown }).title !== null && typeof (parsed as { title?: unknown }).title !== 'string') throw new MemoryCryptoLockedError();
  const sealed = await encryptTextAesGcm(plaintext, key);
  if (await decryptTextAesGcm(sealed, key) !== plaintext || activeKeyPromise !== promise) throw new MemoryCryptoLockedError();
  return { v: MEMORY_ENC_VERSION, iv: sealed.iv, ct: sealed.data };
}

/**
 * Constrói os campos Firestore para uma escrita cifrada:
 * `text: ''` e `title: null` (compatível com leitores legados) + envelope `enc`.
 * Lança `MemoryCryptoLockedError` se a mnemónica não estiver desbloqueada.
 */
export async function buildEncryptedMemoryFields(
  text: string,
  title?: string | null
): Promise<EncryptedMemoryDocFields> {
  const enc = await encryptMemoryFields({ text, title });
  return { text: '', title: null, enc };
}

export interface ResolvedMemoryFields {
  text: string;
  title?: string;
  /** true se o documento está cifrado em repouso. */
  encrypted: boolean;
  /** true se está cifrado mas a chave atual não consegue decifrar. */
  locked: boolean;
}

/**
 * Resolve os campos sensíveis de um documento Firestore de memória:
 * decifra `enc` quando existir, ou devolve o texto claro legado.
 * Nunca lança — documentos ilegíveis viram placeholders bloqueados.
 */
export async function resolveMemoryDocFields(
  data: Record<string, unknown>
): Promise<ResolvedMemoryFields> {
  const envelope = data.enc;
  if (isEncryptedMemoryEnvelope(envelope)) {
    if (!isMemoryCryptoReady()) {
      return { text: LOCKED_MEMORY_PLACEHOLDER, title: undefined, encrypted: true, locked: true };
    }
    try {
      const fields = await decryptMemoryEnvelope(envelope);
      return {
        text: fields.text,
        title: fields.title ?? undefined,
        encrypted: true,
        locked: false,
      };
    } catch {
      return { text: LOCKED_MEMORY_PLACEHOLDER, title: undefined, encrypted: true, locked: true };
    }
  }

  return {
    text: typeof data.text === 'string' ? data.text : '',
    title: typeof data.title === 'string' && data.title.trim() ? data.title : undefined,
    encrypted: false,
    locked: false,
  };
}

export interface MemoryMigrationProgress {
  total: number;
  migrated: number;
  skipped: number;
  failed: number;
}

/** Shared and team records need their own key migration, never the personal key. */
function hasLegacyPersonalPlaintext(data: Record<string, unknown>): boolean {
  if (data.teamId != null || data.enc != null) return false;
  if (data.sharedWithIds != null &&
      (!Array.isArray(data.sharedWithIds) || data.sharedWithIds.length > 0)) return false;
  return (typeof data.text === 'string' && data.text.length > 0) ||
    (typeof data.title === 'string' && data.title.length > 0);
}

export function isPersonalVersionParent(data: Record<string, unknown>, uid: string): boolean {
  return data.uid === uid && data.teamId == null &&
    (data.sharedWithIds == null ||
      (Array.isArray(data.sharedWithIds) && data.sharedWithIds.length === 0));
}

export function isLegacyPersonalVersionCandidate(data: Record<string, unknown>): boolean {
  return hasLegacyPersonalPlaintext(data);
}

export function isLegacyPersonalMemoryCandidate(data: Record<string, unknown>, uid: string): boolean {
  return data.uid === uid && hasLegacyPersonalPlaintext(data);
}

export function isLegacyNestedMemoryCandidate(data: Record<string, unknown>, uid: string): boolean {
  return (data.uid == null || data.uid === uid) && hasLegacyPersonalPlaintext(data);
}

export function sameUpdatedAt(a: unknown, b: unknown): boolean {
  return a === b || (a instanceof Timestamp && b instanceof Timestamp && a.isEqual(b));
}

/**
 * Migração em lote: cifra memórias legadas em `sessions`, `users/{uid}/memories`
 * e versões históricas pessoais. Pagina cada coleção e consulta versões por
 * sessão com concorrência limitada; uma execução interrompida pode recomeçar.
 * A callable só permite a conversão única pelo dono, com base e arquivo cifrado.
 * Não altera `updatedAt` para não disparar re-sync mobile de conteúdo idêntico.
 */
export interface MemoryMigrationDeps {
  enabled:()=>boolean;
  mutation?:PersonalMemoryMutationDeps;
  migrateRecord:(uid:string,source:PersonalMigrationSource,guard:()=>void)=>Promise<unknown>;
}
export async function migrateLegacyMemoriesToEncrypted(
  uid: string,
  onProgress?: (progress: MemoryMigrationProgress) => void,
  options: { pageSize?: number; signal?: AbortSignal; checkpointStore?: MigrationCheckpointStore } = {},
  firestore: Firestore = db,
  dependencies?:MemoryMigrationDeps,
):Promise<MemoryMigrationProgress>{
  if(!activeKeyPromise)throw new MemoryCryptoLockedError();
  const {withPersonalMemoryMutation}=await import('./personalMemoryMutation');
  const resolved:MemoryMigrationDeps=dependencies??{enabled:()=>false,migrateRecord:async(uid,source,guard)=>{const service=await import('./personalMigrationRecovery');return service.migratePersonalRecord(uid,source,guard);}};
  if(!dependencies){const service=await import('./personalMigrationRecovery');resolved.enabled=service.personalMigrationWritesEnabled;}
  if(!resolved.enabled())throw new Error('A migração pessoal aguarda ativação.');
  return withPersonalMemoryMutation(uid,context=>runLegacyPersonalMigration(uid,onProgress,options,firestore,context.assertCurrent,resolved),resolved.mutation);
}
async function runLegacyPersonalMigration(
  uid:string,onProgress:((progress:MemoryMigrationProgress)=>void)|undefined,
  options:{pageSize?:number;signal?:AbortSignal;checkpointStore?:MigrationCheckpointStore},
  firestore:Firestore,scope:()=>void,dependencies:MemoryMigrationDeps,
): Promise<MemoryMigrationProgress> {
  if (!activeKeyPromise) throw new MemoryCryptoLockedError();
  const migrationKeyPromise = activeKeyPromise;
  const pageSize = Number.isInteger(options.pageSize)
    ? Math.min(200, Math.max(1, options.pageSize as number)) : 100;
  const assertActive = () => {
    scope();
    if (options.signal?.aborted) throw new MemoryMigrationCancelledError();
    if (activeKeyPromise !== migrationKeyPromise) throw new Error(MIGRATION_KEY_CHANGED);
  };
  let checkpointStore = options.checkpointStore;
  if (!checkpointStore) {
    try { checkpointStore = globalThis.localStorage; } catch { /* storage denied */ }
  }
  const checkpointKey = migrationCheckpointKey(uid);
  const checkpoint = readMigrationCheckpoint(checkpointStore, checkpointKey);
  const waitRetry = (milliseconds: number): Promise<void> => new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new MemoryMigrationCancelledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new MemoryMigrationCancelledError());
    };
    const timer = setTimeout(() => {
      options.signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    options.signal?.addEventListener('abort', onAbort, { once: true });
  });
  const progress: MemoryMigrationProgress = {
    total: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
  };
  assertActive();onProgress?.({ ...progress });

  const migrateOne = async (
    docSnap: QueryDocumentSnapshot,
    eligible: (data: Record<string, unknown>, uid: string) => boolean,
    parentRef?: DocumentReference,
  ): Promise<void> => {
    assertActive();
    const data = docSnap.data() as Record<string, unknown>;
    if (!eligible(data, uid)) {
      progress.skipped += 1;
      onProgress?.({ ...progress });
      return;
    }
    progress.total += 1;
    try {
      let parentData:Record<string,unknown>|undefined;
      if(parentRef){const parent=await retryMigrationOperation(()=>getDocFromServer(parentRef),assertActive,waitRetry);assertActive();if(!parent.exists()||!isPersonalVersionParent(parent.data(),uid)||parent.data().teamId!==null){progress.skipped++;onProgress?.({...progress});return;}parentData=parent.data();}
      await dependencies.migrateRecord(uid,{kind:parentRef?'version':docSnap.ref.path.startsWith(`users/${uid}/memories/`)?'nested':'session',recordId:docSnap.id,sessionId:parentRef?.id??null,data,parentData},assertActive);
      assertActive();progress.migrated+=1;
    } catch (error) {
      if (error instanceof MemoryMigrationCancelledError) throw error;
      if (activeKeyPromise !== migrationKeyPromise) throw new Error(MIGRATION_KEY_CHANGED);
      if (options.signal?.aborted) throw new MemoryMigrationCancelledError();
      scope();
      console.warn('Falha a migrar uma memória legada para formato cifrado.');
      progress.failed += 1;
    }
    onProgress?.({ ...progress });
  };

  const migrateVersions = async (parentRef: DocumentReference): Promise<void> => {
    const base = query(collection(parentRef, 'versions'), orderBy(documentId()), limit(pageSize));
    let cursor: QueryDocumentSnapshot | null = null;
    while (true) {
      assertActive();
      const page: QuerySnapshot<DocumentData> = await retryMigrationOperation(
        () => getDocs(cursor ? query(base, startAfter(cursor)) : base), assertActive, waitRetry,
      );
      for (const version of page.docs) {
        const failures=progress.failed;
        await migrateOne(version, isLegacyPersonalVersionCandidate, parentRef);
        if(progress.failed>failures)return;
      }
      if (page.size < pageSize) break;
      cursor = page.docs[page.docs.length - 1];
    }
  };

  const sessionsBase = query(
    collection(firestore, 'sessions'), where('uid', '==', uid),
    where('teamId', '==', null),
    orderBy(documentId()), limit(pageSize),
  );
  const nestedBase = query(
    collection(firestore, 'users', uid, 'memories'), orderBy(documentId()), limit(pageSize),
  );
  const scanSessions = async (initialAfter: string | null, saveCheckpoint: boolean): Promise<boolean> => {
    let after = initialAfter;
    while (true) {
      assertActive();
      const page: QuerySnapshot<DocumentData> = await retryMigrationOperation(
        () => getDocs(after ? query(sessionsBase, startAfter(after)) : sessionsBase),
        assertActive, waitRetry,
      );
      const failuresBeforePage = progress.failed;
      for (const session of page.docs) {
        await migrateOne(session, isLegacyPersonalMemoryCandidate);
        if(progress.failed>failuresBeforePage)return false;
      }
      const versionParents = page.docs.filter((session) =>
        isPersonalVersionParent(session.data() as Record<string, unknown>, uid)
      );
      for(const parent of versionParents){await migrateVersions(parent.ref);if(progress.failed>failuresBeforePage)return false;}
      assertActive();
      if (progress.failed > failuresBeforePage) return false;
      if (page.docs.length > 0) {
        after = page.docs[page.docs.length - 1].id;
        if (saveCheckpoint) writeMigrationCheckpoint(checkpointStore, checkpointKey,
          { v: 1, phase: 'sessions', after });
      }
      if (page.size < pageSize) break;
    }
    if (saveCheckpoint) writeMigrationCheckpoint(checkpointStore, checkpointKey,
      { v: 1, phase: 'nested', after: null });
    return true;
  };
  const scanNested = async (initialAfter: string | null, saveCheckpoint: boolean): Promise<boolean> => {
    let after = initialAfter;
    while (true) {
      assertActive();
      const page: QuerySnapshot<DocumentData> = await retryMigrationOperation(
        () => getDocs(after ? query(nestedBase, startAfter(after)) : nestedBase),
        assertActive, waitRetry,
      );
      const failuresBeforePage = progress.failed;
      for (const memory of page.docs) {
        await migrateOne(memory, isLegacyNestedMemoryCandidate);
        if(progress.failed>failuresBeforePage)return false;
      }
      assertActive();
      if (progress.failed > failuresBeforePage) return false;
      if (page.docs.length > 0) {
        after = page.docs[page.docs.length - 1].id;
        if (saveCheckpoint) writeMigrationCheckpoint(checkpointStore, checkpointKey,
          { v: 1, phase: 'nested', after });
      }
      if (page.size < pageSize) break;
    }
    return true;
  };
  if (checkpoint?.phase !== 'nested') {
    if (!await scanSessions(checkpoint?.after ?? null, true)) return progress;
  }
  if (!await scanNested(checkpoint?.phase === 'nested' ? checkpoint.after : null, true)) return progress;
  // A prior cursor may hide records inserted or changed before it. Verify the
  // whole collection once after resuming before discarding the checkpoint.
  if (checkpoint) {
    if (!await scanSessions(null, false)) return progress;
    if (!await scanNested(null, false)) return progress;
  }
  assertActive();
  finishMigrationCheckpoint(checkpointStore, checkpointKey);
  return progress;
}
