import { readDir, readFile } from '@tauri-apps/plugin-fs';

export const isTauriRuntime = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as Window & { __TAURI_INTERNALS__?: unknown });
};

const ignoredPatterns = [
  /[\\/]\.obsidian[\\/]/,
  /[\\/]\.trash[\\/]/,
  /[\\/]\.git[\\/]/,
  /[\\/]\.vscode[\\/]/,
  /[\\/]node_modules[\\/]/,
  /[\\/]\.next[\\/]/,
  /[\\/]dist[\\/]/,
  /[\\/]build[\\/]/,
  /\.DS_Store$/i,
  /thumbs\.db$/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
];

const getMimeType = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext) return 'application/octet-stream';
  
  const mimes: Record<string, string> = {
    'txt': 'text/plain',
    'md': 'text/markdown',
    'markdown': 'text/markdown',
    'csv': 'text/csv',
    'json': 'application/json',
    'log': 'text/plain',
    'html': 'text/html',
    'htm': 'text/html',
    'xml': 'application/xml',
    'yaml': 'text/yaml',
    'yml': 'text/yaml',
    'pdf': 'application/pdf',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };
  
  return mimes[ext] || 'application/octet-stream';
};

function isIgnoredPath(path: string, fileName: string): boolean {
  const isIgnored = ignoredPatterns.some((pattern) => pattern.test(path));
  const isDotFile = fileName.startsWith('.');
  return isIgnored || isDotFile;
}

/**
 * Recursively reads a directory path and returns File objects compatible with learnDocumentBatch
 */
export const selectAndReadTauriDirectory = async (selectedPath: string,assertCurrent:()=>void=()=>{}): Promise<File[]> => {
  assertCurrent();
  const filesList: File[] = [];

  // Normalize separator
  const baseDir = selectedPath.replace(/\\/g, '/');
  // Get root folder name
  const rootFolderName = baseDir.split('/').pop() || 'imported-folder';
  
  // Helper for recursion
  const recurse = async (currentPath: string) => {
    assertCurrent();
    const entries = await readDir(currentPath);
    assertCurrent();
    for (const entry of entries) {
      assertCurrent();
      const fullPath = `${currentPath}/${entry.name}`;
      const relativePath = fullPath.substring(baseDir.length + 1).replace(/\\/g, '/');
      const virtualRelativePath = `${rootFolderName}/${relativePath}`;

      if (isIgnoredPath(virtualRelativePath, entry.name)) {
        continue;
      }

      if (entry.isDirectory) {
        await recurse(fullPath);
      } else if (entry.isFile) {
        try {
          const content = await readFile(fullPath);
          assertCurrent();
          const mimeType = getMimeType(entry.name);
          const file = new File([content], entry.name, { type: mimeType });
          
          Object.defineProperty(file, 'webkitRelativePath', {
            value: virtualRelativePath,
            writable: true,
            configurable: true,
            enumerable: true
          });
          
          filesList.push(file);
        } catch {
          assertCurrent();
          throw new Error('Não foi possível ler um ficheiro da pasta selecionada.');
        }
      }
    }
  };

  await recurse(baseDir);
  assertCurrent();
  return filesList;
};
