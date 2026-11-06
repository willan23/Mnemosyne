import { cognitiveEngine } from '../engines/CognitiveEngine';
import type { SessionData } from '../hooks/useSessions';
import type { CelestialType, MemoryObject } from '../types/universe';
import type { Attachment } from '../types/attachments';
import type { GeneratedImageResult } from './aiGenerationService';
import { uploadEncryptedAttachment } from './attachmentUploadClient';
import { createMemoryWithAttachments, createPersonalMemory,createTeamMemory,assertTeamMemoryCreationEnabled, assertPersonalMemoryCreationEnabled } from './attachedMemoryRecovery';
import { withPersonalMemoryMutation } from './personalMemoryMutation';
import { captureSemanticCandidates, semanticCandidateEligibility } from './semanticCandidateCapture';
import {assertPersonalConnectionWrites,changePersonalConnection} from './personalConnections';
import { AiGenerationContextError, type AiGenerationContext } from './aiGenerationContext';

import {revisePersonalLearnedMemory,capturePersonalRevisionBaseline,PersonalRevisionError,type PersonalRevisionBaseline} from './personalLearnedRevision';
import {captureTeamRevisionBaseline,reviseTeamLearnedMemory,TeamRevisionError,type TeamRevisionBaseline} from './teamRevisionRecovery';
import {buildDocumentImportPlan} from './documentImportBuild';
import {startCapturedDocumentImport,type DocumentImportResult} from './documentImportRecovery';

type LearningSource =
  | 'manual'
  | 'text-generation'
  | 'image-generation'
  | 'video-generation'
  | 'document-batch'
  | 'document-upload'
  | 'capsule-import'
  | 'obsidian-vault'
  | 'starter-universe';

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
  provider?: string | null;
  model?: string | null;
  batchId?: string | null;
  connections?: string[];
  celestialType?: CelestialType | null;
  parentId?: string | null;
  position?: [number, number, number] | null;
  /** Lane A–E (metadado em claro, como category). */
  taxonomyLane?: import('../utils/taxonomy').TaxonomyLane | null;
  /** Estado de projecto (metadado em claro). */
  projectStatus?: import('../utils/taxonomy').ProjectStatus | null;
  /** Bulk import: grava E2EE + ligações explícitas sem esperar embeddings. */
  skipSemantic?: boolean;
  generationContext?: AiGenerationContext;
  /** Captured account/vault guard for an enclosing import, including its internal awaits. */
  assertCurrent?: () => void;
}

interface LearnedMemoryResult {
  id: string;
  processingMethod: string;
  personalRevisionBaseline?: PersonalRevisionBaseline;
  personalRevisionUnavailable?: true;
  teamRevisionBaseline?: TeamRevisionBaseline;
  teamRevisionUnavailable?: true;
}



const unique = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));

export const sessionToMemoryObject = (session: SessionData): MemoryObject => ({
  id: session.id,
  text: session.text || '',
  title: session.title,
  celestialType: (session.celestialType || 'planet') as CelestialType,
  position: session.position || [0, 0, 0],
  embedding: session.embedding || [],
  embeddingModel: session.embeddingModel,
  connections: session.connections || [],
  semanticClusterId: session.semanticClusterId,
  importance: session.importance || 0.5,
  timestamp: session.timestamp || 0,
  updatedAt: session.updatedAt || session.timestamp || 0,
  uid: session.uid,
  tags: session.tags,
  category: session.category,
  teamId: session.teamId,
});

const generationCandidates = (sessions: SessionData[], uid: string, assertCurrent: () => void, context?: AiGenerationContext, excludeId?: string) =>
  captureSemanticCandidates(sessions, { assertCurrent, eligible: semanticCandidateEligibility(uid, context?.scope.kind === 'team' ? context.scope.teamId : undefined, excludeId) });
async function guardGeneration(uid: string, context?: AiGenerationContext) {
  if (!context) return;
  if (context.uid !== uid) throw new AiGenerationContextError();
  await context.assertAccess();
}

const fileFromDataUrl = async (dataUrl: string, filename: string): Promise<File> => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || 'image/png', lastModified: Date.now() });
};

