import { addDoc, arrayUnion, collection, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { cognitiveEngine } from '../engines/CognitiveEngine';
import type { SessionData } from '../hooks/useSessions';
import type { CelestialType, MemoryObject } from '../types/universe';
import type { Attachment, AttachmentType } from '../types/attachments';
import type { GeneratedImageResult } from './aiGenerationService';
import { buildDocumentDigest, type DocumentDigest } from './documentSummary';
import { analyzeMediaFile, isAnalyzableMediaFile, mediaAnalysisToText, mediaKindForFile } from './mediaAnalysisService';
import { uploadFile } from '../utils/storage';

const MAX_DOCUMENT_BATCH_SIZE = 20;
const MAX_TEXT_EXTRACT_CHARS = 120_000;

type LearningSource =
  | 'manual'
  | 'text-generation'
  | 'image-generation'
  | 'video-generation'
  | 'document-batch'
  | 'document-upload'
  | 'capsule-import';

interface PersistLearningInput {
  uid: string;
  text: string;
  title?: string | null;
  tags?: string[];
  category?: string | null;
  attachments?: Attachment[];
  existingMemories?: SessionData[];
  source: LearningSource;
  modality: 'text' | 'image' | 'audio' | 'video' | 'document' | 'mixed';
  prompt?: string | null;
  provider?: string | null;
  model?: string | null;
  batchId?: string | null;
  connections?: string[];
  celestialType?: CelestialType | null;
  parentId?: string | null;
  position?: [number, number, number] | null;
}

interface LearnedMemoryResult {
  id: string;
  processingMethod: string;
}



const unique = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));

const extensionOf = (name: string): string => {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
};

