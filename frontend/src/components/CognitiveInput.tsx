import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, FolderOpen, Image as ImageIcon, Link2, Loader2, Search, SendHorizontal, Sparkles, UploadCloud, Users, X } from 'lucide-react';
import { useUI } from '../contexts/UIContext';
import { auth } from '../firebase';
import { getLocalAiConfig } from '../services/localAiConfig';
import { resolveAiFailureDecision } from '../services/aiSavePolicy';
import { generateImageFromPrompt, generateTextFromPrompt } from '../services/aiGenerationService';
import { withAiGenerationContext } from '../services/aiGenerationContext';
import { learnDocumentBatch, learnGeneratedImage, learnGeneratedText, reviseLearnedMemory } from '../services/learningService';
import {
  importObsidianVault,
  looksLikeObsidianVault,
} from '../services/obsidianVaultImport';
import { MemoryCryptoLockedError } from '../services/memoryCrypto';
import { useMyTeams } from '../hooks/useMyTeams';
import { ATTACHMENT_WRITES_ENABLED, ATTACHMENT_READ_ONLY_MESSAGE, TEAM_WRITES_ENABLED } from '../config/releaseGates';
import { isTauriRuntime, selectAndReadTauriDirectory } from '../utils/tauriFolderImporter';
import { parseAiCommand } from '../services/aiCommandParser';
import { cognitiveEngine } from '../engines/CognitiveEngine';
import type { SessionData } from '../hooks/useSessions';
import { useSubscription } from '../hooks/useSubscription';
import { isFreeFirstMode } from '../config/monetization';
import { FAIR_USE } from '../config/fairUse';
import { describeUploadError } from '../utils/storage';
import { uploadEncryptedAttachment } from '../services/attachmentUploadClient';
import { createMemoryWithAttachments, createPersonalMemory,createTeamMemory,assertTeamMemoryCreationEnabled, hasPendingAttachedMemoryCreation, assertPersonalMemoryCreationEnabled } from '../services/attachedMemoryRecovery';
import type { Attachment } from '../types/attachments';
import { DOCUMENT_FILE_ACCEPT } from '../utils/fileTypes';
import { useTranslation } from '../utils/translations';
import { semanticCandidateEligibility } from '../services/semanticWriteScope';
import { useCapturePreview } from '../hooks/useCapturePreview';
import toast from 'react-hot-toast';
import { OPEN_CAPTURE_EVENT, notifyCaptureActive } from '../utils/desktopCapture';
import { ImageLightbox } from './ImageLightbox';
import { ClipCaptureRecoveryPanel } from './ClipCaptureRecoveryPanel';
import {PersonalConnectionRecoveryPanel} from './PersonalConnectionRecoveryPanel';
import {ObsidianImportRecoveryPanel} from './ObsidianImportRecoveryPanel';
import {DocumentImportRecoveryPanel} from './DocumentImportRecoveryPanel';
import {PersonalRevisionRecoveryPanel} from './PersonalRevisionRecoveryPanel';
import {TeamRevisionRecoveryPanel} from './TeamRevisionRecoveryPanel';
import {hasPendingTeamRevision} from '../services/teamRevisionRecovery';
import {CommsImportRecoveryPanel} from './CommsImportRecoveryPanel';
import {CommsIdentityRolloverPanel} from './CommsIdentityRolloverPanel';
import {CommsContactRecoveryPanel} from './CommsContactRecoveryPanel';
import {CommsDeliveryRecoveryPanel} from './CommsDeliveryRecoveryPanel';
import {CommsP2PRecoveryPanel} from './CommsP2PRecoveryPanel';
import {CommsP2PContentRecoveryPanel} from './CommsP2PContentRecoveryPanel';
import {hasPendingPersonalRevision} from '../services/personalLearnedRevision';
import {useCognitiveDraft} from '../hooks/useCognitiveDraft';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {withPersonalMemoryMutation} from '../services/personalMemoryMutation';

interface CognitiveInputProps {
  onWebResearchCommand?: (query: string) => void;
  existingMemories?: readonly SessionData[];
  onClose?: () => void;
  onMemoryCreated?: (memoryId: string) => void;
  mnemonic?: string[] | null;
}

