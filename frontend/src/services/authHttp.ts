/**
 * Headers autenticados para chamar Cloud Functions HTTP / Hosting rewrites.
 */

import { auth } from '../firebase';
export class AuthHttpError extends Error {
  constructor() { super('A sessão autenticada está indisponível. Volta a iniciar sessão e repete a operação.'); }
}

export async function getAuthJsonHeaders(expectedUid?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const user = auth.currentUser;
  if (!user || (expectedUid !== undefined && user.uid !== expectedUid)) throw new AuthHttpError();
  try {
    const token = await user.getIdToken();
    if (auth.currentUser?.uid !== user.uid || typeof token !== 'string' || !token || /\s/.test(token)) throw new AuthHttpError();
    headers.Authorization = `Bearer ${token}`;
  } catch {
    throw new AuthHttpError();
  }
  return headers;
}
