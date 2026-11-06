import { createHash } from 'node:crypto';
import { firestore } from 'firebase-admin';
import { https } from 'firebase-functions/v1';
import { attachmentActorIdValid } from './attachmentEnvelope';
import { opaqueAttachmentId } from './attachmentMutationContract';
import { ownerUidFromAttachmentPath, parseStorageObjectPathFromUrl } from './attachmentAccess';

type Source = 'sessions' | 'versions' | 'memories';
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const unavailable = () => new https.HttpsError('failed-precondition', 'Reconciliação incompleta; nenhum dado foi alterado.');
const tokenHash = (value: string) => createHash('sha256').update('legacy-token-comparison:v1\0').update(value).digest('hex');
const pathValid = (value: string) => value.length > 0 && Buffer.byteLength(value) <= 1024 && !/[\\\u0000-\u001f\u007f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
export interface LegacyStorageObjectMetadata { name: string; generation: string; size: string; metadata?: { firebaseStorageDownloadTokens?: unknown } }
type ParsedReference = { kind: 'storage'; path: string; readerSupported: boolean; tokenState: 'one' | 'missing' | 'ambiguous' | 'not-applicable'; digest: string | null } |
  { kind: 'inline' | 'opaque' | 'external' | 'foreign-bucket' | 'malformed' | 'unsupported-storage-url' };

/** Internal mapping only. Never fetches a URL, returns its query string or authorizes ownership. */
export function parseLegacyStorageReference(input: unknown, bucket: string): ParsedReference {
  if (typeof input !== 'string' || !input) return { kind: 'malformed' };
  if (/^(data:|blob:)/i.test(input)) return { kind: 'inline' };
  if (input.startsWith('mnemosyne-attachment:')) return { kind: opaqueAttachmentId(input) ? 'opaque' : 'malformed' };
  if (Buffer.byteLength(input) > 16 * 1024) return { kind: 'malformed' };
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return { kind: 'malformed' };
    let actualBucket: string | undefined; let objectPath: string | undefined; let firebase = false;
    if (url.hostname === 'firebasestorage.googleapis.com') {
      const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
      if (match) { actualBucket = decodeURIComponent(match[1]); objectPath = decodeURIComponent(match[2]); firebase = true; }
      else return { kind: 'unsupported-storage-url' };
    } else if (url.hostname === 'storage.googleapis.com') {
      const api = /^\/(?:download\/)?storage\/v1\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
      const path = /^\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (api) { actualBucket = decodeURIComponent(api[1]); objectPath = decodeURIComponent(api[2]); }
      else if (path && !url.pathname.startsWith('/storage/') && !url.pathname.startsWith('/download/')) {
        actualBucket = decodeURIComponent(path[1]); objectPath = decodeURIComponent(path[2]);
      } else return { kind: 'unsupported-storage-url' };
    } else if (url.hostname.endsWith('.storage.googleapis.com')) {
      actualBucket = url.hostname.slice(0, -'.storage.googleapis.com'.length); objectPath = decodeURIComponent(url.pathname.slice(1));
    } else return { kind: 'external' };
    if (actualBucket !== bucket) return { kind: 'foreign-bucket' };
    if (!objectPath || !pathValid(objectPath)) return { kind: 'malformed' };
    const tokens = url.searchParams.getAll('token');
    const tokenState = !firebase ? 'not-applicable' : tokens.length === 0 ? 'missing' : tokens.length !== 1 || !tokens[0] ? 'ambiguous' : 'one';
    return { kind: 'storage', path: objectPath, readerSupported: parseStorageObjectPathFromUrl(input, bucket) === objectPath,
      tokenState, digest: tokenState === 'one' ? tokenHash(tokens[0]) : null };
  } catch { return { kind: 'malformed' }; }
}

export const LEGACY_RECONCILIATION_REASONS = ['unknownNamespace', 'invalidAuthor', 'legacyOwnerMismatch', 'missingPersonalScope', 'invalidScope',
  'orphanVersion', 'historyAuthorMismatch', 'historyScopeMismatch', 'malformedList', 'oversizedList'] as const;
type Reason = typeof LEGACY_RECONCILIATION_REASONS[number];
interface DocumentContext { source: Source; path: string; data: Row; parent?: Row | null }
const referenceCounts = () => ({ total: 0, opaque: 0, inline: 0, external: 0, foreignBucket: 0, malformed: 0, unsupportedStorageUrl: 0,
  storage: 0, matchedObject: 0, missingObject: 0, unsupportedReaderFormat: 0, tokenMatchesMetadata: 0, tokenDiffersFromMetadata: 0,
  tokenAbsent: 0, tokenAmbiguous: 0, tokenNotApplicable: 0, tokenMetadataAbsent: 0, tokenMetadataMalformed: 0,
  pathUidMatchesAuthor: 0, pathUidDiffersFromAuthor: 0, pathUidOrAuthorUnavailable: 0, ambiguousAuthorContext: 0 });