const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const decodeXmlEntities = (value: string): string => {
  if (typeof document === 'undefined') {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
};

const xmlToText = (xml: string): string => decodeXmlEntities(xml
  .replace(/<\?xml[^>]*>/gi, ' ')
  .replace(/<[^>]+\/>/g, ' ')
  .replace(/<\/(?:w:p|a:p|p|row|c)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+\n/g, '\n')
  .replace(/\n\s+/g, '\n')
  .replace(/[ \t]{2,}/g, ' ')
  .trim());

const extractZipXmlText = async (file: File, includePatterns: RegExp[]): Promise<string> => {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const chunks: string[] = [];
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && includePatterns.some((pattern) => pattern.test(entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (const entry of entries) {
    const xml = await entry.async('string');
    const text = xmlToText(xml);
    if (text) chunks.push(text);
    if (chunks.join('\n').length >= MAX_TEXT_EXTRACT_CHARS) break;
  }

  return chunks.join('\n\n').slice(0, MAX_TEXT_EXTRACT_CHARS);
};

const extractPdfText = async (file: File): Promise<string> => {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const chunks: string[] = [];
  const maxPages = Math.min(pdf.numPages, 80);

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) chunks.push(`Página ${pageNumber}: ${text}`);
    if (chunks.join('\n').length >= MAX_TEXT_EXTRACT_CHARS) break;
  }

  return chunks.join('\n\n').slice(0, MAX_TEXT_EXTRACT_CHARS);
};

const sessionToMemoryObject = (session: SessionData): MemoryObject => ({
  id: session.id,
  text: session.text || '',
  title: session.title,
  celestialType: (session.celestialType || 'planet') as CelestialType,
  position: session.position || [0, 0, 0],
  embedding: session.embedding || [],
  connections: session.connections || [],
  semanticClusterId: session.semanticClusterId,
  importance: session.importance || 0.5,
  timestamp: session.timestamp || 0,
  updatedAt: session.updatedAt || session.timestamp || 0,
  uid: session.uid,
  tags: session.tags,
  category: session.category,
});

const buildExistingMemoryObjects = (sessions: SessionData[] = [], excludeId?: string): MemoryObject[] =>
  sessions
    .filter((session) => !session.deletedAt && session.id !== excludeId)
    .map(sessionToMemoryObject);

const extractReadableText = async (file: File): Promise<{ text: string; method: string }> => {
  const extension = extensionOf(file.name);
  const textLikeExtensions = new Set([
    'txt', 'md', 'markdown', 'csv', 'json', 'log', 'html', 'htm', 'xml', 'yaml', 'yml',
    'py', 'js', 'jsx', 'ts', 'tsx', 'rs', 'go', 'c', 'cpp', 'h', 'hpp', 'java', 'kt',
    'swift', 'sh', 'bat', 'ps1', 'sql', 'css', 'scss', 'ini', 'toml', 'conf', 'env',
    'jsonld', 'mdx'
  ]);
  const textLikeMime = file.type.startsWith('text/') || ['application/json', 'application/xml'].includes(file.type);
  try {
    if (isAnalyzableMediaFile(file)) {
      const analysis = await analyzeMediaFile(file);
      return {
        text: mediaAnalysisToText(file.name, analysis).slice(0, MAX_TEXT_EXTRACT_CHARS),
        method: analysis.method,
      };
    }
    if (textLikeMime || textLikeExtensions.has(extension)) {
      const text = await file.text();
      return { text: text.slice(0, MAX_TEXT_EXTRACT_CHARS), method: 'texto local' };
    }
    if (extension === 'pdf' || file.type === 'application/pdf') {
      return { text: await extractPdfText(file), method: 'PDF local' };
    }
    if (extension === 'docx') {
      return {
        text: await extractZipXmlText(file, [/^word\/document\.xml$/i, /^word\/header\d*\.xml$/i, /^word\/footer\d*\.xml$/i]),
        method: 'DOCX local',
      };
    }
    if (extension === 'pptx') {
      return { text: await extractZipXmlText(file, [/^ppt\/slides\/slide\d+\.xml$/i]), method: 'PPTX local' };
    }
    if (extension === 'xlsx') {
      return {
        text: await extractZipXmlText(file, [/^xl\/sharedStrings\.xml$/i, /^xl\/worksheets\/sheet\d+\.xml$/i]),
        method: 'XLSX local',
      };
    }
  } catch (error) {
    console.warn(`Unable to extract text from ${file.name}:`, error);
    return { text: '', method: 'falha na extração local' };
  }
  return { text: '', method: 'metadados e anexo' };
};

const attachmentTypeForFile = (file: File): AttachmentType => {
  const mediaKind = mediaKindForFile(file);
  if (mediaKind === 'image') return 'image';
  if (mediaKind === 'audio') return 'audio';
  if (mediaKind === 'video') return 'video';
  return 'document';
};

const categorizeDocument = (file: File, text: string): string => {
  const haystack = `${file.name}\n${text.slice(0, 5000)}`.toLowerCase();
  if (/\b(contrato|jur[ií]dico|legal|lei|cl[aá]usula|termos)\b/.test(haystack)) return 'Jurídico';
  if (/\b(fatura|invoice|pagamento|receita|despesa|or[cç]amento|financeiro)\b/.test(haystack)) return 'Finanças';
  if (/\b(roadmap|produto|feature|release|bug|cliente|mercado)\b/.test(haystack)) return 'Produto';
  if (/\b(paper|estudo|pesquisa|research|refer[eê]ncia|bibliografia)\b/.test(haystack)) return 'Pesquisa';
  if (/\b(reuni[aã]o|ata|meeting|agenda|decis[oõ]es)\b/.test(haystack)) return 'Reuniões';
  if (file.type.startsWith('video/')) return 'Vídeo';
  if (file.type.startsWith('image/')) return 'Imagem';
  return 'Documentos';
};

const summarizeDocument = (
  file: File,
  category: string,
  extractionMethod: string,
  digest: DocumentDigest,
): string => {
  const extension = extensionOf(file.name) || 'sem-extensao';
  const readable = digest.readable;
  const keyPoints = digest.keyPoints.map((point) => `- ${point}`).join('\n');
  const topics = digest.topics.length > 0 ? digest.topics.join(', ') : category;

  return [
    `[Documento aprendido: ${file.name}]`,
    '',
    `Categoria: ${category}`,
    `Tipo: ${file.type || extension}`,
    `Tamanho: ${formatBytes(file.size)}`,
    `Extração: ${readable ? extractionMethod : 'metadados e anexo'}`,
    '',
    '## Resumo',
    digest.overview,
    '',
    '## Pontos principais',
    keyPoints,
    '',
    '## Temas detectados',
    topics,
    '',
    '## Excerto indexado',
    digest.excerpt,
  ].join('\n');
};

const fileFromDataUrl = async (dataUrl: string, filename: string): Promise<File> => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/png', lastModified: Date.now() });
};

