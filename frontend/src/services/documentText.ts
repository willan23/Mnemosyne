import {fileExtension,isTextLikeExtension} from '../utils/fileTypes';
import type {AttachmentType} from '../types/attachments';
import type {DocumentDigest} from './documentSummary';
import {analyzeMediaFile,isAnalyzableMediaFile,mediaAnalysisToText,mediaKindForFile} from './mediaAnalysisService';
export const MAX_TEXT_EXTRACT_CHARS=120_000;
const extensionOf = (name: string): string => fileExtension(name);

export const formatBytes = (bytes: number): string => {
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

const extractZipXmlText = async (file: File, includePatterns: RegExp[], guard: () => void): Promise<string> => {
  guard(); const { default: JSZip } = await import('jszip'); guard();
  const bytes = await file.arrayBuffer(); guard();
  const zip = await JSZip.loadAsync(bytes); guard();
  const chunks: string[] = [];
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && includePatterns.some((pattern) => pattern.test(entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (const entry of entries) {
    guard(); const xml = await entry.async('string'); guard();
    const text = xmlToText(xml);
    if (text) chunks.push(text);
    if (chunks.join('\n').length >= MAX_TEXT_EXTRACT_CHARS) break;
  }

  return chunks.join('\n\n').slice(0, MAX_TEXT_EXTRACT_CHARS);
};

const extractPdfText = async (file: File, guard: () => void): Promise<string> => {
  guard(); const pdfjs = await import('pdfjs-dist'); guard();
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url'); guard();
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const bytes = await file.arrayBuffer(); guard();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  try { guard();
  const chunks: string[] = [];
  const maxPages = Math.min(pdf.numPages, 80);

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    guard(); const page = await pdf.getPage(pageNumber); guard();
    const content = await page.getTextContent(); guard();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) chunks.push(`Página ${pageNumber}: ${text}`);
    if (chunks.join('\n').length >= MAX_TEXT_EXTRACT_CHARS) break;
  }

  return chunks.join('\n\n').slice(0, MAX_TEXT_EXTRACT_CHARS);
  } finally { if ('destroy' in pdf && typeof pdf.destroy === 'function') await pdf.destroy(); }
};

export const extractReadableText = async (file: File, guard: () => void): Promise<{ text: string; method: string }> => {
  guard(); const extension = extensionOf(file.name);
  const textLikeMime = file.type.startsWith('text/') || ['application/json', 'application/xml'].includes(file.type);
  try {
    if (isAnalyzableMediaFile(file)) {
      const analysis = await analyzeMediaFile(file); guard();
      return {
        text: mediaAnalysisToText(file.name, analysis).slice(0, MAX_TEXT_EXTRACT_CHARS),
        method: analysis.method,
      };
    }
    if (textLikeMime || isTextLikeExtension(extension)) {
      const text = await file.text(); guard();
      return { text: text.slice(0, MAX_TEXT_EXTRACT_CHARS), method: 'texto local' };
    }
    if (extension === 'pdf' || file.type === 'application/pdf') {
      return { text: await extractPdfText(file, guard), method: 'PDF local' };
    }
    if (extension === 'docx') {
      return {
        text: await extractZipXmlText(file, [/^word\/document\.xml$/i, /^word\/header\d*\.xml$/i, /^word\/footer\d*\.xml$/i], guard),
        method: 'DOCX local',
      };
    }
    if (extension === 'pptx') {
      return { text: await extractZipXmlText(file, [/^ppt\/slides\/slide\d+\.xml$/i], guard), method: 'PPTX local' };
    }
    if (extension === 'xlsx') {
      return {
        text: await extractZipXmlText(file, [/^xl\/sharedStrings\.xml$/i, /^xl\/worksheets\/sheet\d+\.xml$/i], guard),
        method: 'XLSX local',
      };
    }
  } catch {
    guard(); console.warn('Extração local indisponível.');
    return { text: '', method: 'falha na extração local' };
  }
  return { text: '', method: 'metadados e anexo' };
};

export const attachmentTypeForFile = (file: File): AttachmentType => {
  const mediaKind = mediaKindForFile(file);
  if (mediaKind === 'image') return 'image';
  if (mediaKind === 'audio') return 'audio';
  if (mediaKind === 'video') return 'video';
  return 'document';
};

export const categorizeDocument = (file: File, text: string): string => {
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

export const summarizeDocument = (
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

