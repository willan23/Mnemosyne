import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, FolderOpen, Image as ImageIcon, Link2, Loader2, Search, SendHorizontal, Sparkles, UploadCloud, X } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { auth, db } from '../firebase';
import { arrayUnion, collection, addDoc, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { nvidiaApiService } from '../services/nvidiaApiService';
import type { NVIDIAExtractionResult } from '../services/nvidiaApiService';
import { getLocalAiConfig } from '../services/localAiConfig';
import { resolveAiFailureDecision, shouldUseNvidiaBackend } from '../services/aiSavePolicy';
import { generateImageFromPrompt, generateTextFromPrompt } from '../services/aiGenerationService';
import type { GeneratedImageResult } from '../services/aiGenerationService';
import { learnDocumentBatch, learnGeneratedImage, learnGeneratedText, reviseLearnedMemory } from '../services/learningService';
import { isTauriRuntime, selectAndReadTauriDirectory } from '../utils/tauriFolderImporter';
import { parseAiCommand } from '../services/aiCommandParser';
import { cognitiveEngine } from '../engines/CognitiveEngine';
import type { MemoryObject } from '../types/universe';
import type { SessionData } from '../hooks/useSessions';
import { useSubscription } from '../hooks/useSubscription';
import { isFreeFirstMode } from '../config/monetization';
import { FAIR_USE } from '../config/fairUse';
import { uploadFile } from '../utils/storage';
import { useTranslation } from '../utils/translations';
import { searchMemories } from '../utils/searchMemories';
import toast from 'react-hot-toast';

const FLOW_DRAFT_KEY = 'mnemosyne.flow.draft';

interface CognitiveInputProps {
  onWebResearchCommand?: (query: string) => void;
  existingMemories?: SessionData[];
  onClose?: () => void;
  onMemoryCreated?: (memoryId: string) => void;
}

function memoryPreviewLabel(memory: SessionData): string {
  const title = memory.title?.trim();
  if (title) return title.length > 42 ? `${title.slice(0, 41)}…` : title;
  const text = (memory.text || '').replace(/\s+/g, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 41)}…` : text || 'Memória';
}

function scoreTextOverlap(a: string, b: string): number {
  const tokens = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4);
  const aSet = new Set(tokens(a));
  if (aSet.size === 0) return 0;
  const bTokens = tokens(b);
  if (bTokens.length === 0) return 0;
  let hits = 0;
  for (const t of bTokens) if (aSet.has(t)) hits += 1;
  return hits / Math.max(aSet.size, 1);
}

export const CognitiveInput: React.FC<CognitiveInputProps> = ({
  onWebResearchCommand,
  existingMemories = [],
  onClose,
  onMemoryCreated,
}) => {
  const { t } = useTranslation();
  const [text, setText] = useState(() => {
    try {
      return sessionStorage.getItem(FLOW_DRAFT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [isFocused, setIsFocused] = useState(true);
  const [showSerendipity, setShowSerendipity] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<GeneratedImageResult | null>(null);
  const [generatedImagePrompt, setGeneratedImagePrompt] = useState('');
  const [learnedGenerationId, setLearnedGenerationId] = useState<string | null>(null);
  const [lastSavedMeta, setLastSavedMeta] = useState<{ links: number; title?: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { canCreateMemory, getRemainingMemories, isLoading: isSubscriptionLoading } = useSubscription();

  useEffect(() => {
    const id = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    try {
      if (text.trim()) sessionStorage.setItem(FLOW_DRAFT_KEY, text);
      else sessionStorage.removeItem(FLOW_DRAFT_KEY);
    } catch {
      // ignore
    }
  }, [text]);

  const relatedPreview = useMemo(() => {
    const draft = text.trim();
    if (draft.length < 12) return [];
    // Motor de pesquisa unificado (mesmos ecos que a palette)
    const hits = searchMemories(existingMemories, draft, { limit: 4, semanticFloor: 0.4 });
    if (hits.length > 0) {
      return hits.map((hit) => ({
        memory: existingMemories.find((m) => m.id === hit.memory.id) || (hit.memory as SessionData),
        score: hit.score,
      }));
    }
    // Fallback lexical local
    return existingMemories
      .map((memory) => ({
        memory,
        score: Math.max(
          scoreTextOverlap(draft, memory.text || ''),
          scoreTextOverlap(draft, memory.title || ''),
        ),
      }))
      .filter((item) => item.score >= 0.12)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }, [text, existingMemories]);

  const isIgnoredFileOrPath = (path: string, fileName: string) => {
    if (!path) return fileName.startsWith('.') || fileName === 'thumbs.db' || fileName === 'desktop.ini';
    const segments = path.toLowerCase().split('/');
    const ignorePatterns = ['.git', 'node_modules', '.next', 'dist', 'build', '.vscode', '.idea', 'target', 'vendor', '__pycache__'];
    return segments.some(segment => segment.startsWith('.') || ignorePatterns.includes(segment)) || fileName.startsWith('.') || fileName === 'thumbs.db' || fileName === 'desktop.ini';
  };

  const handleFolderInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!auth.currentUser || files.length === 0) return;
    
    let eligibleFiles = files.filter(file => {
      const path = file.webkitRelativePath || file.name;
      return file.size > 0 && !isIgnoredFileOrPath(path, file.name);
    });
    
    if (eligibleFiles.length === 0) {
      toast.error(t('noFilesFound'));
      return;
    }
    
    if (eligibleFiles.length > 20) {
      toast(t('folderLimitWarning'), { icon: '⚠️' });
      eligibleFiles = eligibleFiles.slice(0, FAIR_USE.maxImportBatchFiles);
    }
    
    setIsImportingFiles(true);
    const importToast = toast.loading(t('organizingFolders'));
    try {
      const result = await learnDocumentBatch(auth.currentUser.uid, eligibleFiles, existingMemories);
      toast.success(t('foldersLearnedSuccess', { count: result.imported }), { id: importToast });
    } catch (error) {
      toast.error(t('foldersLearnedError'), { id: importToast });
    } finally {
      setIsImportingFiles(false);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const triggerFolderImport = async () => {
    if (isTauriRuntime()) {
      if (!auth.currentUser) return;
      setIsImportingFiles(true);
      const importToast = toast.loading(t('organizingFolders'));
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          directory: true,
          multiple: false,
        });
        if (!selected) {
          toast.dismiss(importToast);
          return;
        }

        const importedFiles = await selectAndReadTauriDirectory(selected);

        if (importedFiles.length === 0) {
          toast.error(t('noFilesFound'), { id: importToast });
          return;
        }

        let finalFiles = importedFiles;
        if (importedFiles.length > 20) {
          toast(t('folderLimitWarning'), { icon: '⚠️' });
          finalFiles = importedFiles.slice(0, FAIR_USE.maxImportBatchFiles);
        }

        const result = await learnDocumentBatch(auth.currentUser.uid, finalFiles, existingMemories);
        toast.success(t('foldersLearnedSuccess', { count: result.imported }), { id: importToast });
      } catch (error) {
        console.error('Erro ao assimilar pasta via Tauri:', error);
        toast.error(t('foldersLearnedError'), { id: importToast });
      } finally {
        setIsImportingFiles(false);
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  const { isCommandPaletteOpen } = useUI();

  const resizeTextarea = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
  }, []);

  const loadExistingMemories = async (uid: string): Promise<MemoryObject[]> => {
    const snapshot = await getDocs(query(collection(db, 'sessions'), where('uid', '==', uid)));
    return snapshot.docs.map((sessionDoc) => {
      const data = sessionDoc.data();
      const embedding = Array.isArray(data.embedding) ? data.embedding : [];
      const position = Array.isArray(data.position) && data.position.length === 3 ? data.position : [0, 0, 0];
      return {
        id: sessionDoc.id,
        text: data.text || '',
        title: data.title,
        celestialType: data.celestialType || 'planet',
        position,
        embedding,
        connections: Array.isArray(data.connections) ? data.connections : [],
        semanticClusterId: typeof data.semanticClusterId === 'string' ? data.semanticClusterId : undefined,
        importance: typeof data.importance === 'number' ? data.importance : 0.5,
        timestamp: data.timestamp || 0,
        updatedAt: data.updatedAt || data.timestamp || 0,
        uid: data.uid,
        tags: data.tags,
        category: data.category,
      } as MemoryObject;
    });
  };

  // Heurística de digitação
  useEffect(() => {
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount > 3) setShowSerendipity(true);
    else setShowSerendipity(false);

    resizeTextarea();
  }, [text, resizeTextarea]);

  useEffect(() => {
    window.addEventListener('resize', resizeTextarea);
    return () => window.removeEventListener('resize', resizeTextarea);
  }, [resizeTextarea]);

  const focusComposer = () => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const insertCommand = (template: string) => {
    setGeneratedImage(null);
    setGeneratedImagePrompt('');
    setLearnedGenerationId(null);
    setText(template);
    setIsFocused(true);
    focusComposer();
  };

  const handleTextChange = (value: string) => {
    if (!value.trim()) {
      setGeneratedImage(null);
      setGeneratedImagePrompt('');
      setLearnedGenerationId(null);
    }
    setText(value);
  };

  const importFiles = async (files: File[]) => {
    if (!auth.currentUser || files.length === 0) return;
    setIsImportingFiles(true);
    const importToast = toast.loading(t('organizingFiles', { count: files.length }));
    try {
      const result = await learnDocumentBatch(auth.currentUser.uid, files, existingMemories);
      toast.success(t('filesLearnedSuccess', { count: result.imported }), { id: importToast });
    } catch (error) {
      toast.error(t('filesLearnedError'), { id: importToast });
    } finally {
      setIsImportingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await importFiles(Array.from(event.target.files || []));
  };

  const generatedImageSrc = generatedImage?.dataUrl || generatedImage?.imageUrl;

  const fileFromDataUrl = async (dataUrl: string, filename: string): Promise<File> => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type || 'image/png', lastModified: Date.now() });
  };

  const uploadGeneratedImage = async (): Promise<Array<{ type: 'image'; url: string; name: string; size?: number }>> => {
    if (!generatedImage || !auth.currentUser) return [];
    if (generatedImage.dataUrl) {
      const file = await fileFromDataUrl(generatedImage.dataUrl, `mnemosyne-ai-${Date.now()}.png`);
      const url = await uploadFile(file, auth.currentUser.uid);
      return [{ type: 'image', url, name: file.name, size: file.size }];
    }
    if (generatedImage.imageUrl) {
      return [{ type: 'image', url: generatedImage.imageUrl, name: `mnemosyne-ai-${Date.now()}.png` }];
    }
    return [];
  };

  const handleSave = async () => {
    if (!text.trim() || !auth.currentUser) return;

    const parsedCommand = parseAiCommand(text.trim());
    if (parsedCommand.type === 'web-research') {
      onWebResearchCommand?.(parsedCommand.query);
      setText('');
      setShowSerendipity(false);
      setIsFocused(false);
      textareaRef.current?.blur();
      return;
    }

    if (parsedCommand.type === 'text-generation') {
      setIsSaving(true);
      try {
        const generated = await generateTextFromPrompt(parsedCommand.prompt);
        if (!generated) throw new Error('A IA não devolveu texto.');
        const learned = await learnGeneratedText(auth.currentUser.uid, parsedCommand.prompt, generated, existingMemories);
        setLearnedGenerationId(learned.id);
        setGeneratedImage(null);
        setGeneratedImagePrompt('');
        setText(generated);
        toast.success('Texto gerado e aprendido. Revê e usa Ctrl+Enter para atualizar a memória.');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível gerar texto.');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const isImageGenerationCommand = parsedCommand.type === 'image-generation';
    if (isImageGenerationCommand) {
      setIsSaving(true);
      try {
        const image = await generateImageFromPrompt(parsedCommand.prompt);
        setGeneratedImage(image);
        setGeneratedImagePrompt(parsedCommand.prompt);
        const learned = await learnGeneratedImage(auth.currentUser.uid, parsedCommand.prompt, image, existingMemories);
        setLearnedGenerationId(learned.id);
        setText(`[Imagem gerada]\n\nPrompt: ${parsedCommand.prompt}`);
        setShowSerendipity(true);
        toast.success('Imagem gerada e aprendida. Podes editar a nota e enviar para atualizar.');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Não foi possível gerar a imagem.');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const memoryText = (parsedCommand.type === 'memory-create' ? parsedCommand.text : text).trim();

    if (learnedGenerationId) {
      setIsSaving(true);
      try {
        await reviseLearnedMemory(learnedGenerationId, auth.currentUser.uid, memoryText, existingMemories);
        setText('');
        setShowSerendipity(false);
        setIsFocused(false);
        setGeneratedImage(null);
        setGeneratedImagePrompt('');
        setLearnedGenerationId(null);
        textareaRef.current?.blur();
        toast.success('Aprendizagem atualizada.');
      } catch (error) {
        console.error('Unable to revise learned generation:', error);
        toast.error('Não foi possível atualizar a memória aprendida.');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    if (isSubscriptionLoading) return;
    if (!canCreateMemory()) {
      const remaining = getRemainingMemories();
      toast.error(
        isFreeFirstMode
          ? 'Limite técnico temporário atingido. Tenta novamente mais tarde.'
          : remaining === 0
          ? 'Limite mensal de memórias atingido. Faz upgrade para continuar.'
          : 'O teu plano atual não permite criar esta memória.'
      );
      return;
    }

    setIsSaving(true);
    try {
      let extraction: NVIDIAExtractionResult = { nodes: [], links: [] };
      let processingMethod = 'manual';
      const aiConfig = getLocalAiConfig();
      const aiErrors: string[] = [];
      let cognitive: Awaited<ReturnType<typeof cognitiveEngine.processMemory>> | null = null;
      const existingMemories = await loadExistingMemories(auth.currentUser.uid);

      try {
        cognitive = await cognitiveEngine.processMemory(memoryText, existingMemories);
        processingMethod = 'local-embedding';
      } catch (error) {
        console.warn('Embedding/autolink unavailable:', error);
        aiErrors.push(error instanceof Error ? `Embeddings locais: ${error.message}` : 'Embeddings locais indisponíveis.');
        toast('Embedding local indisponível. A memória será guardada sem ligações semânticas.', {
          icon: '!',
          style: {
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)'
          }
        });
      }

      if (shouldUseNvidiaBackend(
        aiConfig,
        () => confirm('Usar o backend NVIDIA NIM para processar esta memória? O texto será enviado ao teu backend configurado.')
      )) {
          try {
            extraction = await nvidiaApiService.extract(memoryText);
            processingMethod = cognitive ? 'local-embedding+nvidia-nim' : 'nvidia-nim';
          } catch (error) {
            aiErrors.push(error instanceof Error ? `NVIDIA NIM: ${error.message}` : 'Backend NVIDIA NIM indisponível.');
            toast('Backend de IA indisponível. A memória será guardada sem grafo extraído.', {
              icon: '!',
              style: {
                background: 'rgba(0,0,0,0.8)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)'
              }
            });
          }
      }

      if (aiErrors.length > 0) {
        const summary = aiErrors.join('\n');
        const failureDecision = resolveAiFailureDecision(
          aiConfig,
          aiErrors,
          () => confirm(`A IA configurada falhou:\n\n${summary}\n\nGuardar a memória sem este enriquecimento?`)
        );
        if (failureDecision === 'block-save') {
          toast.error('A política atual bloqueia guardar quando a IA configurada falha.');
          throw new Error(`IA configurada falhou:\n${summary}`);
        }
        if (failureDecision === 'skip-save') return;
      }
      
      // Mapear para o formato esperado pelo Firestore (links precisam ser simples)
      const nodes = extraction.nodes;
      const links = extraction.links;
      const generatedAttachments = await uploadGeneratedImage();

      const memoryRef = await addDoc(collection(db, "sessions"), {
        text: memoryText,
        title: cognitive ? cognitiveEngine.generateTitle(memoryText) : null,
        timestamp: Date.now(),
        updatedAt: Date.now(),
        uid: auth.currentUser.uid,
        nodes: nodes.length > 0 ? nodes : null,
        links: links.length > 0 ? links : null,
        embedding: cognitive?.embedding || null,
        connections: cognitive?.connections || [],
        semanticClusterId: cognitive?.semanticClusterId || null,
        position: cognitive?.position || null,
        importance: cognitive?.importance || 0.5,
        celestialType: cognitive?.celestialType || null,
        tags: generatedImage ? ['image-generation', 'imagem-gerada'] : null,
        attachments: generatedAttachments.length > 0 ? generatedAttachments : null,
        generatedImagePrompt: generatedImage ? generatedImagePrompt || null : null,
        generatedImageProvider: generatedImage?.provider || null,
        generatedImageModel: generatedImage?.model || null,
        processingMethod
      });

      if (cognitive?.connections.length) {
        await Promise.all(cognitive.connections.map((memoryId) => (
          updateDoc(doc(db, 'sessions', memoryId), {
            connections: arrayUnion(memoryRef.id),
            updatedAt: Date.now(),
          }).catch((error) => console.warn('Unable to back-link memory', memoryId, error))
        )));
      }

      const linkCount = cognitive?.connections.length || 0;
      const title = cognitive ? cognitiveEngine.generateTitle(memoryText) : undefined;
      setLastSavedMeta({ links: linkCount, title: title || undefined });
      setText('');
      setShowSerendipity(false);
      setIsFocused(true);
      setGeneratedImage(null);
      setGeneratedImagePrompt('');
      setLearnedGenerationId(null);
      try { sessionStorage.removeItem(FLOW_DRAFT_KEY); } catch { /* ignore */ }
      onMemoryCreated?.(memoryRef.id);
      toast.success(
        linkCount > 0
          ? `Memória cristalizada · ${linkCount} ligação${linkCount === 1 ? '' : 'ões'} semântica${linkCount === 1 ? '' : 's'}`
          : 'Pensamento cristalizado no teu universo.',
        {
          icon: '✨',
          style: {
            background: 'rgba(0,0,0,0.85)',
            color: '#fff',
            border: '1px solid rgba(34,211,238,0.25)',
          },
        }
      );
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch {
      toast.error('Erro ao formar memória.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
        setIsFocused(false);
        textareaRef.current?.blur();
        if (!text.trim()) onClose?.();
    }
  };

  const parsedCommand = parseAiCommand(text.trim());
  const isFlowModeActive = isFocused || text.length > 0;
  const canSubmit = text.trim().length > 0 && !isCommandPaletteOpen && !isSaving && !isImportingFiles && !isSubscriptionLoading;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const flowModeLabel =
    parsedCommand.type === 'web-research' ? 'Pesquisa web' :
    parsedCommand.type === 'text-generation' ? 'Gerar texto' :
    parsedCommand.type === 'image-generation' ? 'Pedido de imagem' :
    parsedCommand.type === 'memory-create' ? 'Memória' :
    'Captura livre';
  const flowModeHint =
    parsedCommand.type === 'web-research' ? 'Enter envia a pesquisa para o painel Web' :
    parsedCommand.type === 'image-generation' ? 'Ctrl+Enter gera e aprende a imagem' :
    parsedCommand.type === 'text-generation' ? 'Ctrl+Enter gera texto com IA' :
    'Ctrl+Enter cristaliza · Esc fecha';

  const chipClass =
    'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50';

  const modeTone =
    parsedCommand.type === 'web-research'
      ? 'border-sky-400/30 bg-sky-500/15 text-sky-100'
      : parsedCommand.type === 'image-generation'
      ? 'border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-100'
      : parsedCommand.type === 'text-generation'
      ? 'border-amber-400/30 bg-amber-500/15 text-amber-100'
      : 'border-cyan-400/20 bg-cyan-500/10 text-cyan-100/90';

  const remainingMemories = !isFreeFirstMode ? getRemainingMemories() : null;
  const hasDraft = text.trim().length > 0;

  return (
    <>
      <AnimatePresence>
        {isFlowModeActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[22rem] bg-gradient-to-t from-[#020617]/95 via-[#020617]/50 to-transparent"
          />
        )}
      </AnimatePresence>

      <div className="pointer-events-none fixed inset-x-0 bottom-[6.75rem] z-40 flex justify-center px-3 sm:bottom-[7.25rem] sm:px-4">
        <motion.div
          layout
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className={`mnem-flow-panel pointer-events-auto w-full max-w-3xl overflow-hidden rounded-2xl border backdrop-blur-2xl transition-all duration-300 ${
            isFlowModeActive
              ? 'border-cyan-300/25 bg-[#07101f]/94 shadow-[0_24px_90px_rgba(0,0,0,0.5),0_0_48px_rgba(34,211,238,0.14)]'
              : 'border-white/10 bg-[#07101f]/82 shadow-[0_18px_60px_rgba(0,0,0,0.35)]'
          }`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 p-2">
                <Sparkles className="h-4 w-4 text-cyan-200" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold leading-none text-slate-50">Flow</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${modeTone}`}>
                    {flowModeLabel}
                  </span>
                  {hasDraft && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                      rascunho
                    </span>
                  )}
                  {remainingMemories != null && remainingMemories >= 0 && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-500">
                      {remainingMemories} rest.
                    </span>
                  )}
                </div>
                <p className="mt-1.5 truncate text-xs text-slate-400">{flowModeHint}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-slate-400 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              aria-label="Fechar Flow"
              title="Fechar Flow (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Action chips — always visible, scroll on mobile */}
          <div className="mnem-scroll flex gap-2 overflow-x-auto border-b border-white/[0.04] px-3 py-2.5">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('')} className={chipClass}>
              <FileText className="h-3.5 w-3.5" /> Livre
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('guardar memória: ')} className={chipClass}>
              <FileText className="h-3.5 w-3.5" /> Memória
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('pesquisa na web sobre ')} className={chipClass}>
              <Search className="h-3.5 w-3.5" /> Web
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('gera uma imagem de ')} className={chipClass}>
              <ImageIcon className="h-3.5 w-3.5" /> Imagem
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('gera um texto sobre ')} className={chipClass}>
              <Sparkles className="h-3.5 w-3.5" /> IA texto
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fileInputRef.current?.click()} disabled={isImportingFiles} className={chipClass}>
              {isImportingFiles ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
              Ficheiros
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={triggerFolderImport} disabled={isImportingFiles} className={chipClass}>
              <FolderOpen className="h-3.5 w-3.5" /> Pasta
            </button>
          </div>

          {!hasDraft && (
            <div className="border-b border-white/[0.04] px-4 py-2 text-[11px] leading-relaxed text-slate-500">
              Escreve livremente, usa chips de comando, ou arrasta ficheiros para o grafo.
              Pensamentos ligam-se sozinhos quando cristalizam.
            </div>
          )}

          <div className="flex items-end gap-2 p-3 sm:gap-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,text/*,application/pdf,image/*,audio/*,video/*"
              onChange={handleFileInputChange}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              {...({ webkitdirectory: '', directory: '', multiple: true } as React.InputHTMLAttributes<HTMLInputElement>)}
              onChange={handleFolderInputChange}
              className="hidden"
            />
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => !text && setIsFocused(false)}
              onKeyDown={handleKeyDown}
              disabled={isCommandPaletteOpen || isSaving || isSubscriptionLoading}
              placeholder={t('flowPlaceholder') || 'Escreve um pensamento, ideia ou comando…'}
              className="min-h-[3.25rem] max-h-48 flex-1 resize-none overflow-y-auto rounded-xl border border-white/5 bg-black/25 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35 focus:bg-black/35 focus:ring-2 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50 mnem-scroll"
              rows={2}
            />

            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void handleSave()}
              disabled={!canSubmit}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-gradient-to-br from-cyan-400/20 to-violet-500/20 text-cyan-50 transition hover:from-cyan-400/30 hover:to-violet-500/30 disabled:cursor-not-allowed disabled:border-white/5 disabled:from-transparent disabled:to-transparent disabled:bg-white/[0.03] disabled:text-slate-500"
              aria-label="Cristalizar pensamento"
              title="Cristalizar (Ctrl+Enter)"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] px-4 py-2 text-[11px] text-slate-500">
            <span>
              {wordCount > 0 ? `${wordCount} palavra${wordCount === 1 ? '' : 's'}` : 'Vazio'}
              {text.length > 0 ? ` · ${text.length} chars` : ''}
              {relatedPreview.length > 0 ? ` · ~${relatedPreview.length} eco(s)` : ''}
            </span>
            <span className="hidden sm:inline">Ctrl+Enter · Esc</span>
          </div>

          <AnimatePresence>
            {relatedPreview.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t border-white/[0.06] px-3 pb-3"
              >
                <p className="mb-2 flex items-center gap-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  <Link2 className="h-3 w-3" /> Possíveis ecos no teu grafo
                </p>
                <div className="flex flex-wrap gap-2">
                  {relatedPreview.map(({ memory, score }) => (
                    <button
                      key={memory.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onMemoryCreated?.(memory.id)}
                      className="max-w-full truncate rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[11px] text-violet-100/90 transition hover:border-violet-300/40 hover:bg-violet-500/20"
                      title={memory.text?.slice(0, 160)}
                    >
                      {memoryPreviewLabel(memory)}
                      <span className="ml-1.5 font-mono text-[9px] text-violet-200/50">
                        {Math.round(score * 100)}%
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {lastSavedMeta && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                onAnimationComplete={() => {
                  window.setTimeout(() => setLastSavedMeta(null), 4200);
                }}
                className="border-t border-emerald-400/15 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-100"
              >
                Cristalizado
                {lastSavedMeta.title ? `: ${lastSavedMeta.title}` : ''}
                {lastSavedMeta.links > 0
                  ? ` · ${lastSavedMeta.links} ligação${lastSavedMeta.links === 1 ? '' : 'ões'}`
                  : ' · sem ligações ainda'}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {generatedImageSrc && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t border-white/[0.06] px-3 pb-3"
              >
                <div className="mt-2 flex gap-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] p-3">
                  <img
                    src={generatedImageSrc}
                    alt="Imagem gerada pela IA"
                    className="h-20 w-20 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-cyan-100">Imagem pronta</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                      {generatedImagePrompt || generatedImage?.revisedPrompt || 'Resultado visual gerado pela IA.'}
                    </p>
                    <p className="mt-2 text-[11px] text-slate-500">
                      {generatedImage?.provider}
                      {generatedImage?.model ? ` · ${generatedImage.model}` : ''}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showSerendipity && !relatedPreview.length && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t border-white/[0.06] px-3 pb-3 pt-1 text-[11px] leading-relaxed text-slate-500"
              >
                Continua a escrever — o Flow deteta comandos (web, imagem, texto) e prepara ligações semânticas ao cristalizar.
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
};
