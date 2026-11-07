import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { AuthModal } from './components/AuthModal';
import { MnemonicBackupModal } from './components/MnemonicBackupModal';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingTour } from './components/OnboardingTour';
import { ShareView } from './pages/ShareView';
import {CapsuleManagerPage} from './pages/CapsuleManagerPage';
import { PricingPage } from './pages/PricingPage';
import { CheckoutSuccess } from './pages/CheckoutSuccess';
import { CheckoutCancel } from './pages/CheckoutCancel';
import { PrivacyPage } from './pages/PrivacyPage';
import { AccountDeletionPage } from './pages/AccountDeletionPage';
import { LoginPage } from './pages/LoginPage';
import DesktopAuthPage from './pages/DesktopAuthPage';
import AgentAuthorizationPage from './pages/AgentAuthorizationPage';
import { MobilePairingPage } from './pages/MobilePairingPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { DownloadPage } from './pages/DownloadPage';
import { SecurityPage } from './pages/SecurityPage';
import { ChangelogPage } from './pages/ChangelogPage';
import { StatusPage } from './pages/StatusPage';
import { EnterprisePage } from './pages/EnterprisePage';
import { LandingBackground } from './components/landing/LandingBackground';
import type { FilterOptions } from './hooks/useSessions';
import { Search, Activity, Brain, Globe, List, Table2, ClipboardList, LogOut, Settings, Sparkles, Archive, FolderOpen, Rocket, PenLine } from 'lucide-react';
import { auth } from './firebase';
import { getRedirectResult, signOut } from 'firebase/auth';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import toast from 'react-hot-toast';

import { useSessions } from './hooks/useSessions';
import { useAccountSession } from './hooks/useAccountSession';
import { onMemoryCryptoChanged } from './services/memoryCrypto';
import { useSemanticClusterBackfill } from './hooks/useSemanticClusterBackfill';
import { useSemanticConnectionBackfill } from './hooks/useSemanticConnectionBackfill';
import { useClipCapture } from './hooks/useClipCapture';
import {useSyncFeedback} from './hooks/useSyncFeedback';
import { useSubscription } from './hooks/useSubscription';
import { useUI } from './contexts/UIContext';
import { CommandPalette } from './components/CommandPalette';
import { CognitiveInput } from './components/CognitiveInput';
import { NotificationSystem } from './components/NotificationSystem';
import { TransmissionPanel, type TransmissionDraft } from './components/TransmissionPanel';
import { WebResearchPanel } from './components/WebResearchPanel';
import { Radio } from 'lucide-react';
import { publishCommsIdentity } from './services/commsIdentity';
import { isNewAuthUser } from './services/authFlow';
import { collectDroppedFiles, learnDocumentBatch } from './services/learningService';
import { DOCUMENT_FILE_ACCEPT } from './utils/fileTypes';
import {
  importObsidianVault,
  looksLikeObsidianVault,
} from './services/obsidianVaultImport';
import { assimilateStarterFounder } from './services/starterUniverse';
import { StudyModePanel } from './components/StudyModePanel';
import {MemoryEditRecoveryPanel} from './components/MemoryEditRecoveryPanel';
import { AttachedMemoryRecoveryPanel } from './components/AttachedMemoryRecoveryPanel';
import {TeamConnectionRecoveryPanel} from './components/TeamConnectionRecoveryPanel';
import {SemanticClusterRecoveryPanel} from './components/SemanticClusterRecoveryPanel';
import {SemanticRelationRecoveryPanel} from './components/SemanticRelationRecoveryPanel';
import {SyncConflictRecoveryPanel} from './components/SyncConflictRecoveryPanel';
import {PersonalMigrationRecoveryPanel} from './components/PersonalMigrationRecoveryPanel';
import {TeamHistoryChangeRecoveryPanel} from './components/TeamHistoryChangeRecoveryPanel';
import { ReviewInboxPanel } from './components/ReviewInboxPanel';
import { generateMnemonic } from './utils/crypto';
import {
  readSessionMnemonic,
  saveSessionMnemonic,
  clearSessionMnemonic,
  startMnemonicIdleGuard,
  scrubLegacyKeyMaterial,
} from './utils/sessionMnemonic';
import { isLocalPinEnabled } from './utils/localPin';
import { setMemoryCryptoMnemonic } from './services/memoryCrypto';
import { isFreeFirstMode, monetizationCopy } from './config/monetization';
import { embeddingService, resetEmbeddingServices } from './services/embeddingService';
import { readMemoryIdFromSearch, stripMemoryFromUrl } from './utils/deepLinks';
import {
  CAPTURE_ACTIVE_EVENT,
  CAPTURE_IDLE_EVENT,
  dispatchOpenCapture,
  isCaptureHotkeyEvent,
  listenDesktopCaptureHotkey,
} from './utils/desktopCapture';
import { PinUnlockModal } from './components/PinUnlockModal';
import { CognitivePulsePanel } from './components/CognitivePulsePanel';
import { shouldShowPulseToday } from './services/cognitivePulse';

