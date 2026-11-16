import {attachmentActorIdValid} from './attachmentEnvelope';

/** An email lookup is authority only for the exact, verified address on the Auth record. */
export function verifiedAuthEmail(value: unknown, normalizedAddress: string): value is {uid: string; email: string; emailVerified: true; disabled?: false} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const user = value as Record<string, unknown>;
  return attachmentActorIdValid(user.uid) && (user.disabled === undefined || user.disabled === false) && user.emailVerified === true &&
    typeof user.email === 'string' && user.email.trim().toLowerCase() === normalizedAddress;
}
