import { describe, expect, it } from 'vitest';
import { buildDocumentDigest } from './documentSummary';

describe('buildDocumentDigest', () => {
  it('builds a local summary with key points and topics from extracted text', () => {
    const digest = buildDocumentDigest(`
      O Mnemosyne organiza memórias pessoais em um universo cognitivo navegável.
      A importação documental transforma ficheiros carregados em memórias com resumo, temas e anexos.
      O sistema preserva o princípio Zero-Knowledge porque o resumo básico acontece localmente no browser.
      Documentos de produto, pesquisa e reuniões devem ficar ligados ao lote documental.
      A experiência precisa ser clara para o utilizador e útil mesmo sem uma API externa.
    `, {
      fileName: 'roadmap.txt',
      category: 'Produto',
    });

    expect(digest.readable).toBe(true);
    expect(digest.overview).toContain('Mnemosyne');
    expect(digest.keyPoints.length).toBeGreaterThanOrEqual(2);
    expect(digest.topics).toEqual(expect.arrayContaining(['mnemosyne', 'documental']));
    expect(digest.excerpt).toContain('Zero-Knowledge');
  });

  it('returns an honest metadata-only summary when no text was extracted', () => {
    const digest = buildDocumentDigest('', {
      fileName: 'video.mp4',
      category: 'Vídeo',
    });

    expect(digest.readable).toBe(false);
    expect(digest.overview).toContain('Não foi possível extrair texto local');
    expect(digest.keyPoints[0]).toContain('indisponível');
    expect(digest.topics).toEqual(['Vídeo']);
  });
});