export const persistLearnedMemory = async ({
  uid,
  text,
  title,
  tags = [],
  category = null,
  attachments = [],
  existingMemories = [],
  source,
  modality,
  prompt = null,
  provider = null,
  model = null,
  batchId = null,
  connections = [],
  celestialType = null,
  parentId = null,
  position = null,
}: PersistLearningInput): Promise<LearnedMemoryResult> => {
  const now = Date.now();
  let cognitive: Awaited<ReturnType<typeof cognitiveEngine.processMemory>> | null = null;
  let processingMethod = `learned:${source}`;

  try {
    cognitive = await cognitiveEngine.processMemory(text, buildExistingMemoryObjects(existingMemories));
    processingMethod = `${processingMethod}+local-embedding`;
  } catch (error) {
    console.warn('Learning memory saved without semantic enrichment:', error);
  }

  const semanticConnections = cognitive?.connections || [];
  const allConnections = unique([...connections, ...semanticConnections]);

  const memoryRef = await addDoc(collection(db, 'sessions'), {
    text,
    title: title || (cognitive ? cognitiveEngine.generateTitle(text) : null),
    timestamp: now,
    updatedAt: now,
    uid,
    tags: unique(['auto-learned', source, modality, ...tags]),
    category,
    attachments: attachments.length > 0 ? attachments : null,
    embedding: cognitive?.embedding || null,
    connections: allConnections,
    semanticClusterId: cognitive?.semanticClusterId || null,
    position: position || cognitive?.position || null,
    importance: cognitive?.importance || 0.55,
    celestialType: celestialType || cognitive?.celestialType || (modality === 'document' ? 'planet' : null),
    parentId: parentId || null,
    generatedPrompt: prompt,
    generatedProvider: provider,
    generatedModel: model,
    generatedImagePrompt: modality === 'image' ? prompt : null,
    generatedImageProvider: modality === 'image' ? provider : null,
    generatedImageModel: modality === 'image' ? model : null,
    learning: {
      schemaVersion: 1,
      source,
      modality,
      learnedAt: now,
      batchId,
      attachmentCount: attachments.length,
    },
    processingMethod,
  });

  if (allConnections.length) {
    await Promise.all(allConnections.map((memoryId) => (
      updateDoc(doc(db, 'sessions', memoryId), {
        connections: arrayUnion(memoryRef.id),
        updatedAt: now,
      }).catch((error) => console.warn('Unable to link learned memory', memoryId, error))
    )));
  }

  return { id: memoryRef.id, processingMethod };
};

export const reviseLearnedMemory = async (
  memoryId: string,
  uid: string,
  text: string,
  existingMemories: SessionData[] = [],
): Promise<void> => {
  const now = Date.now();
  let cognitive: Awaited<ReturnType<typeof cognitiveEngine.processMemory>> | null = null;
  try {
    cognitive = await cognitiveEngine.processMemory(text, buildExistingMemoryObjects(existingMemories, memoryId));
  } catch (error) {
    console.warn('Learned memory revised without semantic refresh:', error);
  }

  await updateDoc(doc(db, 'sessions', memoryId), {
    text,
    title: cognitive ? cognitiveEngine.generateTitle(text) : null,
    updatedAt: now,
    uid,
    embedding: cognitive?.embedding || null,
    connections: cognitive?.connections || [],
    semanticClusterId: cognitive?.semanticClusterId || null,
    position: cognitive?.position || null,
    importance: cognitive?.importance || 0.55,
    processingMethod: cognitive ? 'learned:revision+local-embedding' : 'learned:revision',
    'learning.revisedAt': now,
  });
};

export const learnGeneratedText = async (
  uid: string,
  prompt: string,
  output: string,
  existingMemories: SessionData[] = [],
): Promise<LearnedMemoryResult> => persistLearnedMemory({
  uid,
  text: [
    '[Texto gerado e aprendido]',
    '',
    `Pedido: ${prompt}`,
    '',
    output,
  ].join('\n'),
  tags: ['texto-gerado', 'geracao'],
  category: 'Gerações',
  existingMemories,
  source: 'text-generation',
  modality: 'text',
  prompt,
});

