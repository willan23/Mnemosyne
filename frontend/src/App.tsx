import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { AuthModal } from './components/AuthModal';
import { MemoryGraph } from './components/MemoryGraph';
import { SettingsModal } from './components/SettingsModal';
import { MemoryEditorModal } from './components/MemoryEditorModal';
import { OrphanedMemoriesWarning } from './components/OrphanedMemoriesWarning';
import { ShareView } from './pages/ShareView';
import { PricingPage } from './pages/PricingPage';
import { CheckoutSuccess } from './pages/CheckoutSuccess';
import { CheckoutCancel } from './pages/CheckoutCancel';
import { PrivacyPage } from './pages/PrivacyPage';
import { UniversePage } from './pages/UniversePage';
import { LoginPage } from './pages/LoginPage';
import { MobilePairingPage } from './pages/MobilePairingPage';
import { LandingBackground } from './components/landing/LandingBackground';
import type { FilterOptions, SessionData } from './hooks/useSessions';
import { Search, Compass, Activity, Brain, Globe, LogOut } from 'lucide-react';
import { db, auth } from './firebase';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Toaster } from 'react-hot-toast';

import { useSessions } from './hooks/useSessions';
import { useGraphData } from './hooks/useGraphData';
import { useSemanticClusterBackfill } from './hooks/useSemanticClusterBackfill';
import { useUI } from './contexts/UIContext';
import { CommandPalette } from './components/CommandPalette';
import { CognitiveInput } from './components/CognitiveInput';
import { NotificationSystem } from './components/NotificationSystem';
import { TransmissionPanel, type TransmissionDraft } from './components/TransmissionPanel';
import { InsightsPanel } from './components/InsightsPanel';
import { Radio } from 'lucide-react';

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
  const [currentUser, setCurrentUser] = useState<User | null>(() => auth.currentUser);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(() => Boolean(auth.currentUser));
  const [mnemonic, setMnemonic] = useState<string[] | null>(null);
  const isAuthenticated = Boolean(currentUser);

  // States para UI Data
  const [editingSession, setEditingSession] = useState<SessionData | null>(null);

  // OS Navigation (Tabs/Modes)
  const [activeMode, setActiveMode] = useState<'flow' | 'insights'>('flow');

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

  // States do Global Store (UI Context)
  const {
    isSettingsOpen, setIsSettingsOpen,
    openCommandPalette
  } = useUI();

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

  // Não carregar mais a mnemônica do localStorage (Zero-Knowledge):
  // A mnemônica só existirá em memória volátil (state) durante a sessão.

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

  const handleKeyComplete = (newMnemonic: string[]) => {
    setMnemonic(newMnemonic);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setMnemonic(null);
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

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (!auth.currentUser) {
      alert("Precisas de criar a tua Mente Digital antes de assimilar ficheiros.");
      return;
    }

    try {
      const items = Array.from(e.dataTransfer.items);
      if (items.length === 0) return;

      const { collection, addDoc } = await import('firebase/firestore');

      // Helper function to process an entry (file or directory)
      const processEntry = async (entry: any, parentCluster?: string): Promise<void> => {
        if (entry.isFile) {
          const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
            const tags = ['documento'];
            if (parentCluster) tags.push(`sistema-solar:${parentCluster}`);
            
            if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
              const text = await file.text();
              await addDoc(collection(db, 'sessions'), {
                text: `[Planeta/Documento: ${file.name}]\n\n${text.substring(0, 5000)}`,
                timestamp: Date.now(),
                updatedAt: Date.now(),
                uid: auth.currentUser!.uid,
                tags,
                processingMethod: 'file-drop'
              });
            } else {
              alert(`O ficheiro "${file.name}" não foi importado. Nesta versão, o drop aceita apenas .txt e .md para evitar criar memórias sem conteúdo extraído.`);
            }
        } else if (entry.isDirectory) {
          const dirReader = entry.createReader();
          const entries = await new Promise<any[]>((resolve, reject) => dirReader.readEntries(resolve, reject));
          await Promise.all(entries.map((subEntry) => processEntry(subEntry, entry.name)));
        }
      };

      for (const item of items) {
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            await processEntry(entry);
          }
        }
      }
      
      alert('Importação concluída para os documentos .txt/.md suportados.');
    } catch (err) {
      console.error(err);
      alert("❌ Erro ao processar ficheiros.");
    }
  };

  if (!isAuthReady) {
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
        <Route path="/universe"       element={<UniversePage />} />
        <Route path="/mobile/pair"    element={<MobilePairingPage />} />
        <Route path="/login"          element={!isAuthenticated ? <LoginPage onMnemonicComplete={handleKeyComplete} /> : <Navigate to="/" replace />} />

        <Route path="/" element={
          !isAuthenticated ? (
            <LoginPage onMnemonicComplete={handleKeyComplete} />
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
                  <AuthModal
                    isOpen={showMnemonicAuth}
                    onClose={() => setShowMnemonicAuth(false)}
                    initialMode="mnemonic"
                    onMnemonicComplete={handleKeyComplete}
                  />
                </>
              ) : (
                <div className="relative z-10 w-full h-screen flex flex-col overflow-hidden bg-transparent">
                  <header className="absolute top-0 left-0 w-full p-8 flex justify-between items-start z-40">
                    <div className="flex items-center gap-3 pointer-events-none opacity-40 mix-blend-difference">
                      <Brain className="w-5 h-5 text-white" />
                    </div>
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all duration-300 backdrop-blur-md"
                      title="Sair (Logout)"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="text-xs font-medium tracking-wider uppercase">Sair</span>
                    </button>
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

                    <div className={`absolute inset-0 transition-opacity duration-[2000ms] ${activeMode === 'insights' ? 'opacity-100 z-30' : 'opacity-40 z-0'}`}>
                      <MemoryGraph
                        data={graphData}
                        sessions={sessions}
                        searchResultNodeIds={searchQuery.trim() ? filteredSessions.map((session) => session.id) : []}
                        focusedNodeId={focusedMemoryId}
                        onTransmitMemory={(session) => openTransmission({
                          memoryId: session.id,
                          title: session.title,
                          text: session.text,
                        })}
                      />
                    </div>

                    {activeMode === 'flow' && <CognitiveInput />}
                    {activeMode === 'insights' && (
                      <InsightsPanel sessions={sessions} onMemoryClick={setEditingSession} />
                    )}

                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-2 z-50 p-2 rounded-full border border-white/5 bg-[#020617]/80 backdrop-blur-3xl shadow-2xl mix-blend-screen overflow-hidden">
                      <button
                        onClick={() => setActiveMode('flow')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-full transition-all duration-300 ${activeMode === 'flow' ? 'bg-white/10 text-white shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]' : 'text-white/40 hover:text-white/80'}`}
                      >
                        <Compass className="w-4 h-4" />
                        <span className="text-[10px] uppercase tracking-widest font-medium">Flow</span>
                      </button>

                      <button
                        onClick={() => setActiveMode('insights')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-full transition-all duration-300 ${activeMode === 'insights' ? 'bg-white/10 text-white shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]' : 'text-white/40 hover:text-white/80'}`}
                      >
                        <Activity className="w-4 h-4" />
                        <span className="text-[10px] uppercase tracking-widest font-medium">Insights</span>
                      </button>

                      <button
                        onClick={() => { setActiveMode('flow'); openCommandPalette(); }}
                        className="flex items-center gap-2 px-6 py-3 rounded-full text-white/40 hover:text-white/80 hover:bg-white/5 transition-all duration-300 border-l border-white/5 ml-2"
                      >
                        <Search className="w-4 h-4" />
                        <span className="text-[10px] uppercase tracking-widest font-medium">Search</span>
                      </button>

                      <button
                        onClick={() => navigate('/universe')}
                        className="flex items-center gap-2 px-6 py-3 rounded-full text-white/40 hover:text-white/80 hover:bg-white/5 transition-all duration-300 border-l border-white/5 ml-2"
                      >
                        <Globe className="w-4 h-4" />
                        <span className="text-[10px] uppercase tracking-widest font-medium">Universe</span>
                      </button>

                      <button
                        onClick={() => openTransmission(null)}
                        className="flex items-center gap-2 px-6 py-3 rounded-full text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-all duration-300 border-l border-white/5 ml-2"
                      >
                        <Radio className="w-4 h-4" />
                        <span className="text-[10px] uppercase tracking-widest font-medium">Comms</span>
                      </button>
                    </div>
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
                      setFocusedMemoryId(memory.id);
                    }}
                  />
                  <SettingsModal
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    mnemonic={mnemonic}
                    onResetKey={() => { setMnemonic(null); }}
                    sessions={allSessions}
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
                </div>
              )}
            </div>
          )
        } />
      </Routes>
    </>
  );
};

export default App;