export const persistLearnedMemory = async (input: PersistLearningInput): Promise<LearnedMemoryResult> => {
  const captured = { ...input, tags: [...(input.tags ?? [])], connections: [...(input.connections ?? [])],
    attachments: structuredClone(input.attachments ?? []), existingMemories: input.existingMemories ?? [] };
  if (input.generationContext?.scope.kind === 'team') {assertTeamMemoryCreationEnabled();return persistCapturedLearnedMemory(captured);}
  if (!captured.attachments.length) assertPersonalMemoryCreationEnabled();
  return withPersonalMemoryMutation(input.uid, context => persistCapturedLearnedMemory({ ...captured, assertCurrent: () => {
    context.assertCurrent(); input.assertCurrent?.();
  } }));
};
const persistCapturedLearnedMemory = async ({
  uid,
  text,
  title,
  tags = [],
  category = null,
  attachments = [],
  existingMemories = [],
  source,
  modality,
  provider = null,
  model = null,
  batchId = null,
  connections = [],
  celestialType = null,
  parentId = null,
  position = null,
  taxonomyLane = null,
  projectStatus = null,
  skipSemantic = false,
  generationContext,
  assertCurrent = () => {},
}: PersistLearningInput): Promise<LearnedMemoryResult> => {
  const guard = async () => {assertCurrent();await guardGeneration(uid,generationContext);assertCurrent();};
  await guard();
  const allConnections = unique(connections);
  if (generationContext && allConnections.length) throw new AiGenerationContextError();
  if (allConnections.length) assertPersonalConnectionWrites();
  const now = Date.now();
  let cognitive: Awaited<ReturnType<typeof cognitiveEngine.processMemory>> | null = null;
  let processingMethod = `learned:${source}`;

  if (!skipSemantic) {
    try {
      const semanticGuard = () => { assertCurrent(); generationContext?.assertCurrent(); };
      const candidates = await generationCandidates(existingMemories, uid, semanticGuard, generationContext);
      cognitive = await cognitiveEngine.processMemory(text, candidates, { assertCurrent: semanticGuard });
      await guard();
      processingMethod = `${processingMethod}+local-embedding`;
    } catch {
      assertCurrent();
      generationContext?.assertCurrent();
      console.warn('Learning memory saved without semantic enrichment.');
    }
  } else {
    processingMethod = `${processingMethod}+links-only`;
  }

  // `connections` here are explicit source/parent links. Vector neighbors are
  // offered separately for owner review by the relation proposal backfill.

  const chosenTitle = title || (cognitive ? cognitiveEngine.generateTitle(text) : null);
  const metadata = {
    tags: unique(['auto-learned', source, modality, ...tags]),
    category,
    embedding: cognitive?.embedding || null,
    embeddingModel: cognitive?.embeddingModel || null,
    connections: [],
    semanticClusterId: cognitive?.semanticClusterId || null,
    position: position || cognitive?.position || null,
    importance: cognitive?.importance || 0.55,
    celestialType: celestialType || cognitive?.celestialType || (modality === 'document' ? 'planet' : null),
    parentId: parentId || null,
    taxonomyLane: taxonomyLane || null,
    projectStatus: projectStatus || null,
    generatedProvider: provider,
    generatedModel: model,
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
  };
  await guard();
  const scope = generationContext?.scope;
  // Generated memories have no reciprocal writes outside their captured scope.
  let memoryRef: { id: string };
  if (attachments.length) {
    memoryRef = await createMemoryWithAttachments({ uid, text, title: chosenTitle, attachments, metadata,
      teamId: scope?.kind === 'team' ? scope.teamId : null,...(scope?.kind==='team'?{expectedTeamEpoch:{keyEpoch:scope.keyEpoch,keyId:scope.keyId}}:{}) }, undefined, () => { assertCurrent(); generationContext?.assertCurrent(); },guard);
  } else if (scope?.kind === 'team' && generationContext) {
    memoryRef=await createTeamMemory({uid,text,title:chosenTitle,metadata,teamId:scope.teamId,keyEpoch:scope.keyEpoch,keyId:scope.keyId},undefined,()=>{assertCurrent();generationContext.assertCurrent();},guard);
  } else {
    memoryRef = await createPersonalMemory({ uid, text, title: chosenTitle, metadata }, undefined,
      () => { assertCurrent(); generationContext?.assertCurrent(); });
  }
  await guard();

  if (allConnections.length) {
    for (const memoryId of allConnections) {
      assertCurrent();
      await changePersonalConnection(uid,memoryRef.id,memoryId,'link',assertCurrent);
      await guard();
    }
  }

  let personalRevisionBaseline:PersonalRevisionBaseline|undefined;
  let personalRevisionUnavailable:true|undefined;
  let teamRevisionBaseline:TeamRevisionBaseline|undefined;
  let teamRevisionUnavailable:true|undefined;
  if(scope?.kind !== 'team' && (source === 'text-generation' || source === 'image-generation')){
    try{personalRevisionBaseline=await capturePersonalRevisionBaseline({uid,id:memoryRef.id,expected:{text,title:chosenTitle},assertCurrent:()=>{
      assertCurrent();generationContext?.assertCurrent();
    }});}catch{
      await guard();
      // Creation is already independently confirmed. Retain its ID and never imply it should be recreated.
      personalRevisionUnavailable=true;
    }
  }
  if(scope?.kind==='team'&&(source==='text-generation'||source==='image-generation')){
    try{teamRevisionBaseline=await captureTeamRevisionBaseline({uid,id:memoryRef.id,teamId:scope.teamId,keyEpoch:scope.keyEpoch,keyId:scope.keyId,expected:{text,title:chosenTitle,authorUid:uid},assertCurrent:()=>{assertCurrent();generationContext?.assertCurrent();}});}catch{await guard();teamRevisionUnavailable=true;}
  }
  await guard();
  return { id: memoryRef.id, processingMethod, ...(personalRevisionBaseline ? {personalRevisionBaseline} : {}),...(personalRevisionUnavailable?{personalRevisionUnavailable}:{}),...(teamRevisionBaseline?{teamRevisionBaseline}:{}),...(teamRevisionUnavailable?{teamRevisionUnavailable}:{}) };
};

