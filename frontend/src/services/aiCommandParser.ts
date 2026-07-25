export type ParsedAiCommand =
  | { type: 'web-research'; query: string }
  | { type: 'text-generation'; prompt: string }
  | { type: 'memory-create'; text: string }
  | { type: 'image-generation'; prompt: string }
  | { type: 'none' };

const clean = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const stripOptionalPoliteness = (value: string): string =>
  clean(value)
    .replace(/^(?:por favor[, ]*)/i, '')
    .replace(/^(?:podes|pode|consegues|consegue)\s+/i, '');

const matchFirst = (value: string, patterns: RegExp[]): string | null => {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return clean(match[1] || '');
  }
  return null;
};

export function parseAiCommand(rawValue: string): ParsedAiCommand {
  const value = stripOptionalPoliteness(rawValue);
  if (!value) return { type: 'none' };

  const webQuery = matchFirst(value, [
    /^\/web\s+pesquisar(?:\s+(.+))?$/is,
    /^(?:pesquis(?:a|ar|e)|procura(?:r)?|busca(?:r)?|investiga(?:r)?|consulta(?:r)?)\s+(?:na\s+)?(?:web|internet|online|google)(?:\s+(?:sobre|por|acerca\s+de|de))?\s*:?\s*(.*)$/is,
    /^(?:fazer|faz|faça)\s+(?:uma\s+)?pesquisa\s+(?:na\s+)?(?:web|internet|online)(?:\s+(?:sobre|por|acerca\s+de|de))?\s*:?\s*(.*)$/is,
  ]);
  if (webQuery !== null) return { type: 'web-research', query: webQuery };

  const memoryText = matchFirst(value, [
    /^\/mem[oó]ria\s+(?:criar|guardar|salvar|registar|registrar)\s+(.+)$/is,
    /^(?:cria(?:r)?|guarda(?:r)?|salva(?:r)?|regista(?:r)?|registra(?:r)?)\s+(?:uma\s+)?mem[oó]ria(?:\s+(?:sobre|com|de))?\s*:?\s*(.+)$/is,
  ]);
  if (memoryText) return { type: 'memory-create', text: memoryText };

  const imagePrompt = matchFirst(value, [
    /^\/imagem\s+gerar\s+(.+)$/is,
    /^(?:gera(?:r)?|cria(?:r)?|faz(?:er)?)\s+(?:uma\s+)?imagem(?:\s+(?:sobre|de|com|para))?\s*:?\s*(.+)$/is,
  ]);
  if (imagePrompt) return { type: 'image-generation', prompt: imagePrompt };

  const textPrompt = matchFirst(value, [
    /^\/(?:texto|ia)\s+gerar\s+(.+)$/is,
    /^(?:gera(?:r)?|cria(?:r)?|escreve(?:r)?|redige(?:r)?|faz(?:er)?)\s+(?:um\s+|uma\s+)?(?:texto|resumo|plano|email|mensagem|lista|explica[cç][aã]o)(?:\s+(?:sobre|para|de|com))?\s*:?\s*(.+)$/is,
    /^(?:ia|mnemosyne)[, ]+(?:gera(?:r)?|cria(?:r)?|escreve(?:r)?|redige(?:r)?|faz(?:er)?|resume|explica|analisa)\s+(.+)$/is,
  ]);
  if (textPrompt) return { type: 'text-generation', prompt: textPrompt };

  if (/^(?:faz|faça|fazer|gera|gerar|escreve|redige|planeia|resume|explica|analisa)\b/i.test(value)) {
    return { type: 'text-generation', prompt: value };
  }

  return { type: 'none' };
}
