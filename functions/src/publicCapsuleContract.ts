/** Public transport contains ciphertext and bounded presentation metadata only. */
export const PUBLIC_CAPSULE_VIEW_WINDOW_MS = 10 * 60_000;
export const PUBLIC_CAPSULE_MAX_CIPHER_CHARS = 1_000_000;
export const publicCapsuleIdValid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
export const publicCapsuleHashValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const publicCapsuleTimeValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 253402300799000;
export const publicCapsuleCountValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const bad = () => new Error('Invalid public capsule');
export function publicCapsuleRecord(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw bad();
  return value as Record<string, unknown>;
}
export interface PublicCapsuleCipher { v: 1; alg: 'AES-GCM-PBKDF2'; salt: string; iv: string; data: string }
export function capturePublicCapsuleCipher(value: unknown): PublicCapsuleCipher {
  const data = publicCapsuleRecord(value, ['v', 'alg', 'salt', 'iv', 'data']);
  const base64 = (value: unknown, size?: number): value is string => {
    if (typeof value !== 'string' || value.length < 4 || value.length > PUBLIC_CAPSULE_MAX_CIPHER_CHARS || value.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
    const decoded = value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
    return size === undefined ? decoded >= 16 : decoded === size;
  };
  if (data.v !== 1 || data.alg !== 'AES-GCM-PBKDF2' || !base64(data.salt, 16) || !base64(data.iv, 12) || !base64(data.data)) throw bad();
  return Object.freeze({ v: 1, alg: 'AES-GCM-PBKDF2', salt: data.salt, iv: data.iv, data: data.data });
}
export interface PublicCapsuleSource {
  v: 1; shareId: string; generation: string; ciphertext: PublicCapsuleCipher;
  createdAt: number | null; expiresAt: number | null; views: number | null; viewDeadline: number; sourceDigest: string;
}
export function capturePublicCapsule(value: unknown): PublicCapsuleSource {
  const data = publicCapsuleRecord(value, ['v', 'shareId', 'generation', 'ciphertext', 'createdAt', 'expiresAt', 'views', 'viewDeadline', 'sourceDigest']);
  if (data.v !== 1 || !publicCapsuleIdValid(data.shareId) || !publicCapsuleHashValid(data.generation) || !publicCapsuleHashValid(data.sourceDigest) ||
    data.createdAt !== null && !publicCapsuleTimeValid(data.createdAt) || data.expiresAt !== null && !publicCapsuleTimeValid(data.expiresAt) ||
    data.views !== null && !publicCapsuleCountValid(data.views) || !publicCapsuleTimeValid(data.viewDeadline)) throw bad();
  return Object.freeze({ v: 1, shareId: data.shareId, generation: data.generation, ciphertext: capturePublicCapsuleCipher(data.ciphertext),
    createdAt: data.createdAt as number | null, expiresAt: data.expiresAt as number | null, views: data.views as number | null,
    viewDeadline: data.viewDeadline, sourceDigest: data.sourceDigest });
}
export function publicCapsuleSourceBytes(value: PublicCapsuleSource): string {
  const row = capturePublicCapsule(value), cipher = row.ciphertext;
  return JSON.stringify(['mnemosyne-public-capsule-v1', row.shareId, row.generation, cipher.v, cipher.alg, cipher.salt, cipher.iv, cipher.data, row.createdAt, row.expiresAt]);
}
export interface PublicCapsuleOpening { v: 1; shareId: string; openingId: string; sourceDigest: string; viewDeadline: number }
export function capturePublicCapsuleOpening(value: unknown): PublicCapsuleOpening {
  const data = publicCapsuleRecord(value, ['v', 'shareId', 'openingId', 'sourceDigest', 'viewDeadline']);
  if (data.v !== 1 || !publicCapsuleIdValid(data.shareId) || typeof data.openingId !== 'string' || !/^[A-Za-z0-9_-]{24,64}$/.test(data.openingId) ||
    !publicCapsuleHashValid(data.sourceDigest) || !publicCapsuleTimeValid(data.viewDeadline)) throw bad();
  return Object.freeze({ v: 1, shareId: data.shareId, openingId: data.openingId, sourceDigest: data.sourceDigest, viewDeadline: data.viewDeadline });
}