export const reviseLearnedMemory = async (
  memoryId: string,
  uid: string,
  text: string,
  existingMemories: SessionData[] = [],
  generationContext?: AiGenerationContext,
  personalRevisionBaseline?: PersonalRevisionBaseline,
  teamRevisionBaseline?: TeamRevisionBaseline,
): Promise<void> => {
  await guardGeneration(uid, generationContext);
  if (generationContext?.scope.kind !== 'team') {
    if(!personalRevisionBaseline)throw new PersonalRevisionError('baseline');
    await revisePersonalLearnedMemory({ uid, id: memoryId, baseline:personalRevisionBaseline,assertCurrent: generationContext?.assertCurrent,
      prepare: async guard => {
        await guardGeneration(uid, generationContext); guard();
        let cognitive: Awaited<ReturnType<typeof cognitiveEngine.processMemory>> | null = null;
        try {
          const semanticGuard = () => { guard(); generationContext?.assertCurrent(); };
          const candidates = await generationCandidates(existingMemories, uid, semanticGuard, generationContext, memoryId);
          cognitive = await cognitiveEngine.processMemory(text, candidates, { assertCurrent: semanticGuard });
        } catch {
          guard(); console.warn('Learned memory revised without semantic refresh.');
        }
        await guardGeneration(uid, generationContext); guard();
        return { text, title: cognitive ? cognitiveEngine.generateTitle(text) : null,
          embedding: cognitive?.embedding || null, embeddingModel: cognitive?.embeddingModel || null,
          semanticClusterId: cognitive?.semanticClusterId || null, position: cognitive?.position || null,
          importance: cognitive?.importance || 0.55,
          processingMethod: cognitive ? 'learned:revision+local-embedding' : 'learned:revision' };
      } });
    await guardGeneration(uid, generationContext); return;
  }
  const scope = generationContext?.scope;
  if(!generationContext||scope?.kind!=='team'||!teamRevisionBaseline||teamRevisionBaseline.teamId!==scope.teamId||teamRevisionBaseline.keyEpoch!==scope.keyEpoch||teamRevisionBaseline.keyId!==scope.keyId)throw new TeamRevisionError('baseline');
  await reviseTeamLearnedMemory({uid,id:memoryId,teamId:scope.teamId,baseline:teamRevisionBaseline,assertCurrent:generationContext.assertCurrent,prepare:async guard=>{
    await guardGeneration(uid,generationContext);guard();let cognitive:Awaited<ReturnType<typeof cognitiveEngine.processMemory>>|null=null;
    try{const semanticGuard=()=>{guard();generationContext.assertCurrent();};const candidates=await generationCandidates(existingMemories,uid,semanticGuard,generationContext,memoryId);cognitive=await cognitiveEngine.processMemory(text,candidates,{assertCurrent:semanticGuard});}catch{guard();console.warn('Learned team memory revised without semantic refresh.');}
    await guardGeneration(uid,generationContext);guard();return{text,title:cognitive?cognitiveEngine.generateTitle(text):null,embedding:cognitive?.embedding??null,embeddingModel:cognitive?.embeddingModel??null,semanticClusterId:cognitive?.semanticClusterId??null,position:cognitive?.position??null,importance:cognitive?.importance??0.55,processingMethod:cognitive?'learned:revision+local-embedding':'learned:revision'};
  }});

  await guardGeneration(uid, generationContext);
};

