export type MediaAnalysisKind = 'image' | 'video' | 'audio';

export interface FrameAnalysis {
  label: string;
  caption?: string;
  ocrText?: string;
}

export interface MediaAnalysisResult {
  kind: MediaAnalysisKind;
  method: string;
  analyzed: boolean;
  summary: string;
  observations: string[];
  topics: string[];
  ocrText?: string;
  transcript?: string;
  frames?: FrameAnalysis[];
  warnings: string[];
}

type CallablePipeline = {
  (input: unknown, options?: Record<string, unknown>): Promise<unknown>;
  dispose?: () => Promise<void> | void;
};

const IMAGE_CAPTION_MODEL = 'Xenova/vit-gpt2-image-captioning';
const OCR_MODEL = 'Xenova/trocr-small-printed';
const ASR_MODEL = 'Xenova/whisper-tiny';
const MODEL_LOAD_TIMEOUT_MS = 90_000;
const INFERENCE_TIMEOUT_MS = 60_000;
const MAX_TRANSCRIPTION_SECONDS = 180;
const TARGET_AUDIO_SAMPLE_RATE = 16_000;

const imageExtensions = new Set(['apng', 'avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'webm']);
const videoExtensions = new Set(['avi', 'm4v', 'mov', 'mp4', 'mpeg', 'ogv', 'webm']);

const extensionOf = (name: string): string => {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
};

export const mediaKindForFile = (file: File): MediaAnalysisKind | null => {
  const extension = extensionOf(file.name);
  if (file.type.startsWith('image/') || imageExtensions.has(extension)) return 'image';
  if (file.type.startsWith('video/') || videoExtensions.has(extension)) return 'video';
  if (file.type.startsWith('audio/') || audioExtensions.has(extension)) return 'audio';
  return null;
};

export const isAnalyzableMediaFile = (file: File): boolean =>
  mediaKindForFile(file) !== null;

export const selectVideoFrameTimes = (duration: number): number[] => {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  if (duration < 4) return [Math.max(0, duration / 2)];
  return [
    Math.min(1, duration * 0.1),
    duration * 0.5,
    Math.max(0, duration * 0.85),
  ];
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} demorou demasiado.`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;

const readStringField = (value: unknown, field: string): string => {
  const record = asRecord(value);
  const fieldValue = record?.[field];
  return typeof fieldValue === 'string' ? fieldValue.trim() : '';
};

const outputText = (output: unknown): string => {
  if (typeof output === 'string') return output.trim();
  if (Array.isArray(output)) {
    return output
      .map((item) => outputText(item))
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  return (
    readStringField(output, 'generated_text') ||
    readStringField(output, 'text') ||
    readStringField(output, 'label')
  ).replace(/\s+/g, ' ').trim();
};

const isUsefulText = (value: string): boolean => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length >= 4 && /[\p{L}\p{N}]/u.test(normalized);
};

const loadImageToTextPipeline = async (model: string): Promise<CallablePipeline> => {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  return await withTimeout(
    pipeline('image-to-text', model, { dtype: 'q8' } as never) as Promise<unknown>,
    MODEL_LOAD_TIMEOUT_MS,
    `Carregamento do modelo ${model}`,
  ) as CallablePipeline;
};

const loadAsrPipeline = async (): Promise<CallablePipeline> => {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  return await withTimeout(
    pipeline('automatic-speech-recognition', ASR_MODEL, { dtype: 'q8' } as never) as Promise<unknown>,
    MODEL_LOAD_TIMEOUT_MS,
    `Carregamento do modelo ${ASR_MODEL}`,
  ) as CallablePipeline;
};

const disposePipeline = async (pipe: CallablePipeline | null): Promise<void> => {
  if (!pipe?.dispose) return;
  await pipe.dispose();
};

const runImagePipeline = async (
  imageUrls: string[],
  model: string,
  label: string,
): Promise<{ texts: string[]; warning?: string }> => {
  let pipe: CallablePipeline | null = null;
  try {
    pipe = await loadImageToTextPipeline(model);
    const texts: string[] = [];
    for (const url of imageUrls) {
      const output = await withTimeout(pipe(url), INFERENCE_TIMEOUT_MS, label);
      const text = outputText(output);
      texts.push(isUsefulText(text) ? text : '');
    }
    return { texts };
  } catch (error) {
    return {
      texts: imageUrls.map(() => ''),
      warning: `${label}: ${error instanceof Error ? error.message : 'falha local'}`,
    };
  } finally {
    await disposePipeline(pipe);
  }
};

const waitForEvent = <T extends Event>(
  target: EventTarget,
  eventName: string,
  timeoutLabel: string,
): Promise<T> => withTimeout(new Promise<T>((resolve, reject) => {
  const onSuccess = (event: Event) => {
    cleanup();
    resolve(event as T);
  };
  const onError = () => {
    cleanup();
    reject(new Error(timeoutLabel));
  };
  const cleanup = () => {
    target.removeEventListener(eventName, onSuccess);
    target.removeEventListener('error', onError);
  };
  target.addEventListener(eventName, onSuccess, { once: true });
  target.addEventListener('error', onError, { once: true });
}), 18_000, timeoutLabel);

const canvasToBlob = async (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Não foi possível capturar frame do vídeo.'));
    }, 'image/jpeg', 0.85);
  });

const captureVideoFrame = async (video: HTMLVideoElement, time: number, label: string): Promise<{ label: string; url: string }> => {
  const safeDuration = Number.isFinite(video.duration) ? video.duration : time;
  video.currentTime = Math.min(Math.max(time, 0), Math.max(safeDuration - 0.05, 0));
  await waitForEvent(video, 'seeked', `Frame ${label} indisponível`);

  const sourceWidth = video.videoWidth || 960;
  const sourceHeight = video.videoHeight || 540;
  const scale = Math.min(1, 960 / sourceWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível para análise de vídeo.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas);
  return { label, url: URL.createObjectURL(blob) };
};

const extractVideoFrames = async (file: File): Promise<{ label: string; url: string }[]> => {
  if (typeof document === 'undefined') return [];
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    video.src = videoUrl;
    await waitForEvent(video, 'loadedmetadata', 'Metadados de vídeo indisponíveis');
    const times = selectVideoFrameTimes(video.duration);
    const frames: { label: string; url: string }[] = [];
    for (const [index, time] of times.entries()) {
      frames.push(await captureVideoFrame(video, time, `frame ${index + 1}`));
    }
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(videoUrl);
  }
};

const downsample = (samples: Float32Array, sourceRate: number, targetRate: number): Float32Array => {
  if (sourceRate === targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const targetLength = Math.floor(samples.length / ratio);
  const result = new Float32Array(targetLength);
  for (let index = 0; index < targetLength; index += 1) {
    const sourceStart = Math.floor(index * ratio);
    const sourceEnd = Math.min(Math.floor((index + 1) * ratio), samples.length);
    let sum = 0;
    for (let sourceIndex = sourceStart; sourceIndex < sourceEnd; sourceIndex += 1) {
      sum += samples[sourceIndex];
    }
    result[index] = sum / Math.max(1, sourceEnd - sourceStart);
  }
  return result;
};

const decodeAudioSamples = async (file: File): Promise<{ samples: Float32Array; truncated: boolean }> => {
  if (typeof window === 'undefined') throw new Error('AudioContext indisponível fora do browser.');
  const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('AudioContext não suportado neste browser.');

  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const maxSamples = Math.floor(Math.min(buffer.duration, MAX_TRANSCRIPTION_SECONDS) * buffer.sampleRate);
    const mixed = new Float32Array(maxSamples);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < maxSamples; index += 1) {
        mixed[index] += data[index] / buffer.numberOfChannels;
      }
    }
    return {
      samples: downsample(mixed, buffer.sampleRate, TARGET_AUDIO_SAMPLE_RATE),
      truncated: buffer.duration > MAX_TRANSCRIPTION_SECONDS,
    };
  } finally {
    await context.close();
  }
};

const transcribeAudio = async (file: File): Promise<{ transcript?: string; warning?: string }> => {
  let pipe: CallablePipeline | null = null;
  try {
    const { samples, truncated } = await decodeAudioSamples(file);
    pipe = await loadAsrPipeline();
    const output = await withTimeout(pipe(samples, {
      chunk_length_s: 20,
      stride_length_s: 4,
      language: 'portuguese',
      task: 'transcribe',
    }), INFERENCE_TIMEOUT_MS * 2, 'Transcrição local');
    const transcript = outputText(output);
    const suffix = truncated ? ' [Transcrição limitada aos primeiros 3 minutos.]' : '';
    return { transcript: isUsefulText(transcript) ? `${transcript}${suffix}` : undefined };
  } catch (error) {
    return {
      warning: `Transcrição local: ${error instanceof Error ? error.message : 'falha ao processar áudio'}`,
    };
  } finally {
    await disposePipeline(pipe);
  }
};

const extractTopics = (value: string): string[] => {
  const counts = new Map<string, { count: number; label: string; firstSeen: number }>();
  const words = value.match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [];
  const stopWords = new Set(['com', 'para', 'sobre', 'frame', 'imagem', 'video', 'vídeo', 'audio', 'áudio', 'the', 'and', 'with']);
  for (const [index, word] of words.entries()) {
    const normalized = word.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (stopWords.has(normalized) || /^\d+$/.test(normalized)) continue;
    const previous = counts.get(normalized);
    counts.set(normalized, {
      count: (previous?.count || 0) + 1,
      label: previous?.label || word.toLowerCase(),
      firstSeen: previous?.firstSeen ?? index,
    });
  }
  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.firstSeen - right.firstSeen)
    .slice(0, 10)
    .map((entry) => entry.label);
};

const buildResult = (
  kind: MediaAnalysisKind,
  observations: string[],
  options: Partial<MediaAnalysisResult>,
): MediaAnalysisResult => {
  const combined = [
    ...observations,
    options.ocrText,
    options.transcript,
  ].filter(Boolean).join(' ');
  const analyzed = combined.trim().length > 0;
  const summary = analyzed
    ? combined.replace(/\s+/g, ' ').slice(0, 900)
    : 'Não foi possível gerar análise semântica local para este ficheiro; ficou anexado e organizado por metadados.';

  return {
    kind,
    method: options.method || 'análise multimodal local',
    analyzed,
    summary,
    observations,
    topics: extractTopics(combined),
    ocrText: options.ocrText,
    transcript: options.transcript,
    frames: options.frames,
    warnings: options.warnings || [],
  };
};

const analyzeImageUrls = async (imageUrls: string[], labels: string[]): Promise<{ frames: FrameAnalysis[]; warnings: string[] }> => {
  const warnings: string[] = [];
  const captions = await runImagePipeline(imageUrls, IMAGE_CAPTION_MODEL, 'Descrição visual local');
  if (captions.warning) warnings.push(captions.warning);
  const ocr = await runImagePipeline(imageUrls, OCR_MODEL, 'OCR local');
  if (ocr.warning) warnings.push(ocr.warning);

  return {
    warnings,
    frames: imageUrls.map((_, index) => ({
      label: labels[index] || `imagem ${index + 1}`,
      caption: captions.texts[index],
      ocrText: ocr.texts[index],
    })),
  };
};

const analyzeImageFile = async (file: File): Promise<MediaAnalysisResult> => {
  const imageUrl = URL.createObjectURL(file);
  try {
    const { frames, warnings } = await analyzeImageUrls([imageUrl], ['imagem']);
    const frame = frames[0];
    const observations = frame?.caption ? [`Descrição visual: ${frame.caption}`] : [];
    const ocrText = frame?.ocrText && isUsefulText(frame.ocrText) ? frame.ocrText : undefined;
    return buildResult('image', observations, {
      method: 'visão local com captioning e OCR',
      ocrText,
      frames,
      warnings,
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};

const analyzeVideoFile = async (file: File): Promise<MediaAnalysisResult> => {
  const warnings: string[] = [];
  let frames: { label: string; url: string }[] = [];
  try {
    frames = await extractVideoFrames(file);
  } catch (error) {
    warnings.push(`Frames do vídeo: ${error instanceof Error ? error.message : 'falha ao capturar frames'}`);
  }

  const imageAnalysis = frames.length > 0
    ? await analyzeImageUrls(frames.map((frame) => frame.url), frames.map((frame) => frame.label))
    : { frames: [] as FrameAnalysis[], warnings: [] as string[] };
  warnings.push(...imageAnalysis.warnings);

  const transcription = await transcribeAudio(file);
  if (transcription.warning) warnings.push(transcription.warning);

  for (const frame of frames) {
    URL.revokeObjectURL(frame.url);
  }

  const observations = imageAnalysis.frames.flatMap((frame) => (
    frame.caption ? [`${frame.label}: ${frame.caption}`] : []
  ));
  const ocrText = imageAnalysis.frames
    .map((frame) => frame.ocrText)
    .filter((text): text is string => Boolean(text && isUsefulText(text)))
    .join('\n');

  return buildResult('video', observations, {
    method: 'visão local por frames, OCR e transcrição best-effort',
    ocrText: ocrText || undefined,
    transcript: transcription.transcript,
    frames: imageAnalysis.frames,
    warnings,
  });
};

const analyzeAudioFile = async (file: File): Promise<MediaAnalysisResult> => {
  const transcription = await transcribeAudio(file);
  const warnings = transcription.warning ? [transcription.warning] : [];
  return buildResult('audio', [], {
    method: 'transcrição local de áudio',
    transcript: transcription.transcript,
    warnings,
  });
};

export const analyzeMediaFile = async (file: File): Promise<MediaAnalysisResult> => {
  const kind = mediaKindForFile(file);
  if (kind === 'image') return analyzeImageFile(file);
  if (kind === 'video') return analyzeVideoFile(file);
  if (kind === 'audio') return analyzeAudioFile(file);
  return buildResult('image', [], {
    method: 'metadados e anexo',
    warnings: ['Tipo de media não suportado para análise multimodal local.'],
  });
};

export const mediaAnalysisToText = (fileName: string, analysis: MediaAnalysisResult): string => {
  const lines = [
    `[Media analisado: ${fileName}]`,
    '',
    `Modalidade: ${analysis.kind}`,
    `Método: ${analysis.method}`,
    `Estado: ${analysis.analyzed ? 'análise semântica criada' : 'apenas metadados/anexo'}`,
    '',
    '## Descrição semântica',
    analysis.summary,
  ];

  if (analysis.observations.length > 0) {
    lines.push('', '## Observações visuais', ...analysis.observations.map((item) => `- ${item}`));
  }

  if (analysis.ocrText) {
    lines.push('', '## OCR / texto detectado', analysis.ocrText);
  }

  if (analysis.transcript) {
    lines.push('', '## Transcrição', analysis.transcript);
  }

  if (analysis.topics.length > 0) {
    lines.push('', '## Temas multimodais', analysis.topics.join(', '));
  }

  if (analysis.warnings.length > 0) {
    lines.push('', '## Limitações', ...analysis.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join('\n');
};