type ReferenceCounts = ReturnType<typeof referenceCounts>;
interface ObjectState { size: bigint; tokens: Set<string>; tokensMalformed: boolean; references: number; authors: Set<string>; ambiguous: boolean; pathMismatch: boolean }

/** Holds paths/UIDs/digests only in memory. Aggregate output never includes these values. */
export function createLegacyAttachmentReconciler(bucket: string, objects: readonly LegacyStorageObjectMetadata[]) {
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket) || objects.length > 10000) throw unavailable();
  const index = new Map<string, ObjectState>();
  const objectNamespaces = { legacyAttachments: 0, encrypted: 0, quarantine: 0, other: 0 };
  for (const object of objects) {
    if (!object || typeof object.name !== 'string' || !object.name.startsWith('attachments/') || index.has(object.name) || !/^[1-9][0-9]*$/.test(String(object.generation)) ||
        !/^(0|[1-9][0-9]*)$/.test(String(object.size))) throw unavailable();
    const rawTokens = object.metadata?.firebaseStorageDownloadTokens;
    const tokens = typeof rawTokens === 'string' && Buffer.byteLength(rawTokens) <= 16384 ? rawTokens.split(',').map(value => value.trim()).filter(Boolean) : [];
    const tokensMalformed = rawTokens !== undefined && (typeof rawTokens !== 'string' || Buffer.byteLength(rawTokens) > 16384 || tokens.length > 64);
    const namespace = object.name.startsWith('attachments/') ? 'legacyAttachments' : object.name.startsWith('encrypted/') ? 'encrypted' : object.name.startsWith('quarantine/') ? 'quarantine' : 'other';
    objectNamespaces[namespace]++;
    index.set(object.name, { size: BigInt(object.size), tokens: new Set(tokensMalformed ? [] : tokens.map(tokenHash)), tokensMalformed,
      references: 0, authors: new Set(), ambiguous: false, pathMismatch: false });
  }
  const sources = Object.fromEntries(['sessions', 'versions', 'memories'].map(source => [source, { scanned: 0, documentsWithReferences: 0,
    references: referenceCounts(), reasons: Object.fromEntries(LEGACY_RECONCILIATION_REASONS.map(reason => [reason, 0])) as Record<Reason, number> }])) as
    Record<Source, { scanned: number; documentsWithReferences: number; references: ReferenceCounts; reasons: Record<Reason, number> }>;
  let mappingCoverageComplete = true;
  const observe = (context: DocumentContext) => {
    const summary = sources[context.source]; if (!summary) throw unavailable(); summary.scanned++;
    const parts = context.path.split('/'); const history = context.source === 'versions';
    const known = context.source === 'sessions' ? parts.length === 2 && parts[0] === 'sessions' :
      parts.length === 4 && parts[0] === (history ? 'sessions' : 'users') && parts[2] === context.source;
    const issues = new Set<Reason>(); const data = context.data;
    if (!known) { issues.add('unknownNamespace'); mappingCoverageComplete = false; }
    const authorValid = attachmentActorIdValid(data.uid);
    if (!authorValid) issues.add('invalidAuthor');
    if (context.source === 'memories' && known && data.uid !== parts[1]) issues.add('legacyOwnerMismatch');
    if (data.teamId === undefined) issues.add('missingPersonalScope');
    else if (data.teamId !== null && !attachmentActorIdValid(data.teamId)) issues.add('invalidScope');
    if (history && known) {
      if (!context.parent) issues.add('orphanVersion');
      else {
        if (data.uid !== context.parent.uid) issues.add('historyAuthorMismatch');
        if (data.teamId !== context.parent.teamId) issues.add('historyScopeMismatch');
      }
    }
    const ambiguous = !known || !authorValid || issues.has('legacyOwnerMismatch') || issues.has('orphanVersion') || issues.has('historyAuthorMismatch');
    const attachments = data.attachments;
    if (attachments == null) { issues.forEach(reason => summary.reasons[reason]++); return; }
    if (!Array.isArray(attachments)) { issues.add('malformedList'); mappingCoverageComplete = false; issues.forEach(reason => summary.reasons[reason]++); return; }
    if (attachments.length) summary.documentsWithReferences++;
    summary.references.total += attachments.length;
    if (attachments.length > 200) { issues.add('oversizedList'); mappingCoverageComplete = false; issues.forEach(reason => summary.reasons[reason]++); return; }
    for (const entry of attachments) {
      const parsed = parseLegacyStorageReference(row(entry).url, bucket); const counts = summary.references;
      if (parsed.kind !== 'storage') {
        const keys = { opaque: 'opaque', inline: 'inline', external: 'external', 'foreign-bucket': 'foreignBucket', malformed: 'malformed', 'unsupported-storage-url': 'unsupportedStorageUrl' } as const;
        counts[keys[parsed.kind]]++;
        if (['external', 'malformed', 'unsupported-storage-url'].includes(parsed.kind)) mappingCoverageComplete = false;
        continue;
      }
      counts.storage++; if (!parsed.readerSupported) counts.unsupportedReaderFormat++;
      const object = index.get(parsed.path);
      if (!object) { counts.missingObject++; continue; }
      counts.matchedObject++; object.references++;
      const pathUid = ownerUidFromAttachmentPath(parsed.path);
      if (authorValid) object.authors.add(data.uid as string);
      if (!pathUid || !authorValid) counts.pathUidOrAuthorUnavailable++;
      else if (pathUid === data.uid) counts.pathUidMatchesAuthor++;
      else { counts.pathUidDiffersFromAuthor++; object.pathMismatch = true; }
      if (ambiguous) { counts.ambiguousAuthorContext++; object.ambiguous = true; }
      if (parsed.tokenState === 'missing') counts.tokenAbsent++;
      else if (parsed.tokenState === 'ambiguous') counts.tokenAmbiguous++;
      else if (parsed.tokenState === 'not-applicable') counts.tokenNotApplicable++;
      else if (object.tokensMalformed) counts.tokenMetadataMalformed++;
      else if (!object.tokens.size) counts.tokenMetadataAbsent++;
      else if (object.tokens.has(parsed.digest!)) counts.tokenMatchesMetadata++;
      else counts.tokenDiffersFromMetadata++;
    }
    issues.forEach(reason => summary.reasons[reason]++);
  };
  const summary = () => {
    const totals = { observed: index.size, referenced: 0, notObservedInKnownReferences: 0, referencedByMultipleAuthorUids: 0,
      withAmbiguousAuthorContext: 0, withPathUidDifferentFromAuthor: 0, notObservedBytes: '0', namespaces: { ...objectNamespaces } };
    let notObservedBytes = BigInt(0);
    for (const object of index.values()) {
      if (object.references) totals.referenced++;
      else { totals.notObservedInKnownReferences++; notObservedBytes += object.size; }
      if (object.authors.size > 1) totals.referencedByMultipleAuthorUids++;
      if (object.ambiguous) totals.withAmbiguousAuthorContext++;
      if (object.pathMismatch) totals.withPathUidDifferentFromAuthor++;
    }
    totals.notObservedBytes = notObservedBytes.toString();
    return { sources: structuredClone(sources), objects: totals, mappingCoverageComplete, deletionAuthorized: false as const };
  };
  return { observe, summary };
}
export type LegacyAttachmentReconciler = ReturnType<typeof createLegacyAttachmentReconciler>;

