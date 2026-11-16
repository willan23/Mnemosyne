import {attachmentActorIdValid} from './attachmentEnvelope';

export interface CommsIdentityPublicationCommand {v: 1; actorUid: string; publicKeyPem: string; mode: 'check' | 'publish'}
export interface CommsIdentityPublicationOutcome {v: 1; uid: string; fingerprint: string; status: 'current' | 'unpublished'; changed: boolean}
function exact(value: unknown, keys: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys) throw Error('Invalid identity publication');
}
export function parseCommsIdentityPublication(value: unknown): CommsIdentityPublicationCommand {
  exact(value, 'actorUid,mode,publicKeyPem,v');
  if (value.v !== 1 || !attachmentActorIdValid(value.actorUid) || typeof value.mode !== 'string' || !['check', 'publish'].includes(value.mode) || typeof value.publicKeyPem !== 'string' || value.publicKeyPem.length > 2000 ||
    !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/]+={0,2}\n-----END PUBLIC KEY-----$/.test(value.publicKeyPem)) throw Error('Invalid identity publication');
  return {v: 1, actorUid: value.actorUid as string, mode: value.mode as 'check' | 'publish', publicKeyPem: value.publicKeyPem};
}
export function parseCommsIdentityPublicationOutcome(value: unknown, uid: string, fingerprint: string): CommsIdentityPublicationOutcome {
  exact(value, 'changed,fingerprint,status,uid,v');
  if (value.v !== 1 || value.uid !== uid || value.fingerprint !== fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint) || typeof value.status !== 'string' || !['current', 'unpublished'].includes(value.status) ||
    typeof value.changed !== 'boolean' || value.status === 'unpublished' && value.changed) throw Error('Invalid identity publication confirmation');
  return {v: 1, uid, fingerprint, status: value.status as 'current' | 'unpublished', changed: value.changed};
}
