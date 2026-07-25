export interface DocumentDigest {
  overview: string;
  keyPoints: string[];
  topics: string[];
  excerpt: string;
  readable: boolean;
}

interface DigestOptions {
  fileName: string;
  category: string;
}

const MAX_EXCERPT_CHARS = 12_000;
const MAX_SENTENCE_CHARS = 360;
const MIN_SENTENCE_WORDS = 6;

const STOP_WORDS = new Set([
  'ainda', 'alguma', 'algumas', 'algum', 'alguns', 'ante', 'antes', 'apenas', 'apos', 'após',
  'aquela', 'aquele', 'aqueles', 'aqui', 'assim', 'ate', 'até', 'cada', 'como', 'com',
  'contra', 'cujo', 'cuja', 'daquele', 'daquela', 'depois', 'desde', 'desta', 'deste',
  'disso', 'disto', 'durante', 'elas', 'eles', 'entre', 'essa', 'esse', 'esta', 'este',
  'estes', 'fora', 'isso', 'isto', 'mais', 'mas', 'mesmo', 'muito', 'muitos', 'nao',
  'não', 'nossa', 'nosso', 'outra', 'outro', 'para', 'pela', 'pelo', 'pelos', 'pode',
  'pois', 'porque', 'quando', 'quanto', 'quase', 'quem', 'sobre', 'tambem', 'também',
  'toda', 'todo', 'todos', 'tudo', 'uma', 'umas', 'voce', 'você',
  'the', 'and', 'for', 'from', 'that', 'this', 'with', 'into', 'your', 'about', 'after',
  'before', 'between', 'their', 'there', 'these', 'those', 'will', 'would', 'could',
]);

const normalizeWhitespace = (value: string): string =>
  value
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normalizeToken = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}-]/gu, '');

const rawTokens = (value: string): string[] =>
  value.match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [];

const tokenize = (value: string): string[] =>
  rawTokens(value)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token));

const splitSentences = (text: string): string[] => {
  const normalized = normalizeWhitespace(text)
    .replace(/([.!?])\s+/g, '$1\n')
    .replace(/(?:^|\n)\s*[-*•]\s+/g, '\n');

  return normalized
    .split(/\n+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
};

const frequencyMap = (sentences: string[]): Map<string, number> => {
  const frequencies = new Map<string, number>();
  for (const sentence of sentences) {
    for (const token of tokenize(sentence)) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }
  }
  return frequencies;
};

const sentenceSimilarity = (left: string, right: string): number => {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
};

const scoreSentence = (
  sentence: string,
  index: number,
  frequencies: Map<string, number>,
): number => {
  const tokens = tokenize(sentence);
  if (tokens.length < MIN_SENTENCE_WORDS || sentence.length > MAX_SENTENCE_CHARS) return 0;

  const lexicalScore = tokens.reduce((score, token) => score + (frequencies.get(token) || 0), 0) / tokens.length;
  const positionBoost = index < 4 ? 1.25 : 1;
  const densityBoost = Math.min(1.2, 0.85 + tokens.length / 80);
  return lexicalScore * positionBoost * densityBoost;
};

const extractTopics = (text: string, limit = 8): string[] => {
  const counts = new Map<string, { count: number; display: string; firstSeen: number }>();
  for (const [index, word] of rawTokens(text).entries()) {
    const normalized = normalizeToken(word);
    if (normalized.length < 3 || STOP_WORDS.has(normalized) || /^\d+$/.test(normalized)) continue;
    const previous = counts.get(normalized);
    counts.set(normalized, {
      count: (previous?.count || 0) + 1,
      display: previous?.display || word.toLowerCase(),
      firstSeen: previous?.firstSeen ?? index,
    });
  }

  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.firstSeen - right.firstSeen)
    .slice(0, limit)
    .map((entry) => entry.display);
};

const selectKeySentences = (sentences: string[], limit: number): string[] => {
  const frequencies = frequencyMap(sentences);
  const ranked = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreSentence(sentence, index, frequencies),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected: typeof ranked = [];
  for (const item of ranked) {
    if (selected.some((existing) => sentenceSimilarity(existing.sentence, item.sentence) > 0.62)) continue;
    selected.push(item);
    if (selected.length >= limit) break;
  }

  return selected
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence);
};

export const buildDocumentDigest = (text: string, options: DigestOptions): DocumentDigest => {
  const cleanText = normalizeWhitespace(text);
  const readable = cleanText.length > 0;

  if (!readable) {
    return {
      readable: false,
      overview: `Não foi possível extrair texto local de ${options.fileName}; o ficheiro ficou anexado e organizado em ${options.category}.`,
      keyPoints: ['Conteúdo textual indisponível no browser para resumo automático.'],
      topics: [options.category],
      excerpt: 'Conteúdo textual não extraído no browser. O ficheiro ficou anexado para consulta e organização.',
    };
  }

  const sentences = splitSentences(cleanText);
  const keySentences = selectKeySentences(sentences, 6);
  const fallback = cleanText.replace(/\s+/g, ' ').slice(0, 420);
  const overviewSentences = keySentences.slice(0, 3);

  return {
    readable: true,
    overview: overviewSentences.length > 0 ? overviewSentences.join(' ') : fallback,
    keyPoints: keySentences.length > 0 ? keySentences : [fallback],
    topics: extractTopics(cleanText),
    excerpt: cleanText.slice(0, MAX_EXCERPT_CHARS),
  };
};