/** Projected read-only scan; never reads text/title/enc, user profiles, Auth or original Storage bodies. */
export async function reconcileLegacyAttachmentReferencesPage(input: { source: Source; afterPath: string | null; limit: number },
  db: FirebaseFirestore.Firestore, collector: LegacyAttachmentReconciler) {
  const cursorParts = typeof input?.afterPath === 'string' ? input.afterPath.split('/') : [];
  if (!input || !['sessions', 'versions', 'memories'].includes(input.source) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 ||
      (input.afterPath !== null && (typeof input.afterPath !== 'string' || Buffer.byteLength(input.afterPath) > 6144 || cursorParts.length % 2 !== 0 ||
        cursorParts.some(part => !part || part === '.' || part === '..') || (input.source === 'sessions' ? cursorParts.length !== 2 || cursorParts[0] !== 'sessions' : cursorParts[cursorParts.length - 2] !== input.source)))) {
    throw new https.HttpsError('invalid-argument', 'Contexto de reconciliação inválido.');
  }
  const source = input.source; const collection = source === 'sessions' ? db.collection(source) : db.collectionGroup(source);
  let query = collection.orderBy(firestore.FieldPath.documentId()).select('uid', 'teamId', 'attachments').limit(input.limit);
  if (input.afterPath) query = query.startAfter(db.doc(input.afterPath));
  const page = await query.get();
  for (const snapshot of page.docs) {
    let parent: Row | null | undefined;
    if (source === 'versions' && /^sessions\/[^/]+\/versions\/[^/]+$/.test(snapshot.ref.path)) {
      const [found] = await db.getAll(snapshot.ref.parent.parent!, { fieldMask: ['uid', 'teamId'] }); parent = found.exists ? found.data()! : null;
    }
    collector.observe({ source, path: snapshot.ref.path, data: snapshot.data(), parent });
  }
  return { scanned: page.size, nextAfterPath: page.empty ? null : page.docs[page.size - 1].ref.path, exhausted: page.size < input.limit };
}