import { Universe3D } from './components/universe/Universe3D';
import { UniverseHUD } from './components/universe/UniverseHUD';
import { MemoryListView } from './components/universe/MemoryListView';
import { CognitiveSidebar, type SidebarTab } from './components/CognitiveSidebar';
import { SovereignExportModal } from './components/SovereignExportModal';
import { useUniverseStore } from './store/universeStore';
import { useUniverseMemories } from './hooks/useUniverseMemories';
import { cognitiveEngine } from './engines/CognitiveEngine';
import { useDocumentLang, useTranslation } from './utils/translations';

const ClipRedirect: React.FC = () => {
  return <Navigate to="/" replace />;
};

const AuthBootScreen: React.FC<{ failed: boolean; onRetry: () => void }> = ({ failed, onRetry }) => {
  const { t } = useTranslation();
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#020617] text-white">
      <LandingBackground />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-slate-300 backdrop-blur-xl">
          <Brain className="h-4 w-4 text-violet-300" />
          <span>{failed ? 'Não foi possível preparar a conta. Verifica a ligação e tenta novamente.' : t('restoringSession')}</span>
          {failed && <>
            <button type="button" onClick={onRetry} className="underline">Tentar novamente</button>
            <button type="button" onClick={() => void signOut(auth)} className="underline">Sair</button>
          </>}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  useDocumentLang();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user: currentUser, ready: isAuthReady, failed: accountInitFailed, retry: retryAccountInit } = useAccountSession(() => {
    resetEmbeddingServices();
    setSearchQuery('');
  });
  const [isRedirectReady, setIsRedirectReady] = useState(false);
  const [mnemonic, setMnemonic] = useState<string[] | null>(() => readSessionMnemonic());
  const [generatedMnemonicToShow, setGeneratedMnemonicToShow] = useState<string[] | null>(null);
  const isAuthenticated = Boolean(currentUser);

  // OS Navigation (Universo & Sidebar)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('memory');
  const [memoryView, setMemoryView] = useState<'universe' | 'list' | 'table'>('universe');
  const [isReviewInboxOpen, setIsReviewInboxOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filters] = useState<FilterOptions>({
    dateRange: 'all',
    tags: [],
    category: undefined
  });

  const [isDragging, setIsDragging] = useState(false);
  const [replayOnboarding, setReplayOnboarding] = useState(false);
  const [showMnemonicAuth, setShowMnemonicAuth] = useState(false);
  const [isTransmissionOpen, setIsTransmissionOpen] = useState(false);
  const [transmissionDraft, setTransmissionDraft] = useState<TransmissionDraft | null>(null);
  const [transmissionTab, setTransmissionTab] = useState<'compose' | 'contacts' | 'inbox' | 'sent' | 'identity'>('compose');
  const [isWebResearchOpen, setIsWebResearchOpen] = useState(false);
  const [webResearchQuery, setWebResearchQuery] = useState('');
  const [preferPinUnlock, setPreferPinUnlock] = useState(() => isLocalPinEnabled());
  const [isPulseOpen, setIsPulseOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportForMigration, setExportForMigration] = useState(false);
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);

  const focusUniverseCapture = useCallback(() => {
    dispatchOpenCapture();
  }, []);

  useEffect(() => {
    const onActive = () => setIsCaptureOpen(true);
    const onIdle = () => setIsCaptureOpen(false);
    window.addEventListener(CAPTURE_ACTIVE_EVENT, onActive);
    window.addEventListener(CAPTURE_IDLE_EVENT, onIdle);
    return () => {
      window.removeEventListener(CAPTURE_ACTIVE_EVENT, onActive);
      window.removeEventListener(CAPTURE_IDLE_EVENT, onIdle);
    };
  }, []);

  // Universe 3D integration
  const { selectedMemoryId, selectMemory, setEmbeddingReady, memories: universeMemories } = useUniverseStore();
  const { saveMemory, deleteMemory, legacyPlaintextCount } = useUniverseMemories(isAuthenticated);
  const { canCreateMemory, isLoading: isSubscriptionLoading } = useSubscription();

  // States do Global Store (UI Context)
  const {
    isSettingsOpen, setIsSettingsOpen,
    openCommandPalette
  } = useUI();

  // Initialize cognitiveEngine for universe embeddings
  useEffect(() => {
    cognitiveEngine.initialize()
      .then(() => setEmbeddingReady(true))
      .catch((err) => console.warn('CognitiveEngine init non-blocking:', err));
  }, [setEmbeddingReady]);

  // Sync selectedMemoryId -> open sidebar
  useEffect(() => {
    if (selectedMemoryId) {
      setIsSidebarOpen(true);
      setSidebarTab('memory');
    }
  }, [selectedMemoryId]);

  const handleKeyComplete = useCallback((newMnemonic: string[]) => {
    saveSessionMnemonic(newMnemonic);
    setMnemonic(newMnemonic);
  }, []);

  const handleGeneratedMnemonic = useCallback((newMnemonic: string[]) => {
    saveSessionMnemonic(newMnemonic);
    setMnemonic(newMnemonic);
    setGeneratedMnemonicToShow(newMnemonic);
    setShowMnemonicAuth(false);
  }, []);

  const handleResetKey = useCallback(() => {
    clearSessionMnemonic();
    setMnemonic(null);
    setSearchQuery('');
    setGeneratedMnemonicToShow(null);
  }, []);

  // Sincroniza a chave de cifra das memórias com a mnemónica ativa
  useEffect(() => {
    setMemoryCryptoMnemonic(mnemonic);
  }, [mnemonic]);

  // Scrub legacy plaintext keys + idle lock for mnemonic
  useEffect(() => {
    scrubLegacyKeyMaterial();
    return startMnemonicIdleGuard(() => {
      setMnemonic(null);
      setSearchQuery('');
      const pinReady = isLocalPinEnabled();
      setPreferPinUnlock(pinReady);
      toast(pinReady ? t('appIdleLockPin') : t('appIdleLock'), {
          icon: '🔒',
          duration: 5000,
        }
      );
    });
  }, [t]);

  useEffect(() => {
    const onWarn = (event: Event) => {
      const remaining = (event as CustomEvent<{ remainingMs: number }>).detail?.remainingMs ?? 0;
      const mins = Math.max(1, Math.round(remaining / 60_000));
      toast(t('appIdleWarn', { mins }), { icon: '⏳', duration: 4000 });
    };
    window.addEventListener('mnemosyne:session-idle-warn', onWarn);
    return () => window.removeEventListener('mnemosyne:session-idle-warn', onWarn);
  }, [t]);

  // Warm embeddings model in background after unlock (non-blocking)
  useEffect(() => {
    if (!mnemonic) return;
    const t = window.setTimeout(() => {
      embeddingService.initialize().catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [mnemonic]);

  // Deep-link: /?memory=<id> foca a memória no 3D
  useEffect(() => {
    if (!isAuthenticated || !mnemonic) return;
    if (location.pathname !== '/') return;
    const memoryId = readMemoryIdFromSearch(location.search);
    if (!memoryId) return;
    selectMemory(memoryId);
    setIsSidebarOpen(true);
    setSidebarTab('memory');
    const t = window.setTimeout(() => stripMemoryFromUrl(), 800);
    return () => window.clearTimeout(t);
  }, [isAuthenticated, mnemonic, location.pathname, location.search, selectMemory]);

  // Hook gerenciador de sessões
  const {
    sessions,
    allSessions,
    searchResults,
    legacyPersonalCount: legacySessionCount,
  } = useSessions(currentUser, searchQuery, filters);
  const legacyPersonalCount = legacyPlaintextCount + legacySessionCount;

  useSemanticClusterBackfill(currentUser, allSessions, isAuthenticated && Boolean(mnemonic));
  useSemanticConnectionBackfill(currentUser, allSessions, isAuthenticated && Boolean(mnemonic));

  const handleMemoryCreated = useCallback((memoryId: string) => {
    selectMemory(memoryId);
    setIsSidebarOpen(true);
    setSidebarTab('memory');
  }, [selectMemory]);

  useClipCapture({
    isAuthenticated,
    mnemonicReady: Boolean(mnemonic),
    uid: currentUser?.uid,
    subscriptionReady: !isSubscriptionLoading,
    canCreateMemory: canCreateMemory(),
    onMemoryCreated: handleMemoryCreated,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isCaptureHotkeyEvent(event)) return;
      event.preventDefault();
      focusUniverseCapture();
    };
    window.addEventListener('keydown', onKey);
    let unlisten: (() => void) | undefined;
    void listenDesktopCaptureHotkey(() => focusUniverseCapture()).then((fn) => {
      unlisten = fn;
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      unlisten?.();
    };
  }, [focusUniverseCapture]);

  // Cognitive Pulse — ritual diário após desbloquear (uma vez por dia)
  useEffect(() => {
    if (!isAuthenticated || !mnemonic || !currentUser) return;
    if (sessions.length === 0) return;
    if (!shouldShowPulseToday(currentUser.uid)) return;
    const t = window.setTimeout(() => setIsPulseOpen(true), 900);
    return () => window.clearTimeout(t);
  }, [isAuthenticated, mnemonic, currentUser, sessions.length]);

  useEffect(() => {
    if (!currentUser || !mnemonic || mnemonic.length !== 12) return;
    let active=true;
    publishCommsIdentity(currentUser, mnemonic,()=>{if(!active)throw new Error('Identity context changed');}).catch(() => {
      if(active)console.warn('Unable to publish Comms identity.');
    });
    return()=>{active=false;};
  }, [currentUser, mnemonic]);

  useEffect(() => onMemoryCryptoChanged(resetEmbeddingServices), []);

  useEffect(() => {
    let cancelled = false;

    getRedirectResult(auth)
      .then(async (credential) => {
        if (!credential || !isNewAuthUser(credential)) return;
        const words = await generateMnemonic();
        if (!cancelled) {
          handleGeneratedMnemonic(words);
        }
      })
      .catch((error) => {
        console.warn('Erro ao concluir login Google por redirecionamento:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsRedirectReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [handleGeneratedMnemonic]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let removeListener: (() => void) | undefined;
    CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      try {
        const openedUrl = new URL(url);
        if (openedUrl.protocol === 'mnemosyne:' && openedUrl.hostname === 'pair') {
          const payload = openedUrl.searchParams.get('payload');
          navigate(payload ? `/mobile/pair?payload=${encodeURIComponent(payload)}` : '/mobile/pair');
        }
      } catch (error) {
        console.warn('Unable to process app URL:', error);
      }
    }).then((handle) => {
      removeListener = () => { void handle.remove(); };
    });

    return () => {
      removeListener?.();
    };
  }, [navigate]);

  // Mostrar AuthModal para mnemônica quando autenticado mas sem chave
  useEffect(() => {
    if (isAuthenticated && !mnemonic) {
      setShowMnemonicAuth(true);
    } else {
      setShowMnemonicAuth(false);
    }
  }, [isAuthenticated, mnemonic]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      handleResetKey();
      navigate('/');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  };

  const openTransmission = (
    draft: TransmissionDraft | null = null,
    tab: 'compose' | 'contacts' | 'inbox' | 'sent' | 'identity' = 'compose',
  ) => {
    setTransmissionDraft(draft);
    setTransmissionTab(tab);
    setIsTransmissionOpen(true);
  };

  const openWebResearch = (query = '') => {
    setWebResearchQuery(query);
    setIsWebResearchOpen(true);
  };

  const [isBootstrappingUniverse, setIsBootstrappingUniverse] = useState(false);
  const vaultInputRef = React.useRef<HTMLInputElement>(null);
  const {capture:captureImportFeedback}=useSyncFeedback();
  const vaultActorRef=useRef<{uid:string;current:()=>boolean}|null>(null);

  const runObsidianImport = useCallback(async (files: File[],captured?:{uid:string;current:()=>boolean}) => {
    if (!auth.currentUser) return;
    if (!mnemonic) {
      toast.error(t('appNeedMind'));
      return;
    }
    const actor=captured?.uid??auth.currentUser.uid;const current=captured?.current??captureImportFeedback(actor);if(!current())return;
    const toastId = toast.loading(t('appVaultLoading'));
    try {
      const result = await importObsidianVault(
        actor,
        files,
        allSessions,
        {assertCurrent:()=>{if(!current())throw new Error('Import context unavailable');}},
      );
      if(!current())return;
      toast.success(
        t('appVaultDone', {
          count: result.imported,
          links: result.linked,
          stats: result.statsLabel,
        }),
        { id: toastId },
      );
      if (result.memoryIds[0]) {
        selectMemory(result.memoryIds[0]);
        setIsSidebarOpen(true);
        setSidebarTab('memory');
      }
    } catch {
      if(current())toast.error('Importação não concluída. Usa a recuperação de importações para retomar o plano cifrado ou cancelar os passos restantes.', { id: toastId });
    }finally{if(!current())toast.dismiss(toastId);}
  }, [allSessions, mnemonic, selectMemory, t,captureImportFeedback]);

  const runVaultOrDocumentImport = useCallback(async (files: File[],captured?:{uid:string;current:()=>boolean}) => {
    if (!auth.currentUser) return;
    if (!mnemonic) {
      toast.error(t('appNeedMind'));
      return;
    }
    if (files.length === 0) {
      toast.error(t('noFilesFound'));
      return;
    }
    const actor=captured?.uid??auth.currentUser.uid;const current=captured?.current??captureImportFeedback(actor);if(!current())return;
    if (looksLikeObsidianVault(files)) {
      await runObsidianImport(files,{uid:actor,current});
      return;
    }
    const toastId = toast.loading(t('organizingFolders'));
    try {
      const result = await learnDocumentBatch(actor, files, allSessions,{assertCurrent:()=>{if(!current())throw new Error('Import context unavailable');}});
      if(!current())return;
      toast.success(t('foldersLearnedSuccess', { count: result.imported }), { id: toastId });
      if (result.hubId) {
        selectMemory(result.hubId);
        setIsSidebarOpen(true);
        setSidebarTab('memory');
      }
    } catch {
      if(current())toast.error('Importação não concluída. Verifica as notas e a recuperação de ligações antes de repetir.', { id: toastId });
    }finally{if(!current())toast.dismiss(toastId);}
  }, [allSessions, mnemonic, runObsidianImport, selectMemory, t,captureImportFeedback]);

  const handleAssimilateStarter = useCallback(async () => {
    if (!auth.currentUser || !mnemonic) {
      toast.error(t('appNeedMind'));
      return;
    }
    if (isBootstrappingUniverse) return;
    const actor=auth.currentUser.uid;const current=captureImportFeedback(actor);if(!current())return;
    setIsBootstrappingUniverse(true);
    const toastId = toast.loading(t('appStarterLoading', { done: 0, total: '?' }));
    try {
      const result = await assimilateStarterFounder(
        actor,
        allSessions,
        {
          assertCurrent:()=>{if(!current())throw new Error('Import context unavailable');},
          onProgress: (done, total) => {
            if(current())toast.loading(t('appStarterLoading', { done, total }), { id: toastId });
          },
        },
      );
      if(!current())return;
      toast.success(
        t('appStarterDone', { count: result.imported, links: result.linked }),
        { id: toastId },
      );
      if (result.memoryIds[0]) {
        selectMemory(result.memoryIds[0]);
        setIsSidebarOpen(true);
        setSidebarTab('memory');
      }
    } catch {
      if(current())toast.error('Universo inicial não concluído. Usa a recuperação de importações para retomar ou cancelar os passos restantes.', { id: toastId });
    } finally {
      setIsBootstrappingUniverse(false);
      if(!current())toast.dismiss(toastId);
    }
  }, [allSessions, isBootstrappingUniverse, mnemonic, selectMemory, t,captureImportFeedback]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (!auth.currentUser || !mnemonic) {
      toast.error(t('appNeedMind'));
      return;
    }
    const actor=auth.currentUser.uid;const current=captureImportFeedback(actor);if(!current())return;
    try {
      const files = await collectDroppedFiles(e.dataTransfer);
      if(!current())return;
      if (files.length === 0) {
        toast.error(t('noFilesFound'));
        return;
      }
      await runVaultOrDocumentImport(files,{uid:actor,current});
    } catch {
      if(current())toast.error('Não foi possível ler a pasta selecionada.');
    }
  };

  // Drop zone uses pointer-events:none until drag starts — listen on window so dragenter works.
  useEffect(() => {
    if (!isAuthenticated) return;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types || []).includes('Files');

    const onDragEnter = (event: DragEvent) => {
      if (hasFiles(event)) setIsDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setIsDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setIsDragging(false);
    };
    const onDropWindow = () => setIsDragging(false);

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDropWindow);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDropWindow);
    };
  }, [isAuthenticated]);

  if (!isAuthReady || !isRedirectReady) {
    return (
      <>
        <NotificationSystem />
        <AuthBootScreen failed={accountInitFailed} onRetry={retryAccountInit} />
      </>
    );
  }

  return (
    <>
      <NotificationSystem />
      <Routes>
        <Route path="/share/:shareId" element={<ShareView />} />
        <Route path="/capsules" element={<CapsuleManagerPage />} />
        <Route path="/download"      element={<DownloadPage />} />
        <Route path="/pricing"        element={<PricingPage />} />
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/checkout/cancel"  element={<CheckoutCancel />} />
        <Route path="/privacy"        element={<PrivacyPage />} />
        <Route path="/security"       element={<SecurityPage />} />
        <Route path="/enterprise"     element={<EnterprisePage />} />
        <Route path="/changelog"      element={<ChangelogPage />} />
        <Route path="/status"         element={<StatusPage />} />
        <Route path="/account-deletion" element={<AccountDeletionPage />} />
        <Route path="/analytics"      element={<AnalyticsPage />} />
        <Route path="/universe"       element={<Navigate to="/" replace />} />
        <Route path="/mobile/pair"    element={<MobilePairingPage />} />
        <Route path="/clip"           element={<ClipRedirect />} />
        <Route path="/desktop-auth" element={<DesktopAuthPage />} />
        <Route path="/agent/authorize" element={<AgentAuthorizationPage />} />
        <Route
          path="/login"
          element={
            !isAuthenticated ? (
              <LoginPage
                onMnemonicComplete={handleKeyComplete}
                onGeneratedMnemonic={handleGeneratedMnemonic}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />

        <Route path="/" element={
          !isAuthenticated ? (
            <LoginPage
              onMnemonicComplete={handleKeyComplete}
              onGeneratedMnemonic={handleGeneratedMnemonic}
            />
          ) : (
            <div className="relative h-screen w-full overflow-hidden bg-[#03030d] text-white">
              {!mnemonic ? (
                <>
                  <div className="fixed inset-0 z-[-1] pointer-events-none">
                    <LandingBackground />
                  </div>
                  {preferPinUnlock && isLocalPinEnabled() ? (
                    <PinUnlockModal
                      isOpen
                      onUnlocked={(words) => {
                        handleKeyComplete(words);
                        setPreferPinUnlock(false);
                        setShowMnemonicAuth(false);
                      }}
                      onUseMnemonicInstead={() => setPreferPinUnlock(false)}
                    />
                  ) : (
                    <AuthModal
                      isOpen={showMnemonicAuth || !mnemonic}
                      onClose={() => setShowMnemonicAuth(true)}
                      initialMode="mnemonic"
                      onMnemonicComplete={(words) => {
                        handleKeyComplete(words);
                        setPreferPinUnlock(false);
                      }}
                      onGeneratedMnemonic={(words) => {
                        handleGeneratedMnemonic(words);
                        setPreferPinUnlock(false);
                      }}
                    />
                  )}
                </>
              ) : (
                <div className="relative z-10 flex h-screen w-full flex-col overflow-hidden bg-transparent">
                  {/* 3D Universe Canvas as Core View */}
                  {memoryView === 'universe' ? <Universe3D /> : (
                    <MemoryListView memories={universeMemories} mode={memoryView}
                      selectedMemoryId={selectedMemoryId} onSelect={selectMemory} />
                  )}

                  {/* Atmospheric Vignette + Depth */}
                  <div
                    className="pointer-events-none absolute inset-0 z-10"
                    style={{
                      background: `
                        radial-gradient(ellipse 70% 55% at 50% 45%, transparent 30%, rgba(3,3,13,0.55) 100%),
                        linear-gradient(180deg, rgba(3,3,13,0.72) 0%, rgba(3,3,13,0.02) 22%, rgba(3,3,13,0.02) 72%, rgba(3,3,13,0.85) 100%)
                      `,
                    }}
                  />

                  {/* Top Header */}
                  <header className="pointer-events-none absolute left-0 top-0 z-40 flex w-full flex-wrap items-start justify-between gap-3 p-4 md:p-6">
                    <div className="pointer-events-auto flex items-center gap-3">
                      <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#020617]/65 px-3.5 py-2 shadow-xl backdrop-blur-xl">
                        <div className="rounded-lg border border-violet-400/25 bg-violet-500/15 p-1.5 shadow-[0_0_12px_rgba(139,92,246,0.3)]">
                          <Brain className="h-4 w-4 text-violet-300" />
                        </div>
                        <div className="hidden sm:block">
                          <p className="text-sm font-semibold tracking-tight text-white">Mnemosyne OS</p>
                          <p className="text-[10px] text-slate-400">
                            {t('appCelestialCount', {
                              bodies: universeMemories.length,
                              orbits: universeMemories.reduce((acc, m) => acc + m.connections.length, 0) / 2,
                            })}
                          </p>
                        </div>
                      </div>
                      {isFreeFirstMode && (
                        <span className="hidden items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-100 md:inline-flex">
                          <Sparkles className="h-3 w-3" />
                          {monetizationCopy.previewName}
                        </span>
                      )}
                    </div>

                    <div className="pointer-events-auto ml-auto flex flex-wrap items-center justify-end gap-2">
                      <div role="group" aria-label={t('tabUniverse')} className="flex rounded-full border border-white/10 bg-[#020617]/75 p-1 backdrop-blur-md">
                        {([
                          ['universe', Globe, 'memoryViewUniverse'],
                          ['list', List, 'memoryViewList'],
                          ['table', Table2, 'memoryViewTable'],
                        ] as const).map(([view, Icon, label]) => (
                          <button key={view} type="button" onClick={() => setMemoryView(view)}
                            aria-label={t(label)} aria-pressed={memoryView === view}
                            title={t(label)}
                            className={`rounded-full p-2 ${memoryView === view ? 'bg-violet-500/30 text-white' : 'text-slate-400 hover:text-white'}`}>
                            <Icon className="h-4 w-4" />
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={() => setIsReviewInboxOpen(true)}
                        aria-label={t('reviewInbox')} title={t('reviewInbox')}
                        className="rounded-full border border-white/10 bg-[#020617]/75 p-2 text-slate-300 hover:text-white">
                        <ClipboardList className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSidebarTab('insights');
                          setIsSidebarOpen((prev) => !prev);
                        }}
                        className={`flex items-center gap-2 rounded-full border px-3.5 py-2 backdrop-blur-md transition-all duration-300 ${
                          isSidebarOpen && sidebarTab === 'insights'
                            ? 'border-cyan-400/40 bg-cyan-500/20 text-white shadow-[0_0_18px_rgba(34,211,238,0.3)]'
                            : 'border-violet-400/20 bg-violet-500/10 text-violet-100/90 hover:bg-violet-500/20 hover:text-white'
                        }`}
                        title={t('appInsightsTitle')}
                      >
                        <Sparkles className="h-4 w-4 text-cyan-300" />
                        <span className="hidden text-xs font-medium tracking-wider uppercase sm:inline">{t('appInsights')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsPulseOpen(true)}
                        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/70 backdrop-blur-md transition-all duration-300 hover:bg-white/10 hover:text-white"
                        title={t('appPulseTitle')}
                      >
                        <Activity className="h-4 w-4" />
                        <span className="hidden text-xs font-medium tracking-wider uppercase sm:inline">{t('appPulse')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsExportOpen(true)}
                        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/70 backdrop-blur-md transition-all duration-300 hover:bg-white/10 hover:text-white"
                        title={t('exportTitle')}
                      >
                        <Archive className="h-4 w-4" />
                        <span className="hidden text-xs font-medium tracking-wider uppercase sm:inline">Export</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsSettingsOpen(true)}
                        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/70 backdrop-blur-md transition-all duration-300 hover:bg-white/10 hover:text-white"
                        title={t('settings')}
                      >
                        <Settings className="h-4 w-4" />
                        <span className="hidden text-xs font-medium tracking-wider uppercase sm:inline">{t('settings')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/70 backdrop-blur-md transition-all duration-300 hover:bg-white/10 hover:text-white"
                        title={t('appLogoutTitle')}
                      >
                        <LogOut className="h-4 w-4" />
                        <span className="hidden text-xs font-medium tracking-wider uppercase sm:inline">{t('appLogout')}</span>
                      </button>
                    </div>
                  </header>

                  {legacyPersonalCount > 0 && (
                    <div role="alert" className="absolute left-4 top-20 z-40 max-w-md rounded-xl border border-amber-400/40 bg-slate-950/95 p-3 text-sm text-amber-100 shadow-xl md:left-6 md:top-24">
                      <p>{t('appLegacyPlaintext', { count: legacyPersonalCount })}</p>
                      <button type="button" onClick={() => { setSettingsSection('privacy'); setIsSettingsOpen(true); }} className="mt-2 font-semibold underline underline-offset-2">
                        {t('appLegacyAction')}
                      </button>
                    </div>
                  )}

                  {/* Universe HUD on top right */}
                  {memoryView === 'universe' && <div className="pointer-events-none absolute right-3 top-[4.5rem] z-30 sm:right-5">
                    <div className="pointer-events-auto">
                      <UniverseHUD />
                    </div>
                  </div>}

                  {/* Drag & Drop over 3D Space */}
                  <div
                    className="absolute inset-0 z-20"
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                    onDrop={handleDrop}
                    style={{ pointerEvents: isDragging ? 'auto' : 'none' }}
                  >
                    {isDragging && (
                      <div className="absolute inset-0 z-[100] m-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-indigo-400/50 bg-indigo-950/75 backdrop-blur-md">
                        <div className="mb-4 rounded-full bg-indigo-500/20 p-4">
                          <Activity className="h-8 w-8 animate-pulse text-indigo-300" />
                        </div>
                        <h2 className="text-2xl font-bold uppercase tracking-widest text-white">{t('appDropTitle')}</h2>
                        <p className="mt-2 text-sm text-indigo-200/70">{t('appDropBody')}</p>
                      </div>
                    )}
                  </div>

                  {/* Empty Universe Overlay */}
                  {memoryView === 'universe' && universeMemories.length === 0 && (
                    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6">
                      <div className="pointer-events-auto max-w-md rounded-3xl border border-violet-400/20 bg-[#050514]/80 px-7 py-8 text-center shadow-[0_0_60px_rgba(99,102,241,0.18)] backdrop-blur-xl">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-400/30 bg-violet-500/15">
                          <Sparkles className="h-5 w-5 text-violet-200" />
                        </div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200/70">{t('appEmptyEyebrow')}</p>
                        <h2 className="mt-2 text-lg font-semibold text-white">{t('appEmptyTitle')}</h2>
                        <p className="mt-2 text-sm leading-relaxed text-white/50">
                          {t('appEmptyBody')}
                        </p>
                        <div className="mt-5 flex flex-col gap-2">
                          <button
                            type="button"
                            disabled={isBootstrappingUniverse || !mnemonic}
                            onClick={() => void handleAssimilateStarter()}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/25 px-4 py-2.5 text-sm font-semibold text-violet-50 transition hover:bg-violet-500/35 disabled:opacity-40"
                          >
                            <Rocket className="h-4 w-4" />
                            {t('appEmptyStarter')}
                          </button>
                          <button
                            type="button"
                            disabled={!mnemonic}
                            onClick={() => {const actor=auth.currentUser?.uid;if(!actor)return;vaultActorRef.current={uid:actor,current:captureImportFeedback(actor)};if(vaultActorRef.current.current())vaultInputRef.current?.click();}}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-40"
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('appEmptyVault')}
                          </button>
                          <button
                            type="button"
                            onClick={() => focusUniverseCapture()}
                            className="text-xs text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
                          >
                            {t('appEmptyWrite')}
                          </button>
                        </div>
                        <input
                          ref={(el) => {
                            vaultInputRef.current = el;
                            if (el) {
                              el.setAttribute('webkitdirectory', '');
                              el.setAttribute('directory', '');
                            }
                          }}
                          type="file"
                          className="hidden"
                          multiple
                          accept={DOCUMENT_FILE_ACCEPT}
                          onChange={(event) => {
                            const list = event.target.files;
                            const captured=vaultActorRef.current;vaultActorRef.current=null;
                            if(captured&&!captured.current()){event.target.value='';return;}
                            if (!list?.length) return;
                            void runVaultOrDocumentImport(Array.from(list),captured??undefined);
                            event.target.value = '';
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="pointer-events-auto absolute bottom-24 left-3 z-40 max-w-md">
                    <AttachedMemoryRecoveryPanel onMemoryCreated={handleMemoryCreated} />
                    <MemoryEditRecoveryPanel/><TeamConnectionRecoveryPanel/><SemanticClusterRecoveryPanel/><SemanticRelationRecoveryPanel/><SyncConflictRecoveryPanel/><PersonalMigrationRecoveryPanel/><TeamHistoryChangeRecoveryPanel/>
                  </div>
                  <StudyModePanel onSave={saveMemory} />
                  {isReviewInboxOpen && currentUser && (
                    <ReviewInboxPanel key={currentUser.uid} uid={currentUser.uid} memories={universeMemories}
                      selectedMemoryId={selectedMemoryId} onOpenSource={(memoryId) => {
                        selectMemory(memoryId);
                        setSidebarTab('memory');
                        setIsSidebarOpen(true);
                      }}
                      onClose={() => setIsReviewInboxOpen(false)} />
                  )}

                  {/* Cognitive Floating Input — sempre no Universo */}
                  <CognitiveInput
                    mnemonic={mnemonic}
                    onWebResearchCommand={openWebResearch}
                    existingMemories={allSessions}
                    onMemoryCreated={handleMemoryCreated}
                  />

                  {/* Unified Cognitive Sidebar Drawer */}
                  <CognitiveSidebar
                    isOpen={isSidebarOpen}
                    onClose={() => {
                      setIsSidebarOpen(false);
                      selectMemory(null);
                    }}
                    activeTab={sidebarTab}
                    onTabChange={setSidebarTab}
                    allSessions={allSessions}
                    onSaveMemory={saveMemory}
                    onDeleteMemory={deleteMemory}
                    onOpenTransmission={openTransmission}
                    onOpenWebResearch={openWebResearch}
                    onOpenExport={() => setIsExportOpen(true)}
                  />

                  {/* Main Floating Dock */}
                  <nav className="mnem-dock absolute bottom-6 left-1/2 z-30 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto p-1.5 sm:bottom-8 sm:p-2" aria-label={t('appNavMain')}>
                    <button
                      type="button"
                      onClick={() => focusUniverseCapture()}
                      className={`mnem-dock-item ${isCaptureOpen ? 'mnem-dock-item-active' : ''}`}
                      title={t('appDockCaptureTitle')}
                    >
                      <PenLine className="h-4 w-4 text-cyan-300" />
                      <span>{t('tabCapture')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSidebarTab('insights');
                        setIsSidebarOpen(true);
                      }}
                      className={`mnem-dock-item ${isSidebarOpen && sidebarTab === 'insights' ? 'mnem-dock-item-active' : ''}`}
                      title={t('appInsightsTitle')}
                    >
                      <Sparkles className="h-4 w-4 text-violet-300" />
                      <span>{t('appInsights')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSidebarTab('web');
                        setIsSidebarOpen(true);
                      }}
                      className={`mnem-dock-item ${isSidebarOpen && sidebarTab === 'web' ? 'mnem-dock-item-active' : ''}`}
                      title={t('appDockWebTitle')}
                    >
                      <Globe className="h-4 w-4 text-sky-300" />
                      <span>{t('btnWeb')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openTransmission(null, 'compose')}
                      className={`mnem-dock-item ${isTransmissionOpen ? 'mnem-dock-item-active' : ''}`}
                      title={t('appDockCommsTitle')}
                    >
                      <Radio className="h-4 w-4 text-fuchsia-300" />
                      <span>Comms</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openCommandPalette()}
                      className="mnem-dock-item"
                      title={t('appDockSearchTitle')}
                    >
                      <Search className="h-4 w-4 text-slate-300" />
                      <span className="hidden sm:inline">{t('appSearch')}</span>
                    </button>
                  </nav>
                </div>
              )}
            </div>
          )
        } />
      </Routes>

      {/* Modais Globais */}
      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => {
            setIsSettingsOpen(false);
            setSettingsSection(null);
          }}
          mnemonic={mnemonic}
          onResetKey={handleResetKey}
          sessions={allSessions}
          onOpenExport={() => {
            setIsSettingsOpen(false);
            setExportForMigration(true);
            setIsExportOpen(true);
          }}
          initialSection={settingsSection}
          onReplayOnboarding={() => setReplayOnboarding(true)}
        />
      )}

      <OnboardingTour
        enabled={isAuthenticated && Boolean(mnemonic)}
        forceOpen={replayOnboarding}
        onForceConsumed={() => setReplayOnboarding(false)}
        onFocusCapture={() => focusUniverseCapture()}
        onOpenSearch={() => openCommandPalette()}
        onOpenUniverse={() => {
          setIsSidebarOpen(false);
        }}
      />

      {isPulseOpen && currentUser && (
        <CognitivePulsePanel
          isOpen={isPulseOpen}
          onClose={() => setIsPulseOpen(false)}
          uid={currentUser.uid}
          sessions={sessions}
          onOpenMemory={(memoryId: string) => {
            selectMemory(memoryId);
            setIsSidebarOpen(true);
            setSidebarTab('memory');
            setIsPulseOpen(false);
          }}
          onOpenInsights={() => {
            setSidebarTab('insights');
            setIsSidebarOpen(true);
            setIsPulseOpen(false);
          }}
        />
      )}

      {isWebResearchOpen && (
        <WebResearchPanel
          isOpen={isWebResearchOpen}
          onClose={() => setIsWebResearchOpen(false)}
          initialQuery={webResearchQuery}
          sessions={allSessions}
          onMemoryCreated={(memoryId: string) => {
            selectMemory(memoryId);
            setIsSidebarOpen(true);
            setSidebarTab('memory');
            setIsWebResearchOpen(false);
          }}
        />
      )}

      {isTransmissionOpen && (
        <TransmissionPanel
          isOpen={isTransmissionOpen}
          onClose={() => {
            setIsTransmissionOpen(false);
            setTransmissionDraft(null);
            setTransmissionTab('compose');
          }}
          mnemonic={mnemonic}
          initialDraft={transmissionDraft}
          initialTab={transmissionTab}
        />
      )}

      <CommandPalette
        key={`${currentUser?.uid || 'anonymous'}:${Boolean(mnemonic)}`}
        uid={currentUser?.uid}
        vaultUnlocked={Boolean(mnemonic)}
        memories={sessions}
        searchQuery={searchQuery}
        searchResults={searchResults}
        onSearchQueryChange={setSearchQuery}
        onMemorySelect={(session) => {
          selectMemory(session.id);
          setIsSidebarOpen(true);
          setSidebarTab('memory');
        }}
        onWebResearch={openWebResearch}
        onOpenSettings={(section) => {
          setSettingsSection(section || null);
          setIsSettingsOpen(true);
        }}
        onOpenPulse={() => setIsPulseOpen(true)}
        onOpenInsights={() => {
          setSidebarTab('insights');
          setIsSidebarOpen(true);
        }}
        onOpenExport={() => setIsExportOpen(true)}
      />
      <SovereignExportModal
        isOpen={isExportOpen}
        onClose={() => { setIsExportOpen(false); setExportForMigration(false); }}
        memories={universeMemories}
        vaultUnlocked={Boolean(mnemonic)}
        encryptByDefault={exportForMigration}
      />
      <MnemonicBackupModal
        mnemonic={generatedMnemonicToShow}
        onClose={() => setGeneratedMnemonicToShow(null)}
      />
    </>
  );
};

export default App;
