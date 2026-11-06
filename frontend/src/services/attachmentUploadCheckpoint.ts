import { attachmentActorIdValid, attachmentIdValid, decodeAttachmentHeader, encodeAttachmentHeader, parseAttachmentHeader, type AttachmentEnvelopeHeader } from '../../../functions/src/attachmentEnvelope';
import { auth } from '../firebase';
import { decryptMemoryEnvelope, encryptMemoryFields, isEncryptedMemoryEnvelope, isMemoryCryptoReady, type EncryptedMemoryEnvelope } from './memoryCrypto';
import { attachmentUploadJournalStore, type AttachmentUploadJournalStore, type StoredAttachmentUpload } from './attachmentUploadJournalStore';
export class AttachmentUploadCheckpointError extends Error { constructor() { super('Não foi possível recuperar o anexo cifrado.'); } }
export interface AttachmentUploadCheckpoint { v: 1; uid: string; header: AttachmentEnvelopeHeader; name: string; phase: 'pending' | 'posting' | 'ready'; bytesDigest: string }
export interface AttachmentUploadCheckpointDeps {
  journal: AttachmentUploadJournalStore;
  encryptJournal: (fields: { text: string }) => Promise<EncryptedMemoryEnvelope>;
  decryptJournal: (envelope: EncryptedMemoryEnvelope) => Promise<{ text: string }>;
  exclusive: <T>(name: string, work: () => Promise<T>) => Promise<T>;
}
export const uploadCheckpointDefaults = (): AttachmentUploadCheckpointDeps => ({ journal: attachmentUploadJournalStore,
  encryptJournal: encryptMemoryFields, decryptJournal: decryptMemoryEnvelope,
  exclusive: async (name, work) => {
    if (!navigator.locks) throw new AttachmentUploadCheckpointError();
    return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, lock => { if (!lock) throw new AttachmentUploadCheckpointError(); return work(); });
  } });
export const uploadCheckpointLock = (uid: string, id: string) => `mnemosyne:attachment-upload:v1:${uid}:${id}`;
const event = 'mnemosyne:attachment-uploads-changed';
export const notifyAttachmentUploadCheckpoints = () => window.dispatchEvent(new Event(event));
export function observeAttachmentUploadCheckpoints(callback: () => void) {
  window.addEventListener(event, callback); return () => window.removeEventListener(event, callback);
}
export async function attachmentBytesDigest(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
function parseCheckpoint(input: unknown, uid: string, id: string): AttachmentUploadCheckpoint {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AttachmentUploadCheckpointError();
  const value = input as AttachmentUploadCheckpoint;
  if (Object.keys(value).sort().join(',') !== 'bytesDigest,header,name,phase,uid,v' || value.v !== 1 || value.uid !== uid ||
      !['pending', 'posting', 'ready'].includes(value.phase) || typeof value.name !== 'string' || new TextEncoder().encode(value.name).length > 4096 ||
      !/^[a-f0-9]{64}$/.test(value.bytesDigest)) throw new AttachmentUploadCheckpointError();
  const header = parseAttachmentHeader(value.header); if (header.uid !== uid || header.id !== id) throw new AttachmentUploadCheckpointError();
  return { ...value, header };
}
export async function readUploadCheckpoint(uid: string, id: string, deps: AttachmentUploadCheckpointDeps, guard: () => void) {
  guard(); if (!attachmentActorIdValid(uid) || !attachmentIdValid(id)) throw new AttachmentUploadCheckpointError();
  const stored = await deps.journal.get(uid, id); guard();
  if (!stored || Object.keys(stored).sort().join(',') !== 'bytes,envelope' || !isEncryptedMemoryEnvelope(stored.envelope) || stored.envelope.ct.length > 32768) throw new AttachmentUploadCheckpointError();
  const text = (await deps.decryptJournal(stored.envelope)).text; guard(); if (text.length > 16384) throw new AttachmentUploadCheckpointError();
  const checkpoint = parseCheckpoint(JSON.parse(text), uid, id);
  if (checkpoint.phase === 'ready' ? stored.bytes !== null : !(stored.bytes instanceof ArrayBuffer) || stored.bytes.byteLength !== encodeAttachmentHeader(checkpoint.header).length + checkpoint.header.cipherBytes) throw new AttachmentUploadCheckpointError();
  return { checkpoint, stored };
}
export async function validateCheckpointBytes(checkpoint: AttachmentUploadCheckpoint, bytes: ArrayBuffer, guard: () => void) {
  const view = new Uint8Array(bytes); const decoded = decodeAttachmentHeader(view, view.length);
  if (JSON.stringify(decoded.header) !== JSON.stringify(checkpoint.header) || await attachmentBytesDigest(view) !== checkpoint.bytesDigest) throw new AttachmentUploadCheckpointError(); guard();
  return view;
}
export async function saveUploadCheckpoint(checkpoint: AttachmentUploadCheckpoint, bytes: ArrayBuffer | null,
  deps: AttachmentUploadCheckpointDeps, guard: () => void) {
  const value = parseCheckpoint(checkpoint, checkpoint.uid, checkpoint.header.id);
  if (value.phase === 'ready' ? bytes !== null : !(bytes instanceof ArrayBuffer)) throw new AttachmentUploadCheckpointError();
  const envelope = await deps.encryptJournal({ text: JSON.stringify(value) }); guard();
  if (!isEncryptedMemoryEnvelope(envelope)) throw new AttachmentUploadCheckpointError();
  const stored: StoredAttachmentUpload = { envelope, bytes };
  await deps.journal.put(value.uid, value.header.id, stored); guard();
  const confirmed = await deps.journal.get(value.uid, value.header.id); guard();
  if (!confirmed || JSON.stringify(confirmed.envelope) !== JSON.stringify(envelope) || confirmed.bytes?.byteLength !== bytes?.byteLength) throw new AttachmentUploadCheckpointError();
  notifyAttachmentUploadCheckpoints(); return stored;
}
/** Removes only locally owned upload checkpoints after the caller has a confirmed association receipt. */
export async function forgetAssociatedUploadCheckpoints(uid: string, ids: string[], guard: () => void, deps = uploadCheckpointDefaults()) {
  for (const id of ids) {
    guard(); if (auth.currentUser?.uid !== uid || !isMemoryCryptoReady() || !attachmentIdValid(id)) throw new AttachmentUploadCheckpointError();
    await deps.exclusive(uploadCheckpointLock(uid, id), async () => { guard(); await deps.journal.remove(uid, id); guard(); notifyAttachmentUploadCheckpoints(); });
  }
}