export const learnGeneratedText = async (
  uid: string,
  prompt: string,
  output: string,
  existingMemories: SessionData[] = [],
  generationContext?: AiGenerationContext,
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
  generationContext,
});

/** Importa o plano completo de uma cápsula com IDs/cifras e registo final recuperáveis. */
export const importCapsuleAsMemory = async (
  uid: string,
  payload: import('./capsuleImportRecovery').CapsuleImportPayload,
  existingMemories: SessionData[] = [],
  assertCurrent: () => void = () => {},
): Promise<LearnedMemoryResult & { importedCount: number; memoryIds: string[] }> => {
  const captured = structuredClone(payload);
  assertCurrent();
  const { importCapsuleRecoverably } = await import('./capsuleImportRecovery');
  assertCurrent();
  return importCapsuleRecoverably(uid, captured, existingMemories, assertCurrent);
};

export const learnGeneratedImage = async (
  uid: string,
  prompt: string,
  image: GeneratedImageResult,
  existingMemories: SessionData[] = [],
  generationContext?: AiGenerationContext,
): Promise<LearnedMemoryResult> => {
  await guardGeneration(uid, generationContext);
  const attachments: Attachment[] = [];
  if (image.dataUrl) {
    try {
      const file = await fileFromDataUrl(image.dataUrl, `mnemosyne-ai-${Date.now()}.png`);
      const pngFile = file.type === 'image/png'
        ? file
        : new File([file], file.name, { type: 'image/png', lastModified: file.lastModified });
      await guardGeneration(uid, generationContext);
      attachments.push(await uploadEncryptedAttachment({ file: pngFile, uid,
        teamId: generationContext?.scope.kind === 'team' ? generationContext.scope.teamId : undefined }));
      await guardGeneration(uid, generationContext);
    } catch (error) {
      if (generationContext) throw error;
      console.warn('AI image attachment not persisted.');
    }
  }

  return persistLearnedMemory({
    uid,
    text: [
      '[Imagem gerada e aprendida]',
      '',
      `Prompt: ${prompt}`,
      image.revisedPrompt ? `Prompt revisto: ${image.revisedPrompt}` : null,
      image.warning ? `Aviso: ${image.warning}` : null,
      attachments.length === 0 && image.dataUrl
        ? 'Nota: o anexo não foi guardado; a imagem permanece apenas na pré-visualização desta sessão.'
        : null,
    ].filter(Boolean).join('\n'),
    tags: ['imagem-gerada', 'geracao'],
    category: 'Gerações',
    attachments,
    existingMemories,
    source: 'image-generation',
    modality: 'image',
    provider: image.provider,
    model: image.model || null,
    generationContext,
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

export const learnDocumentBatch = async (uid: string, files: File[], existingMemories: SessionData[] = [], options?: {assertCurrent?:()=>void}): Promise<DocumentImportResult> => {
  const captured=[...files];
  return startCapturedDocumentImport(uid,guard=>buildDocumentImportPlan(uid,captured,existingMemories,guard),options?.assertCurrent);
};