/** Importa texto de uma cápsula pública cifrada para o universo do utilizador. */
export const importCapsuleAsMemory = async (
  uid: string,
  payload: {
    text: string;
    titleHint?: string | null;
    shareId?: string | null;
    ownerUid?: string | null;
  },
  existingMemories: SessionData[] = [],
): Promise<LearnedMemoryResult & { importedCount: number; memoryIds: string[] }> => {
  const { decodeCapsulePack, isCapsulePackText, recordCapsuleImport } = await import('./capsuleService');

  const body = payload.text.trim();
  const memoryIds: string[] = [];
  let working = existingMemories;

  if (isCapsulePackText(body)) {
    const pack = decodeCapsulePack(body);
    if (!pack || pack.items.length === 0) {
      throw new Error('Pack de cápsula inválido ou vazio.');
    }
    for (const item of pack.items) {
      const title = item.title?.trim() || payload.titleHint?.trim() || null;
      const text = item.text.trim();
      if (!text) continue;
      const learned = await persistLearnedMemory({
        uid,
        text: title && !text.startsWith(title) ? `${title}\n\n${text}` : text,
        title,
        tags: unique([
          'capsula',
          'importada',
          'pack',
          ...(item.tags || []),
          payload.shareId ? `share:${payload.shareId.slice(0, 8)}` : null,
        ]),
        category: 'Cápsulas',
        existingMemories: working,
        source: 'capsule-import',
        modality: 'text',
      });
      memoryIds.push(learned.id);
      working = [
        ...working,
        {
          id: learned.id,
          text,
          title: title || undefined,
          timestamp: Date.now(),
          uid,
        } as SessionData,
      ];
    }
  } else {
    const title = payload.titleHint?.trim() || null;
    const text = title && !body.startsWith(title) ? `${title}\n\n${body}` : body;
    const learned = await persistLearnedMemory({
      uid,
      text,
      title,
      tags: unique([
        'capsula',
        'importada',
        payload.shareId ? `share:${payload.shareId.slice(0, 8)}` : null,
      ]),
      category: 'Cápsulas',
      existingMemories: working,
      source: 'capsule-import',
      modality: 'text',
    });
    memoryIds.push(learned.id);
  }

  if (memoryIds.length === 0) {
    throw new Error('Nada para importar na cápsula.');
  }

  if (payload.shareId) {
    await recordCapsuleImport({
      shareId: payload.shareId,
      ownerUid: payload.ownerUid,
      importerUid: uid,
      titleHint: payload.titleHint,
      itemCount: memoryIds.length,
    });
  }

  return {
    id: memoryIds[0],
    processingMethod: 'learned:capsule-import',
    importedCount: memoryIds.length,
    memoryIds,
  };
};

export const learnGeneratedImage = async (
  uid: string,
  prompt: string,
  image: GeneratedImageResult,
  existingMemories: SessionData[] = [],
): Promise<LearnedMemoryResult> => {
  const attachments: Attachment[] = [];
  if (image.dataUrl) {
    const file = await fileFromDataUrl(image.dataUrl, `mnemosyne-ai-${Date.now()}.png`);
    const url = await uploadFile(file, uid);
    attachments.push({
      type: 'image',
      url,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      source: 'generated',
    });
  } else if (image.imageUrl) {
    attachments.push({
      type: 'image',
      url: image.imageUrl,
      name: `mnemosyne-ai-${Date.now()}.png`,
      mimeType: image.mediaType,
      source: 'generated',
    });
  }

  return persistLearnedMemory({
    uid,
    text: [
      '[Imagem gerada e aprendida]',
      '',
      `Prompt: ${prompt}`,
      image.revisedPrompt ? `Prompt revisto: ${image.revisedPrompt}` : null,
      image.warning ? `Aviso: ${image.warning}` : null,
    ].filter(Boolean).join('\n'),
    tags: ['imagem-gerada', 'geracao'],
    category: 'Gerações',
    attachments,
    existingMemories,
    source: 'image-generation',
    modality: 'image',
    prompt,
    provider: image.provider,
    model: image.model || null,
  });
};

