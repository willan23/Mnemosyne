import { describe, expect, it } from 'vitest';
import {
  mediaAnalysisToText,
  mediaKindForFile,
  selectVideoFrameTimes,
  type MediaAnalysisResult,
} from './mediaAnalysisService';

describe('mediaAnalysisService pure helpers', () => {
  it('detects media kind from mime type and extension', () => {
    expect(mediaKindForFile(new File(['x'], 'photo.png', { type: 'image/png' }))).toBe('image');
    expect(mediaKindForFile(new File(['x'], 'clip.mp4', { type: '' }))).toBe('video');
    expect(mediaKindForFile(new File(['x'], 'voice.wav', { type: '' }))).toBe('audio');
    expect(mediaKindForFile(new File(['x'], 'report.pdf', { type: 'application/pdf' }))).toBeNull();
    expect(mediaKindForFile(new File(['export {}'], 'app.ts', { type: 'video/mp2t' }))).toBeNull();
    expect(mediaKindForFile(new File(['#'], 'notes.md', { type: '' }))).toBeNull();
  });

  it('selects stable video frame times across short and long videos', () => {
    expect(selectVideoFrameTimes(0)).toEqual([0]);
    expect(selectVideoFrameTimes(3)).toEqual([1.5]);
    expect(selectVideoFrameTimes(60)).toEqual([1, 30, 51]);
  });

  it('formats semantic media analysis for document learning', () => {
    const analysis: MediaAnalysisResult = {
      kind: 'video',
      method: 'visão local por frames, OCR e transcrição best-effort',
      analyzed: true,
      summary: 'frame 1: pessoa a apresentar um produto. A transcrição menciona lançamento e próximos passos.',
      observations: ['frame 1: pessoa a apresentar um produto'],
      topics: ['produto', 'lançamento'],
      ocrText: 'Roadmap Q2',
      transcript: 'Vamos lançar a nova versão e validar com utilizadores reais.',
      warnings: ['Transcrição limitada aos primeiros 3 minutos.'],
      frames: [{ label: 'frame 1', caption: 'pessoa a apresentar um produto', ocrText: 'Roadmap Q2' }],
    };

    const text = mediaAnalysisToText('demo.mp4', analysis);

    expect(text).toContain('## Descrição semântica');
    expect(text).toContain('## Observações visuais');
    expect(text).toContain('## OCR / texto detectado');
    expect(text).toContain('## Transcrição');
    expect(text).toContain('produto, lançamento');
  });
});
