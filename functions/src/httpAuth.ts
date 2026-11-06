/**
 * Auth helpers for HTTP Cloud Functions.
 */

import * as admin from 'firebase-admin';

export interface VerifiedCaller {
  uid: string;
  token: string;
}

type AuthRequest = {
  headers?: Record<string, unknown>;
};

/**
 * Requires Authorization: Bearer <Firebase ID token>.
 * Returns null when missing/invalid.
 */
export async function verifyBearerIdToken(req: AuthRequest): Promise<VerifiedCaller | null> {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;

  try {
    const decoded = await admin.auth().verifyIdToken(match[1], true);
    if (!decoded.uid) return null;
    return { uid: decoded.uid, token: match[1] };
  } catch {
    console.warn('verifyBearerIdToken failed');
    return null;
  }
}