function memoryPreviewLabel(memory: SessionData): string {
  const title = memory.title?.trim();
  if (title) return title.length > 42 ? `${title.slice(0, 41)}…` : title;
  const text = (memory.text || '').replace(/\s+/g, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 41)}…` : text || 'Memória';
}

export const CognitiveInput: React.FC<CognitiveInputProps> = ({
  onWebResearchCommand,
  existingMemories = [],
  onClose,
  onMemoryCreated,
  mnemonic = null,
}) => {
  const { t } = useTranslation();
  const importFeedback=useSyncFeedback();
  const uid = auth.currentUser?.uid ?? null;
  const teams = useMyTeams(uid);
  const draft=useCognitiveDraft(teams);
  const {text,setText,generatedImage,setGeneratedImage,generatedImagePrompt,setGeneratedImagePrompt,
    learnedGeneration,setLearnedGeneration,targetTeamId,setTargetTeamId}=draft;
  const [legacyDraft,setLegacyDraft]=useState(()=>{try{return sessionStorage.getItem('mnemosyne.flow.draft')!==null;}catch{return false;}});
  const discardLegacyDraft=()=>{
    if(!uid)return;const current=importFeedback.capture(uid);if(!current())return;
    if(!window.confirm('Eliminar o rascunho antigo sem vínculo à conta neste separador? O conteúdo não será recuperado nem atribuído automaticamente à conta atual.'))return;
    if(!current())return;try{sessionStorage.removeItem('mnemosyne.flow.draft');if(sessionStorage.getItem('mnemosyne.flow.draft')===null)setLegacyDraft(false);}catch{toast.error('Não foi possível eliminar o rascunho antigo.');}
  };
  const [isFocused, setIsFocused] = useState(false);
  const [showSerendipity, setShowSerendipity] = useState(false);
  const [savingState,setSavingState]=useState({scope:draft.scope,value:false});
  const isSaving=savingState.scope===draft.scope&&savingState.value;
  const setIsSaving=(value:boolean)=>setSavingState(old=>!value&&old.scope!==draft.scope?old:{scope:draft.scope,value});
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const [lightbox,setLightbox]=useState<{scope:string;src:string|null}>({scope:draft.scope,src:null});
  const lightboxSrc=lightbox.scope===draft.scope&&draft.ready?lightbox.src:null;
  const setLightboxSrc=(src:string|null)=>setLightbox({scope:draft.scope,src});
  const [savedMeta,setSavedMeta]=useState<{scope:string;value:{links:number;title?:string}|null}>({scope:draft.scope,value:null});
  const lastSavedMeta=savedMeta.scope===draft.scope&&draft.ready?savedMeta.value:null;
  const setLastSavedMeta=(value:{links:number;title?:string}|null)=>setSavedMeta(old=>value===null&&old.scope!==draft.scope?old:{scope:draft.scope,value});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderActorRef=useRef<{uid:string;current:()=>boolean}|null>(null);
  const { canCreateMemory, getRemainingMemories, isLoading: isSubscriptionLoading } = useSubscription();
  /** Mantém o painel montado enquanto o file picker nativo está aberto (senão o input some e onChange nunca corre). */
  const [isPickingFiles, setIsPickingFiles] = useState(false);

  useEffect(() => {
    if (!isPickingFiles) return;
    const onWindowFocus = () => {
      window.setTimeout(() => setIsPickingFiles(false), 400);
    };
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, [isPickingFiles]);

  useEffect(() => {
    const focusComposer = () => {
      setIsFocused(true);
      window.setTimeout(() => textareaRef.current?.focus(), 30);
    };
    window.addEventListener(OPEN_CAPTURE_EVENT, focusComposer);
    return () => window.removeEventListener(OPEN_CAPTURE_EVENT, focusComposer);
  }, []);

  useEffect(() => {
    notifyCaptureActive(isFocused);
    return () => notifyCaptureActive(false);
  }, [isFocused]);

  const previewTeam = targetTeamId ? teams.find(team => team.id === targetTeamId) : undefined;
  const previewAllowed = Boolean(draft.ready && uid && (!targetTeamId ||
    previewTeam?.memberUids?.includes(uid) && previewTeam.keyRotationStatus === 'active'));
  const previewEpoch = previewTeam?.activeKeyEpoch, previewKey = previewTeam?.activeKeyId;
  const previewScope = useMemo(() => previewAllowed && uid ? { uid, teamId: targetTeamId || undefined,
    key: JSON.stringify([draft.scope, uid, targetTeamId, previewEpoch, previewKey]) } : null,
  [previewAllowed, uid, targetTeamId, draft.scope, previewEpoch, previewKey]);
  const relatedPreview = useCapturePreview(existingMemories, text, previewScope);

  const isIgnoredFileOrPath = (path: string, fileName: string) => {
    if (!path) return fileName.startsWith('.') || fileName === 'thumbs.db' || fileName === 'desktop.ini';
    const segments = path.toLowerCase().split('/');
    const ignorePatterns = ['.git', 'node_modules', '.next', 'dist', 'build', '.vscode', '.idea', 'target', 'vendor', '__pycache__'];
    return segments.some(segment => segment.startsWith('.') || ignorePatterns.includes(segment)) || fileName.startsWith('.') || fileName === 'thumbs.db' || fileName === 'desktop.ini';
  };

  const ensureCanImport = (): boolean => {
    if (!auth.currentUser) {
      toast.error(t('appNeedMind'));
      return false;
    }
    if (!mnemonic || mnemonic.length !== 12) {
      toast.error(t('appNeedMind'));
      return false;
    }
    return true;
  };

  const handleFolderInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsPickingFiles(false);
    const picked=folderActorRef.current;folderActorRef.current=null;
    if(picked&&!picked.current()){event.target.value='';return;}
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    if (!ensureCanImport() || !auth.currentUser) return;

    const eligibleFiles = files.filter((file) => {
      const path = file.webkitRelativePath || file.name;
      return file.size > 0 && !isIgnoredFileOrPath(path, file.name);
    });

    if (eligibleFiles.length === 0) {
      toast.error(t('noFilesFound'));
      if (folderInputRef.current) folderInputRef.current.value = '';
      return;
    }

    if (looksLikeObsidianVault(eligibleFiles)) {
      const actor=picked?.uid??auth.currentUser.uid;const current=picked?.current??importFeedback.capture(actor);
      setIsImportingFiles(true);
      const importToast = toast.loading(t('appVaultLoading'));
      try {
        const result = await importObsidianVault(actor, eligibleFiles, existingMemories,{assertCurrent:()=>{if(!current())throw new Error('Import context unavailable');}});
        if(!current())return;
        toast.success(
          t('appVaultDone', {
            count: result.imported,
            links: result.linked,
            stats: result.statsLabel,
          }),
          { id: importToast },
        );
        if (result.memoryIds[0]) onMemoryCreated?.(result.memoryIds[0]);
      } catch {
        if(current())toast.error('Importação não concluída. Usa a recuperação de importações para retomar o plano cifrado ou cancelar os passos restantes.', { id: importToast });
      } finally {
        setIsImportingFiles(false);setIsPickingFiles(false);
        if(current()){
          if (folderInputRef.current) folderInputRef.current.value = '';
        }else toast.dismiss(importToast);
      }
      return;
    }

    let batch = eligibleFiles;
    if (batch.length > 20) {
      toast(t('folderLimitWarning'), { icon: '⚠️' });
      batch = batch.slice(0, FAIR_USE.maxImportBatchFiles);
    }

    setIsImportingFiles(true);
    const importToast = toast.loading(t('organizingFolders'));
    const actor=picked?.uid??auth.currentUser.uid;const current=picked?.current??importFeedback.capture(actor);
    try {
      const result = await learnDocumentBatch(actor, batch, existingMemories,{assertCurrent:()=>{if(!current())throw new Error('Import context unavailable');}});
      if(!current())return;
      toast.success(t('foldersLearnedSuccess', { count: result.imported }), { id: importToast });
      if (result.hubId) onMemoryCreated?.(result.hubId);
    } catch {
      if(current())toast.error('Importação não concluída. Verifica as notas criadas e a recuperação de ligações antes de repetir.', { id: importToast });
    } finally {
      setIsImportingFiles(false);
      setIsPickingFiles(false);
      if(current()){if (folderInputRef.current) folderInputRef.current.value = '';}else toast.dismiss(importToast);
    }
  };

  const triggerFolderImport = async () => {
    if (!ensureCanImport()) return;
    if (isTauriRuntime()) {
      if (!auth.currentUser) return;
      const actor=auth.currentUser.uid;const current=importFeedback.capture(actor);
      setIsImportingFiles(true);
      const importToast = toast.loading(t('organizingFolders'));
      try {
        await withPersonalMemoryMutation(actor,async context=>{
        const guard=()=>{context.assertCurrent();if(!current())throw new Error('Import context unavailable');};guard();
        const { open } = await import('@tauri-apps/plugin-dialog');
        guard();
        const selected = await open({
          directory: true,
          multiple: false,
        });
        guard();
        if (!selected) {
          toast.dismiss(importToast);
          return;
        }

        const importedFiles = await selectAndReadTauriDirectory(selected,guard);
        guard();

        if (importedFiles.length === 0) {
          toast.error(t('noFilesFound'), { id: importToast });
          return;
        }

        if (looksLikeObsidianVault(importedFiles)) {
          toast.loading(t('appVaultLoading'), { id: importToast });
          const result = await importObsidianVault(actor, importedFiles, existingMemories,{assertCurrent:guard});
          if(!current())return;
          toast.success(
            t('appVaultDone', {
              count: result.imported,
              links: result.linked,
              stats: result.statsLabel,
            }),
            { id: importToast },
          );
          if (result.memoryIds[0]) onMemoryCreated?.(result.memoryIds[0]);
          return;
        }

        let finalFiles = importedFiles;
        if (importedFiles.length > 20) {
          toast(t('folderLimitWarning'), { icon: '⚠️' });
          finalFiles = importedFiles.slice(0, FAIR_USE.maxImportBatchFiles);
        }

        const result = await learnDocumentBatch(actor, finalFiles, existingMemories,{assertCurrent:guard});
        guard();if(!current())return;
        toast.success(t('foldersLearnedSuccess', { count: result.imported }), { id: importToast });
        });
      } catch {
        if(current())toast.error('Importação não concluída. Verifica as notas criadas e a recuperação de ligações antes de repetir.', { id: importToast });
      } finally {
        setIsImportingFiles(false);if(!current())toast.dismiss(importToast);
      }
    } else {
      if(!auth.currentUser)return;
      const actor=auth.currentUser.uid;folderActorRef.current={uid:actor,current:importFeedback.capture(actor)};
      setIsPickingFiles(true);
      setIsFocused(true);
      // Deixa o painel montar o input antes do click nativo
      window.setTimeout(() => {if(folderActorRef.current?.current())folderInputRef.current?.click();}, 0);
    }
  };

  const triggerFileImport = () => {
    if (!ensureCanImport()) return;
    setIsPickingFiles(true);
    setIsFocused(true);
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const { isCommandPaletteOpen } = useUI();

  const resizeTextarea = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
  }, []);

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
    setLearnedGeneration(null);
    setText(template);
    setIsFocused(true);
    focusComposer();
  };

  const handleTextChange = (value: string) => {
    if (!value.trim()) {
      setGeneratedImage(null);
      setGeneratedImagePrompt('');
      setLearnedGeneration(null);
    }
    setText(value);
  };

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (!ensureCanImport() || !auth.currentUser) return;
    setIsImportingFiles(true);
    const importToast = toast.loading(t('organizingFiles', { count: files.length }));
    try {
      const result = await learnDocumentBatch(auth.currentUser.uid, files, existingMemories);
      toast.success(t('filesLearnedSuccess', { count: result.imported }), { id: importToast });
      if (result.hubId) onMemoryCreated?.(result.hubId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : describeUploadError(error);
      toast.error(detail ? `${t('filesLearnedError')} ${detail}` : t('filesLearnedError'), { id: importToast });
    } finally {
      setIsImportingFiles(false);
      setIsPickingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsPickingFiles(false);
    await importFiles(Array.from(event.target.files || []));
  };

  const generatedImageSrc = generatedImage?.dataUrl || generatedImage?.imageUrl;

  const fileFromDataUrl = async (dataUrl: string, filename: string): Promise<File> => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type || 'image/png', lastModified: Date.now() });
  };

  const uploadGeneratedImage = async (): Promise<Attachment[]> => {
    if (!generatedImage || !auth.currentUser) return [];
    if (generatedImage.dataUrl) {
      try {
        const file = await fileFromDataUrl(generatedImage.dataUrl, `mnemosyne-ai-${Date.now()}.png`);
        const pngFile = file.type === 'image/png'
          ? file
          : new File([file], file.name, { type: 'image/png', lastModified: file.lastModified });
        return [await uploadEncryptedAttachment({ file: pngFile, uid: auth.currentUser.uid, teamId: targetTeamId || undefined })];
      } catch (error) {
        console.warn('Generated image upload failed.');
        throw new Error(describeUploadError(error));
      }
    }
    return [];
  };

  const handleSave = async () => {
    if(!draft.ready)return;
    if (!text.trim() || !auth.currentUser || isSaving) return;
    const generationTarget = { uid: auth.currentUser.uid, teamId: targetTeamId || undefined };
    const actorCurrent=importFeedback.capture(generationTarget.uid),draftCurrent=draft.capture();
    const generationFeedback=()=>actorCurrent()&&draftCurrent();

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
        if (generationTarget.teamId)assertTeamMemoryCreationEnabled();else assertPersonalMemoryCreationEnabled();
        if (hasPendingAttachedMemoryCreation(generationTarget.uid)) throw new Error('Recupera ou cancela a criação pendente antes de gerar outra memória.');
        if (!generationTarget.teamId && hasPendingPersonalRevision(generationTarget.uid)) throw new Error('Recupera ou cancela a revisão pendente antes de gerar outra memória.');
        if(generationTarget.teamId&&hasPendingTeamRevision(generationTarget.uid))throw new Error('Recupera ou cancela a revisão de equipa pendente antes de gerar outra memória.');
        const { generated, learned,scope } = await withAiGenerationContext(generationTarget, async context => {
          const generated = await generateTextFromPrompt(parsedCommand.prompt, { context });
          if (!generated) throw new Error('A IA não devolveu texto.');
          const learned = await learnGeneratedText(context.uid, parsedCommand.prompt, generated, existingMemories, context);
          return { generated, learned,scope:context.scope };
        });
        if(!generationFeedback())return;
        draft.setGenerationResult({text:generated,image:null,imagePrompt:'',scope,generation:{ id: learned.id, ...generationTarget,personalRevisionBaseline:learned.personalRevisionBaseline,personalRevisionUnavailable:learned.personalRevisionUnavailable,teamRevisionBaseline:learned.teamRevisionBaseline,teamRevisionUnavailable:learned.teamRevisionUnavailable }});
        toast.success(t('captureTextLearned'));
      } catch (error) {
        if(generationFeedback())toast.error(error instanceof Error ? error.message : t('captureTextFail'));
      } finally {
        if(generationFeedback())setIsSaving(false);
      }
      return;
    }

    const isImageGenerationCommand = parsedCommand.type === 'image-generation';
    if (isImageGenerationCommand) {
      setIsSaving(true);
      try {
        if (!ATTACHMENT_WRITES_ENABLED) throw new Error(ATTACHMENT_READ_ONLY_MESSAGE);
        if (!generationTarget.teamId && hasPendingPersonalRevision(generationTarget.uid)) throw new Error('Recupera ou cancela a revisão pendente antes de gerar outra memória.');
        if(generationTarget.teamId&&hasPendingTeamRevision(generationTarget.uid))throw new Error('Recupera ou cancela a revisão de equipa pendente antes de gerar outra memória.');
        const { image, learned,scope } = await withAiGenerationContext(generationTarget, async context => {
          const image = await generateImageFromPrompt(parsedCommand.prompt, { context });
          const learned = await learnGeneratedImage(context.uid, parsedCommand.prompt, image, existingMemories, context);
          return { image, learned,scope:context.scope };
        });
        if(!generationFeedback())return;
        draft.setGenerationResult({text:`[Imagem gerada]\n\nPrompt: ${parsedCommand.prompt}`,image,imagePrompt:parsedCommand.prompt,scope,generation:{ id: learned.id, ...generationTarget,personalRevisionBaseline:learned.personalRevisionBaseline,personalRevisionUnavailable:learned.personalRevisionUnavailable,teamRevisionBaseline:learned.teamRevisionBaseline,teamRevisionUnavailable:learned.teamRevisionUnavailable }});
        setShowSerendipity(true);
        setIsFocused(true);
        onMemoryCreated?.(learned.id);
        toast.success(t('captureImageLearned'));
      } catch (error) {
        if(generationFeedback())toast.error(error instanceof Error ? error.message : t('captureImageFail'));
      } finally {
        if(generationFeedback())setIsSaving(false);
      }
      return;
    }

    const memoryText = (parsedCommand.type === 'memory-create' ? parsedCommand.text : text).trim();

    if (learnedGeneration) {
      if(learnedGeneration.personalRevisionUnavailable||learnedGeneration.teamRevisionUnavailable)return;
      const submittedEdit=draft.captureEdit();
      setIsSaving(true);
      try {
        await withAiGenerationContext(learnedGeneration, context =>
          reviseLearnedMemory(learnedGeneration.id, context.uid, memoryText, existingMemories, {...context,assertCurrent:()=>{context.assertCurrent();if(!submittedEdit())throw Error('Revision draft changed');}},learnedGeneration.personalRevisionBaseline,learnedGeneration.teamRevisionBaseline));
        if(!generationFeedback()||!submittedEdit())return;
        setText('');
        setShowSerendipity(false);
        setIsFocused(false);
        setGeneratedImage(null);
        setGeneratedImagePrompt('');
        setLearnedGeneration(null);
        textareaRef.current?.blur();
        toast.success(t('captureLearnUpdated'));
      } catch {
        if(generationFeedback())toast.error(t('captureLearnUpdateFail'));
      } finally {
        if(generationFeedback())setIsSaving(false);
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
    const manualFeedback = generationFeedback;
    try {
      await withAiGenerationContext(generationTarget, async context => {
      let processingMethod = 'manual';
      const actor = context.uid;
      if (hasPendingAttachedMemoryCreation(actor)) throw new Error('Recupera ou cancela a criação pendente antes de guardar outra memória.');
      const selectedTeam = teams.find((team) => team.id === targetTeamId) ?? null;
      if(selectedTeam)assertTeamMemoryCreationEnabled();
      if (!selectedTeam && !generatedImage) assertPersonalMemoryCreationEnabled();
      if (targetTeamId && !selectedTeam) throw new Error('A equipa selecionada já não está disponível. Volta a escolher o destino da memória.');
      const aiConfig = getLocalAiConfig();
      const aiErrors: string[] = [];
      let cognitive: Awaited<ReturnType<typeof cognitiveEngine.processMemory>> | null = null;
      // The semantic job filters this immutable snapshot in bounded tasks before projecting vectors.
      const scope = context.scope;

      try {
        cognitive = await cognitiveEngine.processMemory(memoryText, existingMemories, {
          assertCurrent: context.assertCurrent,
          eligible: semanticCandidateEligibility(actor, scope.kind === 'team' ? scope.teamId : undefined),
        });
        context.assertCurrent();
        processingMethod = 'local-embedding';
      } catch {
        context.assertCurrent();
        console.warn('Local memory enrichment unavailable.');
        aiErrors.push('Embeddings locais indisponíveis.');
        toast(t('embeddingUnavailable'), {
          icon: '!',
          style: {
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.1)'
          }
        });
      }

      if (aiErrors.length > 0) {
        const summary = aiErrors.join('\n');
        const failureDecision = resolveAiFailureDecision(
          aiConfig,
          aiErrors,
          () => confirm(`A IA configurada falhou:\n\n${summary}\n\nGuardar a memória sem este enriquecimento?`)
        );
        if (failureDecision === 'block-save') {
          toast.error(t('captureAiPolicyBlock'));
          throw new Error(`IA configurada falhou:\n${summary}`);
        }
        if (failureDecision === 'skip-save') return;
      }
      
      // Mapear para o formato esperado pelo Firestore (links precisam ser simples)
      const nodes: [] = [];
      const links: [] = [];
      if (auth.currentUser?.uid !== actor) throw new Error('A conta mudou durante a captura.');
      const generatedAttachments = await uploadGeneratedImage();
      await context.assertAccess();

      const title = cognitive ? cognitiveEngine.generateTitle(memoryText) : null;
      const metadata = {
        nodes: nodes.length > 0 ? nodes : null,
        links: links.length > 0 ? links : null,
        embedding: cognitive?.embedding || null,
        embeddingModel: cognitive?.embeddingModel || null,
        connections: [],
        semanticClusterId: cognitive?.semanticClusterId || null,
        position: cognitive?.position || null,
        importance: cognitive?.importance || 0.5,
        celestialType: cognitive?.celestialType || null,
        tags: generatedImage ? ['image-generation', 'imagem-gerada'] : null,
        generatedImageProvider: generatedImage?.provider || null,
        generatedImageModel: generatedImage?.model || null,
        processingMethod
      };
      let memoryRef: { id: string };
      if (generatedAttachments.length) {
        memoryRef = await createMemoryWithAttachments({ uid: actor, text: memoryText, title, teamId: selectedTeam?.id ?? null, attachments: generatedAttachments, metadata,...(scope.kind==='team'?{expectedTeamEpoch:{keyEpoch:scope.keyEpoch,keyId:scope.keyId}}:{}) }, undefined, context.assertCurrent,context.assertAccess);
      } else if (selectedTeam) {
        if(scope.kind!=='team'||scope.teamId!==selectedTeam.id)throw Error('O destino da memória mudou.');
        memoryRef=await createTeamMemory({uid:actor,text:memoryText,title,metadata,teamId:scope.teamId,keyEpoch:scope.keyEpoch,keyId:scope.keyId},undefined,context.assertCurrent,context.assertAccess);
      } else {
        memoryRef = await createPersonalMemory({ uid: actor, text: memoryText, title, metadata }, undefined, context.assertCurrent);
      }
      await context.assertAccess();
      if (!manualFeedback()) return;

      // Vector neighbors are proposed by the private relation backfill and
      // only become graph links after owner review.
      setLastSavedMeta({ links: 0, title: title || undefined });
      setText('');
      setShowSerendipity(false);
      setIsFocused(true);
      setGeneratedImage(null);
      setGeneratedImagePrompt('');
      setLearnedGeneration(null);
      onMemoryCreated?.(memoryRef.id);
      toast.success(
        selectedTeam
          ? `Pensamento cristalizado na equipa “${selectedTeam.name}”.`
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
      });
    } catch (error) {
      if (!manualFeedback()) return;
      if (error instanceof MemoryCryptoLockedError) {
        toast.error(error.message);
      } else {
        const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
        toast.error(`${t('captureFormError')}${detail}`);
      }
    } finally {
      if (manualFeedback()) setIsSaving(false);
    }
  };

  const collapseCapture = () => {
    void draft.flush();
    setIsFocused(false);
    setShowSerendipity(false);
    textareaRef.current?.blur();
    onClose?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      e.preventDefault();
      collapseCapture();
    }
  };

  // Draft text must NOT keep the panel expanded — that trapped users with
  // "pesquisa na web sobre" (X/Esc only cleared focus, text kept isCaptureActive true).
  // Keep open while importing / native file picker is open (inputs live inside the panel).
  const isCaptureActive = isFocused || isPickingFiles || isImportingFiles;
  const parsedCommand = parseAiCommand(text.trim());
  const canSubmit = draft.ready && text.trim().length > 0 && !isCommandPaletteOpen && !isSaving && !isImportingFiles && !isSubscriptionLoading;
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
    'Ctrl+Enter cristaliza · Esc recua';

  const chipClass =
    'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-slate-300 transition-all duration-200 hover:scale-[1.03] hover:border-cyan-300/40 hover:bg-cyan-400/15 hover:text-cyan-50 hover:shadow-[0_0_16px_rgba(34,211,238,0.2)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50';

  const modeTone =
    parsedCommand.type === 'web-research'
      ? 'border-sky-400/30 bg-sky-500/15 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.2)]'
      : parsedCommand.type === 'image-generation'
      ? 'border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-100 shadow-[0_0_12px_rgba(232,121,249,0.2)]'
      : parsedCommand.type === 'text-generation'
      ? 'border-amber-400/30 bg-amber-500/15 text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.2)]'
      : 'border-cyan-400/25 bg-cyan-500/15 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.2)]';

  const remainingMemories = !isFreeFirstMode ? getRemainingMemories() : null;
  const hasDraft = text.trim().length > 0;

  return (
    <React.Fragment key={draft.scope}>
      <ClipCaptureRecoveryPanel onMemoryCreated={onMemoryCreated} />
      <PersonalConnectionRecoveryPanel />
      <ObsidianImportRecoveryPanel onMemoryCreated={onMemoryCreated}/>
      <DocumentImportRecoveryPanel onMemoryCreated={onMemoryCreated}/>
      <PersonalRevisionRecoveryPanel />
      <TeamRevisionRecoveryPanel />
      <CommsImportRecoveryPanel />
      <CommsIdentityRolloverPanel mnemonic={mnemonic}/>
      <CommsContactRecoveryPanel/>
      <CommsDeliveryRecoveryPanel/>
      <CommsP2PRecoveryPanel/>
      <CommsP2PContentRecoveryPanel/>
      {legacyDraft&&draft.ready&&<section aria-label="Rascunho antigo" className="mb-3 rounded-xl border border-amber-300/30 p-3 text-sm text-amber-100">
        <p>Existe um rascunho antigo sem vínculo à conta. Não será aberto nem atribuído automaticamente.</p>
        <button type="button" onClick={discardLegacyDraft} className="mt-2 rounded border px-3 py-2">Eliminar rascunho antigo</button>
      </section>}
      {draft.message&&<section aria-label="Rascunho cifrado" className="mb-3 rounded-xl border border-amber-300/30 p-3 text-sm text-amber-100">
        <p role="status">{draft.message}</p>
        {draft.ready&&<button type="button" onClick={()=>void draft.flush()} className="mr-3 mt-2 rounded border px-3 py-2">Tentar guardar rascunho</button>}
        <button type="button" onClick={()=>void draft.discard()} className="mt-2 rounded border px-3 py-2">Eliminar rascunho local</button>
      </section>}
      {(learnedGeneration?.personalRevisionUnavailable||learnedGeneration?.teamRevisionUnavailable)&&<p role="status" className="mb-3 text-sm text-amber-100">A memória foi guardada. Não foi possível abrir a revisão nesta vista. O texto foi conservado; consulta a memória no Universo antes de voltar a editar.</p>}
      <AnimatePresence>
        {isCaptureActive && (
          <motion.div
            key="capture-veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[22rem] bg-gradient-to-t from-[#020617]/95 via-[#020617]/50 to-transparent"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCaptureActive && (
          <div className="pointer-events-none fixed inset-x-0 bottom-[6.75rem] z-40 flex justify-center px-3 sm:bottom-[7.25rem] sm:px-4">
            <motion.div
              key="capture-panel"
              layout
              initial={{ opacity: 0, y: 28, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={{ type: 'spring', damping: 26, stiffness: 350 }}
              className="mnem-flow-panel pointer-events-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-cyan-300/30 bg-[#07101f]/95 shadow-[0_24px_90px_rgba(0,0,0,0.55),0_0_50px_rgba(34,211,238,0.18)] backdrop-blur-2xl"
            >
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/15 p-2 shadow-[0_0_14px_rgba(34,211,238,0.25)]">
                <Sparkles className="h-4 w-4 text-cyan-200" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold leading-none text-slate-50">{t('flowTitle') || 'Captura'}</p>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${modeTone}`}>
                    {flowModeLabel}
                  </span>
                  {hasDraft && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                      {draft.dirty?'a guardar rascunho cifrado':'rascunho cifrado'}
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={collapseCapture}
              className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-slate-400 transition-all hover:scale-105 hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              aria-label="Recolher captura"
              title="Recolher captura (Esc)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Action chips — always visible, scroll on mobile */}
          <div className="mnem-scroll flex gap-2 overflow-x-auto border-b border-white/[0.04] px-3 py-2.5">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('')} className={chipClass}>
              <FileText className="h-3.5 w-3.5 text-slate-300" /> Livre
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('guardar memória: ')} className={chipClass}>
              <FileText className="h-3.5 w-3.5 text-violet-300" /> Memória
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('pesquisa na web sobre ')} className={chipClass}>
              <Search className="h-3.5 w-3.5 text-sky-300" /> Web
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('gera uma imagem de ')} className={chipClass}>
              <ImageIcon className="h-3.5 w-3.5 text-fuchsia-300" /> Imagem
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand('gera um texto sobre ')} className={chipClass}>
              <Sparkles className="h-3.5 w-3.5 text-amber-300" /> IA texto
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={triggerFileImport} disabled={isImportingFiles} className={chipClass}>
              {isImportingFiles ? <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" /> : <UploadCloud className="h-3.5 w-3.5 text-cyan-300" />}
              Ficheiros
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={triggerFolderImport}
              disabled={isImportingFiles}
              className={chipClass}
              title={t('inputVaultHint')}
            >
              <FolderOpen className="h-3.5 w-3.5 text-emerald-300" /> {t('inputVaultObsidian')}
            </button>
          </div>

          {TEAM_WRITES_ENABLED && teams.length > 0 && (
            <div className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2">
              <Users className="h-3.5 w-3.5 shrink-0 text-violet-300" />
              <label htmlFor="universe-memory-destination" className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Destino
              </label>
              <select
                id="universe-memory-destination"
                value={targetTeamId}
                disabled={!draft.ready || isSaving || learnedGeneration !== null}
                onChange={(event) => setTargetTeamId(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-violet-400/40"
                aria-label="Destino da memória: pessoal ou equipa"
              >
                <option value="">Pessoal</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!hasDraft && (
            <div className="border-b border-white/[0.04] px-4 py-2 text-[11px] leading-relaxed text-slate-400">
              Escreve livremente, usa chips de comando, ou arrasta ficheiros para o grafo.
              Pensamentos ligam-se sozinhos quando cristalizam.
              {TEAM_WRITES_ENABLED && teams.length > 0 ? ' Escolhe Pessoal ou uma equipa antes de cristalizar.' : ''}
            </div>
          )}

          <div className="flex items-end gap-2 p-3 sm:gap-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={DOCUMENT_FILE_ACCEPT}
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
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              disabled={!draft.ready || isCommandPaletteOpen || isSaving || isSubscriptionLoading}
              placeholder={t('flowPlaceholder') || 'Escreve um pensamento, ideia ou comando…'}
              className="min-h-[3.25rem] max-h-48 flex-1 resize-none overflow-y-auto rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition-all placeholder:text-slate-500 focus:border-cyan-300/45 focus:bg-black/45 focus:ring-2 focus:ring-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50 mnem-scroll"
              rows={2}
            />

            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void handleSave()}
              disabled={!canSubmit||learnedGeneration?.personalRevisionUnavailable===true||learnedGeneration?.teamRevisionUnavailable===true||Boolean(learnedGeneration?.teamId&&auth.currentUser?.uid&&hasPendingTeamRevision(auth.currentUser.uid))}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-gradient-to-br from-cyan-400/25 to-violet-500/25 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.2)] transition-all duration-200 hover:scale-105 hover:from-cyan-400/35 hover:to-violet-500/35 hover:shadow-[0_0_24px_rgba(34,211,238,0.35)] active:scale-95 disabled:cursor-not-allowed disabled:border-white/5 disabled:from-transparent disabled:to-transparent disabled:bg-white/[0.03] disabled:text-slate-500 disabled:shadow-none"
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
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400">
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">Ctrl + Enter</kbd>
              <span>gravar</span>
              <span className="text-slate-600">·</span>
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">Esc</kbd>
              <span>recolher</span>
            </div>
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
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setLightboxSrc(generatedImageSrc)}
                  className="mt-2 flex w-full gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3 text-left transition hover:border-cyan-300/40 hover:bg-cyan-300/10"
                  title="Clica para ver em tamanho real"
                >
                  <img
                    src={generatedImageSrc}
                    alt="Imagem gerada pela IA"
                    className="h-28 w-28 shrink-0 rounded-lg object-cover ring-1 ring-white/15"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-cyan-100">Imagem pronta — clica para ampliar</p>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-400">
                      {generatedImagePrompt || generatedImage?.revisedPrompt || 'Resultado visual gerado pela IA.'}
                    </p>
                    <p className="mt-2 text-[11px] text-slate-500">
                      {generatedImage?.provider}
                      {generatedImage?.model ? ` · ${generatedImage.model}` : ''}
                    </p>
                  </div>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {lightboxSrc && (
            <ImageLightbox
              src={lightboxSrc}
              alt="Imagem gerada pela IA"
              onClose={() => setLightboxSrc(null)}
            />
          )}

          <AnimatePresence>
            {showSerendipity && !relatedPreview.length && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t border-white/[0.06] px-3 pb-3 pt-1 text-[11px] leading-relaxed text-slate-500"
              >
                Continua a escrever — a captura deteta comandos (web, imagem, texto) e prepara ligações semânticas ao cristalizar.
              </motion.div>
            )}
          </AnimatePresence>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </React.Fragment>
  );
};
