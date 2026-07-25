import React, { useCallback, useState, useEffect } from 'react';
import { Routes, Route, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { AuthModal } from './components/AuthModal';
import { MnemonicBackupModal } from './components/MnemonicBackupModal';
import { MemoryGraph } from './components/MemoryGraph';
import { SettingsModal } from './components/SettingsModal';
import { MemoryEditorModal } from './components/MemoryEditorModal';
import { OrphanedMemoriesWarning } from './components/OrphanedMemoriesWarning';
import { ShareView } from './pages/ShareView';
import { PricingPage } from './pages/PricingPage';
import { CheckoutSuccess } from './pages/CheckoutSuccess';
import { CheckoutCancel } from './pages/CheckoutCancel';
import { PrivacyPage } from './pages/PrivacyPage';
import { AccountDeletionPage } from './pages/AccountDeletionPage';
import { UniversePage } from './pages/UniversePage';
import { LoginPage } from './pages/LoginPage';
import { MobilePairingPage } from './pages/MobilePairingPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { LandingBackground } from './components/landing/LandingBackground';
import type { FilterOptions, SessionData } from './hooks/useSessions';
import { Search, Compass, Activity, Brain, Globe, LogOut, Settings, Sparkles } from 'lucide-react';
import { db, auth } from './firebase';
import { getRedirectResult, onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import toast, { Toaster } from 'react-hot-toast';

import { useSessions } from './hooks/useSessions';
import { useGraphData } from './hooks/useGraphData';
import { useSemanticClusterBackfill } from './hooks/useSemanticClusterBackfill';
import { useUI } from './contexts/UIContext';
import { CommandPalette } from './components/CommandPalette';
import { CognitiveInput } from './components/CognitiveInput';
import { NotificationSystem } from './components/NotificationSystem';
import { TransmissionPanel, type TransmissionDraft } from './components/TransmissionPanel';
import { encodeCapsulePack } from './services/capsuleService';
import { InsightsPanel } from './components/InsightsPanel';
import { WebResearchPanel } from './components/WebResearchPanel';
import { Radio } from 'lucide-react';
import { publishCommsIdentity } from './services/commsIdentity';
import { isNewAuthUser } from './services/authFlow';
import { collectDroppedFiles, learnDocumentBatch } from './services/learningService';
import { generateMnemonic } from './utils/crypto';
import {
  readSessionMnemonic,
  saveSessionMnemonic,
  clearSessionMnemonic,
  startMnemonicIdleGuard,
  scrubLegacyKeyMaterial,
} from './utils/sessionMnemonic';
import { isLocalPinEnabled } from './utils/localPin';
import { isFreeFirstMode, monetizationCopy } from './config/monetization';
import { embeddingService } from './services/embeddingService';
import { OnboardingTour } from './components/OnboardingTour';
import { readMemoryIdFromSearch, stripMemoryFromUrl } from './utils/deepLinks';
import { PinUnlockModal } from './components/PinUnlockModal';
import { CognitivePulsePanel } from './components/CognitivePulsePanel';
import { shouldShowPulseToday } from './services/cognitivePulse';

const AuthBootScreen: React.FC = () => (
  <div className="relative min-h-screen overflow-hidden bg-[#020617] text-white">
    <LandingBackground />
    <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
      <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-slate-300 backdrop-blur-xl">
        <Brain className="h-4 w-4 text-violet-300" />
        <span>A restaurar sessão...</span>
      </div>
    </div>
  </div>
);

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState<User | null>(() => auth.currentUser);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(() => Boolean(auth.currentUser));
  const [isRedirectReady, setIsRedirectReady] = useState(false);
  const [mnemonic, setMnemonic] = useState<string[] | null>(() => readSessionMnemonic());
  const [generatedMnemonicToShow, setGeneratedMnemonicToShow] = useState<string[] | null>(null);
  const isAuthenticated = Boolean(currentUser);

  // States para UI Data
  const [editingSession, setEditingSession] = useState<SessionData | null>(null);

  // OS Navigation (Tabs/Modes)
  const [activeMode, setActiveMode] = useState<'flow' | 'insights'>('flow');
  const [isFlowComposerOpen, setIsFlowComposerOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [focusedMemoryId, setFocusedMemoryId] = useState<string | null>(null);
  const [filters] = useState<FilterOptions>({
    dateRange: 'all',
    tags: [],
    category: undefined
  });

  const [showOrphanedWarning, setShowOrphanedWarning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showMnemonicAuth, setShowMnemonicAuth] = useState(false);
  const [isTransmissionOpen, setIsTransmissionOpen] = useState(false);
  const [transmissionDraft, setTransmissionDraft] = useState<TransmissionDraft | null>(null);
  const [isWebResearchOpen, setIsWebResearchOpen] = useState(false);
  const [webResearchQuery, setWebResearchQuery] = useState('');
  const [forceOnboarding, setForceOnboarding] = useState(false);
  const [preferPinUnlock, setPreferPinUnlock] = useState(() => isLocalPinEnabled());
  const [isPulseOpen, setIsPulseOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);

  // States do Global Store (UI Context)
  const {
    isSettingsOpen, setIsSettingsOpen,
    openCommandPalette
  } = useUI();

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
    setGeneratedMnemonicToShow(null);
  }, []);

  // Scrub legacy plaintext keys + idle lock for mnemonic
  useEffect(() => {
    scrubLegacyKeyMaterial();
    return startMnemonicIdleGuard(() => {
      setMnemonic(null);
      const pinReady = isLocalPinEnabled();
      setPreferPinUnlock(pinReady);
      toast(
        pinReady
          ? 'Sessão cognitiva bloqueada. Desbloqueia com o PIN local ou a frase de 12 palavras.'
          : 'Sessão cognitiva bloqueada por inatividade. Desbloqueia com a frase de 12 palavras.',
        {
          icon: '🔒',
          duration: 5000,
        }
      );
    });
  }, []);

  useEffect(() => {
    const onWarn = (event: Event) => {
      const remaining = (event as CustomEvent<{ remainingMs: number }>).detail?.remainingMs ?? 0;
      const mins = Math.max(1, Math.round(remaining / 60_000));
      toast(`Sessão bloqueia em ~${mins} min por inatividade.`, { icon: '⏳', duration: 4000 });
    };
    window.addEventListener('mnemosyne:session-idle-warn', onWarn);
    return () => window.removeEventListener('mnemosyne:session-idle-warn', onWarn);
  }, []);

  // Warm embeddings model in background after unlock (non-blocking)
  useEffect(() => {
    if (!mnemonic) return;
    const t = window.setTimeout(() => {
      embeddingService.initialize().catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [mnemonic]);

  // Deep-link: /?memory=<id> foca a memória no grafo
  useEffect(() => {
    if (!isAuthenticated || !mnemonic) return;
    if (location.pathname !== '/') return;
    const memoryId = readMemoryIdFromSearch(location.search);
    if (!memoryId) return;
    setFocusedMemoryId(memoryId);
    setActiveMode('flow');
    setIsFlowComposerOpen(false);
    // Strip query after apply so refresh doesn't re-loop; keep history clean
    const t = window.setTimeout(() => stripMemoryFromUrl(), 800);
    return () => window.clearTimeout(t);
  }, [isAuthenticated, mnemonic, location.pathname, location.search]);

  // Custom Hooks substituindo lógica pesada
  // O hook useSessions agora gerencia todo o estado de dados e filtros
  const {
    sessions,
    allSessions,
    filteredSessions,
    orphanedCount
  } = useSessions(currentUser, searchQuery, filters);

  // Hook específico para transformar sessões em dados de grafo
  const graphData = useGraphData(sessions);
  useSemanticClusterBackfill(currentUser, sessions, isAuthenticated);

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
    publishCommsIdentity(currentUser, mnemonic).catch((error) => {
      console.warn('Unable to publish Comms identity:', error);
    });
  }, [currentUser, mnemonic]);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        setCurrentUser(user);
        setIsAuthReady(true);
      },
      (error) => {
        console.error('Erro ao restaurar sessão:', error);
        setCurrentUser(null);
        setIsAuthReady(true);
      }
    );
    return () => unsubscribe();
  }, []);

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

  // A mnemônica não vai para localStorage nem para o servidor. Mantemos apenas
  // um desbloqueio por aba/sessão para não pedir 12 palavras a cada navegação.

  // Mostrar AuthModal para mnemônica quando autenticado mas sem chave
  useEffect(() => {
    if (isAuthenticated && !mnemonic) {
      setShowMnemonicAuth(true);
    } else {
      setShowMnemonicAuth(false);
    }
  }, [isAuthenticated, mnemonic]);

  // Monitorar warning de orfãos vindo do hook
  useEffect(() => {
    if (orphanedCount > 0 && !mnemonic) {
      setShowOrphanedWarning(true);
    } else {
      setShowOrphanedWarning(false);
    }
  }, [orphanedCount, mnemonic]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      handleResetKey();
      setCurrentUser(null);
      navigate('/');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  };

  const handleCleanOrphanedMemories = async () => {
    if (!confirm('⚠️ ATENÇÃO: Isso eliminará TODAS as suas memórias antigas. Continuar?')) return;

    try {
      if (!auth.currentUser) return;

      const { collection, query, where, getDocs, deleteDoc } = await import('firebase/firestore');
      const sessionsRef = collection(db, 'sessions');
      const q = query(sessionsRef, where('uid', '==', auth.currentUser.uid));
      const snapshot = await getDocs(q);

      await Promise.all(snapshot.docs.map(doc => deleteDoc(doc.ref)));

      alert(`✅ ${snapshot.docs.length} memórias eliminadas.`);
      setShowOrphanedWarning(false);
    } catch (error) {
      const err = error as { message?: string };
      console.error('Error cleaning orphaned memories:', error);
      alert(`Erro: ${err.message || 'Erro desconhecido'}`);
    }
  };

  const openTransmission = (draft: TransmissionDraft | null = null) => {
    setTransmissionDraft(draft);
    setIsTransmissionOpen(true);
  };

  const openWebResearch = (query = '') => {
    setWebResearchQuery(query);
    setIsWebResearchOpen(true);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (!auth.currentUser) {
      alert("Precisas de criar a tua Mente Digital antes de assimilar ficheiros.");
      return;
    }

    try {
      const files = await collectDroppedFiles(e.dataTransfer);
      if (files.length === 0) return;
      const importToast = toast.loading(`A organizar ${files.length} ficheiro${files.length === 1 ? '' : 's'}...`);
      const result = await learnDocumentBatch(auth.currentUser.uid, files, allSessions);
      toast.success(`${result.imported} documento${result.imported === 1 ? '' : 's'} aprendidos e organizados.`, { id: importToast });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Erro ao processar ficheiros.');
    }
  };

  if (!isAuthReady || !isRedirectReady) {
    return (
      <>
        <Toaster position="top-right" />
        <NotificationSystem />
        <AuthBootScreen />
      </>
    );
  }

  return (
    <>
      <Toaster position="top-right" />
      <NotificationSystem />
      <Routes>
        <Route path="/share/:shareId" element={<ShareView />} />
        <Route path="/pricing"        element={<PricingPage />} />
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/checkout/cancel"  element={<CheckoutCancel />} />
        <Route path="/privacy"        element={<PrivacyPage />} />
        <Route path="/account-deletion" element={<AccountDeletionPage />} />
        <Route path="/analytics"      element={<AnalyticsPage />} />
        <Route path="/universe"       element={<UniversePage />} />
        <Route path="/mobile/pair"    element={<MobilePairingPage />} />
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
            <div className="min-h-screen text-[#ededed]">
              <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-[10%] left-[20%] w-[40vw] h-[40vw] bg-indigo-600/5 rounded-full blur-[120px]" />
                <div className="absolute bottom-[20%] right-[10%] w-[30vw] h-[30vw] bg-purple-600/5 rounded-full blur-[100px]" />
              </div>

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
                  <header className="pointer-events-none absolute left-0 top-0 z-40 flex w-full items-start justify-between gap-4 p-4 md:p-6">
                    <div className="pointer-events-auto flex items-center gap-3">
                      <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#020617]/55 px-3 py-2 backdrop-blur-xl">
                        <div className="rounded-lg border border-violet-400/25 bg-violet-500/15 p-1.5">
                          <Brain className="h-4 w-4 text-violet-300" />
                        </div>
                        <div className="hidden sm:block">
                          <p className="text-sm font-semibold tracking-tight text-white">Mnemosyne</p>
                          <p className="text-[10px] text-slate-400">
                            {sessions.length} memórias · {graphData.links?.length ?? 0} ligações
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
                    <div className="pointer-events-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPulseOpen(true)}
                        className="flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-violet-100/90 backdrop-blur-md transition-all duration-300 hover:bg-violet-500/20 hover:text-white"
                        title="Cognitive Pulse — ritual diário"
                      >
                        <Activity className="h-4 w-4" />
                        <span className="hidden text-xs font-medium tracking-wider uppercase sm:inline">Pulso</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsSettingsOpen(true)}
                        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/70 backdrop-blur-md transition-all duration-300 hover:bg-white/10 hover:text-white"
                        title="Definições"
                      >
                        <Settings className="h-4 w-4" />
                        <span className="hidden text-xs font-medium tracking-wider uppercase sm:inline">Definições</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/70 backdrop-blur-md transition-all duration-300 hover:bg-white/10 hover:text-white"
                        title="Sair (Logout)"
                      >
                        <LogOut className="h-4 w-4" />
                        <span className="hidden text-xs font-medium tracking-wider uppercase sm:inline">Sair</span>
                      </button>
                    </div>
                  </header>

                  {showOrphanedWarning && (
                    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50">
                      <OrphanedMemoriesWarning
                        memoriesCount={orphanedCount}
                        onResetAndClean={handleCleanOrphanedMemories}
                        onDismiss={() => setShowOrphanedWarning(false)}
                      />
                    </div>
                  )}

                  <main 
                    className="flex-1 w-full h-full relative"
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                    onDrop={handleDrop}
                  >
                    {isDragging && (
                      <div className="absolute inset-0 z-[100] bg-indigo-500/20 backdrop-blur-sm border-2 border-dashed border-indigo-500/50 flex flex-col items-center justify-center rounded-2xl m-4 pointer-events-none transition-all">
                        <div className="p-4 bg-indigo-900/40 rounded-full mb-4">
                          <Activity className="w-8 h-8 text-indigo-400 animate-pulse" />
                        </div>
                        <h2 className="text-2xl font-bold text-white tracking-widest uppercase">Assimilar Ficheiros</h2>
                        <p className="text-indigo-200/60 mt-2">Larga os documentos para criar novas memórias ou sistemas solares.</p>
                      </div>
                    )}

                    <div className={`absolute inset-0 transition-opacity duration-[2000ms] ${activeMode === 'insights' || !isFlowComposerOpen ? 'opacity-100 z-30' : 'opacity-40 z-0'}`}>
                      <MemoryGraph
                        data={graphData}
                        sessions={sessions}
                        searchResultNodeIds={searchQuery.trim() ? filteredSessions.map((session) => session.id) : []}
                        focusedNodeId={focusedMemoryId}
                        onTransmitMemory={(session, options) => {
                          if (options?.includeLinked && session.connections?.length) {
                            const byId = new Map(allSessions.map((s) => [s.id, s]));
                            const linked = session.connections
                              .map((id) => byId.get(id))
                              .filter((s): s is typeof session => Boolean(s?.text?.trim()))
                              .slice(0, 12);
                            const items = [
                              { title: session.title, text: session.text, tags: session.tags },
                              ...linked.map((s) => ({ title: s.title, text: s.text, tags: s.tags })),
                            ];
                            openTransmission({
                              memoryId: session.id,
                              title: `Pack: ${session.title || 'Memórias'}`,
                              text: encodeCapsulePack(items),
                              isPack: true,
                              packCount: items.length,
                            });
                            return;
                          }
                          openTransmission({
                            memoryId: session.id,
                            title: session.title,
                            text: session.text,
                          });
                        }}
                      />
                    </div>

                    {activeMode === 'flow' && isFlowComposerOpen && (
                      <CognitiveInput
                        onWebResearchCommand={openWebResearch}
                        existingMemories={allSessions}
                        onClose={() => setIsFlowComposerOpen(false)}
                        onMemoryCreated={(memoryId) => {
                          setFocusedMemoryId(memoryId);
                          setSearchQuery('');
                        }}
                      />
                    )}
                    {activeMode === 'insights' && (
                      <InsightsPanel
                        sessions={sessions}
                        onMemoryClick={setEditingSession}
                        onClose={() => setActiveMode('flow')}
                      />
                    )}

                    <nav
                      className="mnem-dock absolute bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto p-1.5 sm:bottom-8 sm:gap-1.5 sm:p-2"
                      aria-label="Navegação principal"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveMode('flow');
                          setIsFlowComposerOpen((open) => (activeMode === 'flow' ? !open : true));
                        }}
                        className={`mnem-dock-item ${activeMode === 'flow' && isFlowComposerOpen ? 'mnem-dock-item-active' : ''}`}
                      >
                        <Compass className="h-4 w-4" />
                        <span>Flow</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveMode('insights');
                          setIsFlowComposerOpen(false);
                        }}
                        className={`mnem-dock-item ${activeMode === 'insights' ? 'mnem-dock-item-active' : ''}`}
                      >
                        <Activity className="h-4 w-4" />
                        <span>Insights</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveMode('flow');
                          setIsFlowComposerOpen(false);
                          openCommandPalette();
                        }}
                        className="mnem-dock-item"
                      >
                        <Search className="h-4 w-4" />
                        <span>Search</span>
                      </button>

                      <span className="mx-0.5 hidden h-6 w-px bg-white/10 sm:block" aria-hidden />

                      <button
                        type="button"
                        onClick={() => openWebResearch('')}
                        className="mnem-dock-item mnem-dock-item-cyan"
                      >
                        <Globe className="h-4 w-4" />
                        <span className="hidden sm:inline">Web</span>
                        <span className="sm:hidden">Web</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => navigate('/universe')}
                        className="mnem-dock-item"
                      >
                        <Sparkles className="h-4 w-4" />
                        <span>Universe</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openTransmission(null)}
                        className="mnem-dock-item mnem-dock-item-indigo"
                      >
                        <Radio className="h-4 w-4" />
                        <span>Comms</span>
                      </button>
                    </nav>
                  </main>

                  <CommandPalette
                    memories={filteredSessions}
                    searchQuery={searchQuery}
                    onSearchQueryChange={(query) => {
                      setSearchQuery(query);
                      if (!query.trim()) setFocusedMemoryId(null);
                    }}
                    onMemorySelect={(memory) => {
                      setActiveMode('flow');
                      setIsFlowComposerOpen(false);
                      setFocusedMemoryId(memory.id);
                    }}
                    onWebResearch={openWebResearch}
                    onOpenSettings={(section) => {
                      setSettingsSection(section || null);
                      setIsSettingsOpen(true);
                    }}
                    onOpenPulse={() => setIsPulseOpen(true)}
                    onOpenInsights={() => {
                      setActiveMode('insights');
                      setIsFlowComposerOpen(false);
                    }}
                  />
                  <SettingsModal
                    isOpen={isSettingsOpen}
                    onClose={() => {
                      setIsSettingsOpen(false);
                      setSettingsSection(null);
                    }}
                    mnemonic={mnemonic}
                    onResetKey={handleResetKey}
                    sessions={allSessions}
                    onReplayOnboarding={() => setForceOnboarding(true)}
                    initialSection={settingsSection}
                  />
                  <CognitivePulsePanel
                    isOpen={isPulseOpen}
                    sessions={sessions}
                    uid={currentUser?.uid || ''}
                    onClose={() => setIsPulseOpen(false)}
                    onOpenMemory={(memoryId) => {
                      setFocusedMemoryId(memoryId);
                      setActiveMode('flow');
                      setIsFlowComposerOpen(false);
                      setIsPulseOpen(false);
                    }}
                    onOpenInsights={() => {
                      setActiveMode('insights');
                      setIsFlowComposerOpen(false);
                      setIsPulseOpen(false);
                    }}
                  />
                  <MemoryEditorModal session={editingSession} allMemories={sessions} onMemoryClick={setEditingSession} onClose={() => setEditingSession(null)} />
                  <TransmissionPanel
                    isOpen={isTransmissionOpen}
                    onClose={() => {
                      setIsTransmissionOpen(false);
                      setTransmissionDraft(null);
                    }}
                    mnemonic={mnemonic}
                    initialDraft={transmissionDraft}
                  />
                  <WebResearchPanel
                    isOpen={isWebResearchOpen}
                    onClose={() => setIsWebResearchOpen(false)}
                    sessions={sessions}
                    initialQuery={webResearchQuery}
                    onMemoryCreated={(memoryId) => {
                      setFocusedMemoryId(memoryId);
                      setSearchQuery('');
                      setActiveMode('insights');
                    }}
                  />
                  <OnboardingTour
                    enabled={Boolean(currentUser && mnemonic)}
                    forceOpen={forceOnboarding}
                    onForceConsumed={() => setForceOnboarding(false)}
                    onOpenFlow={() => {
                      setActiveMode('flow');
                      setIsFlowComposerOpen(true);
                    }}
                    onOpenSearch={() => openCommandPalette()}
                    onOpenUniverse={() => navigate('/universe')}
                  />
                </div>
              )}
            </div>
          )
        } />
      </Routes>
      <MnemonicBackupModal
        mnemonic={generatedMnemonicToShow}
        onClose={() => setGeneratedMnemonicToShow(null)}
      />
    </>
  );
};

export default App;