export const collectDroppedFiles = async (dataTransfer: DataTransfer): Promise<File[]> => {
  interface FileSystemEntryLike {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
  }
  interface FileSystemFileEntryLike extends FileSystemEntryLike {
    file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
  }
  interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
    createReader: () => {
      readEntries: (
        success: (entries: FileSystemEntryLike[]) => void,
        error?: (error: DOMException) => void,
      ) => void;
    };
  }

  const readDirectoryEntries = async (entry: FileSystemDirectoryEntryLike): Promise<FileSystemEntryLike[]> => {
    const reader = entry.createReader();
    const entries: FileSystemEntryLike[] = [];
    while (true) {
      const chunk = await new Promise<FileSystemEntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (chunk.length === 0) break;
      entries.push(...chunk);
    }
    return entries;
  };

  const readEntry = async (entry: FileSystemEntryLike): Promise<File[]> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (
        (entry as FileSystemFileEntryLike).file(resolve, reject)
      ));
      return [file];
    }
    if (entry.isDirectory) {
      const entries = await readDirectoryEntries(entry as FileSystemDirectoryEntryLike);
      const nested = await Promise.all(entries.map(readEntry));
      return nested.flat();
    }
    return [];
  };

  const files: File[] = [];
  const items = Array.from(dataTransfer.items || []);
  for (const item of items) {
    const entry = 'webkitGetAsEntry' in item
      ? (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry?.()
      : null;
    if (entry) {
      files.push(...await readEntry(entry));
    } else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  if (files.length > 0) return files;
  return Array.from(dataTransfer.files || []);
};

export const learnDocumentBatch = async (
  uid: string,
  files: File[],
  existingMemories: SessionData[] = [],
): Promise<{ batchId: string; imported: number; hubId: string }> => {
  if (files.length === 0) throw new Error('Nenhum ficheiro encontrado.');
  if (files.length > MAX_DOCUMENT_BATCH_SIZE) {
    throw new Error(`Importa no máximo ${MAX_DOCUMENT_BATCH_SIZE} documentos por lote.`);
  }

  const batchId = `batch-${Date.now()}`;

  interface ProcessedFile {
    file: File;
    normalizedPath: string;
    dirPath: string;
    fileName: string;
    category: string;
    attachmentType: AttachmentType;
    digest: DocumentDigest;
    attachment: Attachment;
    summarizedText: string;
    readable: boolean;
    extractionMethod: string;
  }

  const processedFiles: ProcessedFile[] = [];

  for (const file of files) {
    const { text: extractedText, method: extractionMethod } = await extractReadableText(file);
    const category = categorizeDocument(file, extractedText);
    const attachmentType = attachmentTypeForFile(file);
    const digest = buildDocumentDigest(extractedText, { fileName: file.name, category });
    const url = await uploadFile(file, uid);
    const attachment: Attachment = {
      type: attachmentType,
      url,
      name: file.name,
      size: file.size,
      mimeType: file.type || undefined,
      source: 'document-batch',
    };
    const summarizedText = summarizeDocument(file, category, extractionMethod, digest);

    const normalizedPath = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    const pathParts = normalizedPath.split('/');
    const fileName = pathParts.pop() || file.name;
    const dirPath = pathParts.join('/');

    processedFiles.push({
      file,
      normalizedPath,
      dirPath,
      fileName,
      category,
      attachmentType,
      digest,
      attachment,
      summarizedText,
      readable: Boolean(extractedText.trim()),
      extractionMethod,
    });
  }

  // Identificar diretórios únicos e ancestrais
  const dirPaths = new Set<string>();
  for (const pf of processedFiles) {
    if (pf.dirPath) {
      const parts = pf.dirPath.split('/');
      let currentPath = '';
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        dirPaths.add(currentPath);
      }
    }
  }

  // Ordenar pastas por profundidade para garantir que os pais sejam criados primeiro
  const sortedDirs = Array.from(dirPaths).sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  });

  const dirNodeMap = new Map<string, { id: string; position: [number, number, number] }>();
  const existingSuns = existingMemories.filter((m) => m.celestialType === 'sun' && !m.deletedAt);
  const sunPositions = existingSuns.map((s) => s.position || [0, 0, 0]) as [number, number, number][];

  // Helper para espalhar os Sóis no espaço tridimensional profundo
  const getSpacedSunPosition = (positionsList: [number, number, number][]): [number, number, number] => {
    if (positionsList.length === 0) return [0, 0, 0];
    let bestPos: [number, number, number] = [0, 0, 0];
    let maxMinDist = -1;
    for (let attempts = 0; attempts < 100; attempts++) {
      const radius = 50 + Math.random() * 60 + positionsList.length * 12;
      const angle = Math.random() * Math.PI * 2;
      const elevation = (Math.random() - 0.5) * (Math.PI * 0.4);
      const testPos: [number, number, number] = [
        radius * Math.cos(elevation) * Math.cos(angle),
        radius * Math.sin(elevation),
        radius * Math.cos(elevation) * Math.sin(angle)
      ];

      let minDist = Infinity;
      for (const sPos of positionsList) {
        const dist = Math.sqrt(
          (testPos[0] - sPos[0]) ** 2 +
          (testPos[1] - sPos[1]) ** 2 +
          (testPos[2] - sPos[2]) ** 2
        );
        if (dist < minDist) minDist = dist;
      }

      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        bestPos = testPos;
      }
      if (minDist >= 55) {
        bestPos = testPos;
        break;
      }
    }
    return bestPos;
  };

  let defaultHubId = '';

  if (sortedDirs.length === 0) {
    // Processamento de lote sem estrutura de pastas (flat)
    const sunPos = getSpacedSunPosition(sunPositions);
    sunPositions.push(sunPos);

    const categoryMap = new Map<string, ProcessedFile[]>();
    for (const pf of processedFiles) {
      categoryMap.set(pf.category, [...(categoryMap.get(pf.category) || []), pf]);
    }
    const categoryLines = Array.from(categoryMap.entries()).map(([category, pfs]) => (
      `## ${category}\n${pfs.map((pf) => {
        const overview = pf.digest.overview.length > 220
          ? `${pf.digest.overview.slice(0, 217).trim()}...`
          : pf.digest.overview;
        return `- ${pf.fileName} (${formatBytes(pf.file.size)}${pf.readable ? `, ${pf.extractionMethod}` : ', anexo indexado'}): ${overview}`;
      }).join('\n')}`
    ));

    const hubText = [
      `[Sistema solar documental: ${files.length} ficheiro${files.length === 1 ? '' : 's'}]`,
      '',
      `Lote: ${batchId}`,
      `Importado em: ${new Date().toLocaleString('pt-PT')}`,
      '',
      ...categoryLines,
    ].join('\n');

    const hub = await persistLearnedMemory({
      uid,
      text: hubText,
      title: `Lote documental (${files.length})`,
      tags: ['document-batch', 'documentos', `lote:${batchId}`],
      category: 'Documentos',
      attachments: processedFiles.map((pf) => pf.attachment),
      existingMemories,
      source: 'document-batch',
      modality: 'mixed',
      batchId,
      celestialType: 'sun',
      position: sunPos,
    });
    defaultHubId = hub.id;
  } else {
    // Processamento estruturado por pastas: criar um Sol para cada pasta/subpasta
    for (const dirPath of sortedDirs) {
      const parts = dirPath.split('/');
      const dirName = parts[parts.length - 1];
      const parentDirPath = parts.slice(0, -1).join('/');

      const parentNode = parentDirPath ? dirNodeMap.get(parentDirPath) : null;
      const parentSunId = parentNode ? parentNode.id : null;
      const parentSunPosition = parentNode ? parentNode.position : null;

      let sunPosition: [number, number, number];
      if (parentSunPosition) {
        // Subpastas orbitam perto de seu Sol pai
        const offsetRadius = 30 + Math.random() * 15;
        const offsetAngle = Math.random() * Math.PI * 2;
        const offsetElevation = (Math.random() - 0.5) * (Math.PI * 0.3);
        sunPosition = [
          parentSunPosition[0] + offsetRadius * Math.cos(offsetElevation) * Math.cos(offsetAngle),
          parentSunPosition[1] + offsetRadius * Math.sin(offsetElevation),
          parentSunPosition[2] + offsetRadius * Math.cos(offsetElevation) * Math.sin(offsetAngle)
        ];
      } else {
        // Pastas raiz ganham órbita profunda e espaçada no universo
        sunPosition = getSpacedSunPosition(sunPositions);
        sunPositions.push(sunPosition);
      }

      // Detetar pastas e ficheiros diretos contidos
      const directChildDirs = sortedDirs.filter((d) => {
        const dParts = d.split('/');
        return dParts.slice(0, -1).join('/') === dirPath;
      });

      const directFiles = processedFiles.filter((pf) => pf.dirPath === dirPath);

      const fileCategoryMap = new Map<string, ProcessedFile[]>();
      for (const df of directFiles) {
        fileCategoryMap.set(df.category, [...(fileCategoryMap.get(df.category) || []), df]);
      }
      const directFilesLines = Array.from(fileCategoryMap.entries()).map(([category, pfs]) => (
        `### ${category}\n${pfs.map((pf) => {
          const overview = pf.digest.overview.length > 220
            ? `${pf.digest.overview.slice(0, 217).trim()}...`
            : pf.digest.overview;
          return `- ${pf.fileName} (${formatBytes(pf.file.size)}${pf.readable ? `, ${pf.extractionMethod}` : ', anexo indexado'}): ${overview}`;
        }).join('\n')}`
      ));

      const subdirsLines = directChildDirs.length > 0
        ? [
            '## Subpastas (Sóis orbitais associados)',
            ...directChildDirs.map((d) => {
              const subName = d.split('/').pop() || d;
              return `- 📂 **${subName}** (Sol orbital: \`${d}\`)`;
            })
          ]
        : [];

      const hubText = [
        `# 📂 Pasta de Projeto: ${dirName}`,
        `Caminho: \`${dirPath}\``,
        `Esta pasta é um Sol central que organiza e dá luz aos documentos e código contidos nela.`,
        '',
        `Lote: ${batchId}`,
        `Importado em: ${new Date().toLocaleString('pt-PT')}`,
        '',
        ...subdirsLines,
        '',
        '## Ficheiros Contidos nesta Pasta',
        directFilesLines.length > 0 ? directFilesLines.join('\n') : '*Nenhum ficheiro direto nesta pasta (apenas subpastas).*',
      ].join('\n');

      const dirTags = ['document-batch', 'directory', 'folder', 'projeto', 'pasta-assimilada', dirName.toLowerCase()];
      if (parts[0]) {
        dirTags.push(`projeto:${parts[0].toLowerCase()}`);
      }

      const folderHub = await persistLearnedMemory({
        uid,
        text: hubText,
        title: `Pasta: ${dirName}`,
        tags: dirTags,
        category: 'Documentos',
        attachments: directFiles.map((df) => df.attachment),
        existingMemories,
        source: 'document-batch',
        modality: 'mixed',
        batchId,
        celestialType: 'sun',
        position: sunPosition,
        parentId: parentSunId,
        connections: parentSunId ? [parentSunId] : [],
      });

      dirNodeMap.set(dirPath, { id: folderHub.id, position: sunPosition });

      if (parentSunId) {
        await updateDoc(doc(db, 'sessions', parentSunId), {
          connections: arrayUnion(folderHub.id),
          updatedAt: Date.now(),
        }).catch((error) => console.warn('Unable to link subfolder Sun to parent Sun:', parentSunId, error));
      }
    }
  }

  // 5. Criar e associar os Planetas correspondentes aos Ficheiros
  const firstRootDir = sortedDirs[0];
  const firstRootDirNode = firstRootDir ? dirNodeMap.get(firstRootDir) : null;
  const firstHubId = firstRootDirNode ? firstRootDirNode.id : defaultHubId;

  for (const pf of processedFiles) {
    const parentNode = pf.dirPath ? dirNodeMap.get(pf.dirPath) : null;
    const parentSunId = parentNode ? parentNode.id : defaultHubId;

    const fileTags = pf.dirPath
      ? ['documento', `lote:${batchId}`, pf.category.toLowerCase(), 'projeto', pf.dirPath.split('/')[0].toLowerCase()]
      : ['documento', `lote:${batchId}`, pf.category.toLowerCase()];

    const learned = await persistLearnedMemory({
      uid,
      text: pf.summarizedText,
      title: pf.fileName,
      tags: fileTags,
      category: pf.category,
      attachments: [pf.attachment],
      existingMemories,
      source: 'document-upload',
      modality: pf.attachmentType === 'video' ? 'video' : pf.attachmentType === 'image' ? 'image' : 'document',
      batchId,
      celestialType: 'planet',
      parentId: parentSunId,
      connections: [parentSunId],
    });

    await updateDoc(doc(db, 'sessions', parentSunId), {
      connections: arrayUnion(learned.id),
      updatedAt: Date.now(),
    }).catch((error) => console.warn('Unable to link Planet to its parent Sun:', parentSunId, error));
  }

  return { batchId, imported: files.length, hubId: firstHubId };
};
