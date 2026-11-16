/**
 * Shared file-type helpers for import/upload.
 * Windows often sends an empty MIME, or maps `.ts` to `video/mp2t`.
 * Storage rules and extractors must trust the extension in those cases.
 */

export const TEXT_LIKE_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'log', 'html', 'htm', 'xml', 'yaml', 'yml',
  'py', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'rs', 'go', 'c', 'cpp', 'h', 'hpp',
  'java', 'kt', 'swift', 'sh', 'bat', 'ps1', 'sql', 'css', 'scss', 'ini', 'toml',
  'conf', 'env', 'jsonld', 'mdx', 'vue', 'svelte',
]);

export const OFFICE_DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'odt', 'ods', 'odp', 'rtf', 'pages', 'key', 'numbers',
]);

export const IMAGE_EXTENSIONS = new Set([
  'apng', 'avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp',
]);

export const AUDIO_EXTENSIONS = new Set([
  'aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'webm',
]);

export const VIDEO_EXTENSIONS = new Set([
  'avi', 'm4v', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'webm', 'mkv',
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  // Prefer text/plain for Storage: universally matches text/.* and avoids odd clients.
  md: 'text/plain',
  markdown: 'text/plain',
  mdx: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  jsonld: 'application/ld+json',
  log: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  py: 'text/x-python',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  rs: 'text/plain',
  go: 'text/plain',
  c: 'text/plain',
  cpp: 'text/plain',
  h: 'text/plain',
  hpp: 'text/plain',
  java: 'text/plain',
  kt: 'text/plain',
  swift: 'text/plain',
  sh: 'text/plain',
  bat: 'text/plain',
  ps1: 'text/plain',
  sql: 'text/plain',
  css: 'text/css',
  scss: 'text/x-scss',
  ini: 'text/plain',
  toml: 'text/plain',
  conf: 'text/plain',
  env: 'text/plain',
  vue: 'text/plain',
  svelte: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
};

/** File picker `accept` for Universo import + attachment documents. */
export const DOCUMENT_FILE_ACCEPT = [
  '.pdf', '.txt', '.md', '.markdown', '.csv', '.json', '.doc', '.docx',
  '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.rs', '.go', '.java', '.html',
  '.xml', '.yaml', '.yml', '.css', '.sql', '.log',
  'text/*', 'application/pdf', 'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/*', 'audio/*', 'video/*',
].join(',');

export const DOCUMENT_FILE_ACCEPT_NO_MEDIA = [
  '.pdf', '.txt', '.md', '.markdown', '.csv', '.json', '.doc', '.docx',
  '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.rs', '.go', '.java', '.html',
  '.xml', '.yaml', '.yml', '.css', '.sql', '.log',
  'text/*', 'application/pdf', 'application/json',
].join(',');

export function fileExtension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

export function isTextLikeExtension(extension: string): boolean {
  return TEXT_LIKE_EXTENSIONS.has(extension.toLowerCase());
}

export function mimeFromExtension(extension: string): string | null {
  return MIME_BY_EXTENSION[extension.toLowerCase()] || null;
}

/**
 * MIME to send to Firebase Storage. Never return an empty string:
 * empty `File.type` is rejected by storage.rules (does not match image/*, text/*, etc.).
 * `.ts` on Windows is often `video/mp2t` — override to text.
 */
export function inferUploadContentType(file: File): string {
  const extension = fileExtension(file.name);
  const reported = (file.type || '').trim().toLowerCase();

  if (isTextLikeExtension(extension)) {
    return mimeFromExtension(extension) || 'text/plain';
  }

  if (reported && reported !== 'application/octet-stream' && reported !== 'video/mp2t') {
    return file.type;
  }

  return mimeFromExtension(extension) || 'application/octet-stream';
}

export type UploadKind = 'image' | 'audio' | 'video' | 'document' | 'blob';

export function uploadKindForFile(file: File): UploadKind {
  const extension = fileExtension(file.name);
  const contentType = inferUploadContentType(file).toLowerCase();

  if (isTextLikeExtension(extension) || OFFICE_DOCUMENT_EXTENSIONS.has(extension)) {
    return 'document';
  }
  if (contentType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (contentType.startsWith('audio/') || AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (contentType.startsWith('video/') || VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (contentType === 'application/octet-stream') return 'blob';
  return 'document';
}

/** Bytes, matching `storage.rules` `isValidSize` after this fix. */
export const STORAGE_LIMITS_BYTES = {
  image: 25 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  document: 25 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  blob: 200 * 1024 * 1024,
} as const;

export function maxUploadBytesForFile(file: File): number {
  const kind = uploadKindForFile(file);
  return STORAGE_LIMITS_BYTES[kind];
}

export function sanitizeStorageFileName(name: string): string {
  const extension = fileExtension(name);
  const lastDot = name.lastIndexOf('.');
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 120) || 'file';
  return extension ? `${safeBase}.${extension}` : safeBase;
}

export function fileMatchesAllowedTypes(file: File, allowedTypes: string[]): boolean {
  const contentType = inferUploadContentType(file).toLowerCase();
  const extension = fileExtension(file.name);

  return allowedTypes.some((type) => {
    const normalized = type.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.startsWith('.')) {
      return `.${extension}` === normalized;
    }
    if (normalized.endsWith('/*')) {
      return contentType.startsWith(normalized.slice(0, -1));
    }
    return contentType === normalized;
  });
}
