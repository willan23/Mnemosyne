import React, { useState, useEffect, useMemo } from 'react';
import { Routes, Route } from 'react-router-dom';
import { KeyCeremony } from './components/KeyCeremony';
import { MemoryGraph } from './components/MemoryGraph';
import { SettingsModal } from './components/SettingsModal';
import { MemoryEditorModal } from './components/MemoryEditorModal';
import { NotificationCenter } from './components/NotificationCenter';
import { SubscriptionStatus } from './components/SubscriptionStatus';
import { LogoutButton } from './components/LogoutButton';
import { ShareView } from './pages/ShareView';
import { AnalyticsDashboard } from './pages/AnalyticsDashboard';
import { PricingPage } from './pages/PricingPage';
import { CheckoutSuccess } from './pages/CheckoutSuccess';
import { CheckoutCancel } from './pages/CheckoutCancel';
import { SearchBar } from './components/SearchBar';
import { FilterPanel } from './components/FilterPanel';
import type { FilterOptions } from './components/FilterPanel';
import { useTheme } from './contexts/ThemeContext';
import { Brain, Star, Settings, Mic, StopCircle, Send, Edit3, Eye, Sun, Moon, BarChart3, Crown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSpeechToText } from './hooks/useSpeechToText';
import { db, auth } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { AuthModal } from './components/AuthModal';
import { onAuthStateChanged } from 'firebase/auth';
interface Node {
  id: string;
  name: string;
  val: number;
}

interface Link {
  source: string;
  target: string;
}

interface GraphData {
  nodes: Node[];
  links: Link[];
}

const App: React.FC = () => {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [mnemonic, setMnemonic] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [sessions, setSessions] = useState<any[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<any | null>(null);
  const [manualText, setManualText] = useState('');
  const [isWritingMode, setIsWritingMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterOptions>({

    dateRange: 'all',
    tags: [],
    category: undefined
  });
  const { isListening, transcript, startListening, stopListening } = useSpeechToText();

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setShowAuthModal(true);
      } else {
        setShowAuthModal(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Load mnemonic from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('mnemosyne_mnemonic');
    if (saved) {
      const mn = JSON.parse(saved);
      setMnemonic(mn);
    }
    setIsLoading(false);
  }, []);

  // Sessions listener (only when mnemonic exists and user is authenticated)
  useEffect(() => {
    if (!mnemonic || !auth.currentUser) {
      return;
    }

    // Real-time listener for user's own sessions only
    const q = query(
      collection(db, "sessions"),
      where("uid", "==", auth.currentUser.uid),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allNodes: Node[] = [];
      const allLinks: Link[] = [];
      const allSessions: any[] = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        const sess = { id: doc.id, ...data };
        allSessions.push(sess);

        if (data.nodes) allNodes.push(...data.nodes);
        if (data.links) allLinks.push(...data.links);
      });

      setSessions(allSessions);
      setGraphData({ nodes: allNodes, links: allLinks });
    });

    return () => unsubscribe();
  }, [mnemonic, auth.currentUser]);

  // Filter and search logic
  const filteredSessions = useMemo(() => {
    let result = [...sessions];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.text?.toLowerCase().includes(query) ||
        s.tags?.some((tag: string) => tag.toLowerCase().includes(query))
      );
    }

    // Date range filter
    if (filters.dateRange !== 'all') {
      const now = Date.now();
      const ranges = {
        today: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        year: 365 * 24 * 60 * 60 * 1000
      };
      const cutoff = now - ranges[filters.dateRange as keyof typeof ranges];
      result = result.filter(s => s.timestamp > cutoff);
    }

    // Tags filter
    if (filters.tags.length > 0) {
      result = result.filter(s =>
        s.tags?.some((tag: string) => filters.tags.includes(tag))
      );
    }

    // Category filter
    if (filters.category) {
      result = result.filter(s => s.category === filters.category);
    }

    return result;
  }, [sessions, searchQuery, filters]);

  // Get all available tags and categories
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    sessions.forEach(s => {
      s.tags?.forEach((tag: string) => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [sessions]);

  const availableCategories = useMemo(() => {
    const categories = new Set<string>();
    sessions.forEach(s => {
      if (s.category) categories.add(s.category);
    });
    return Array.from(categories).sort();
  }, [sessions]);

  const handleKeyComplete = (newMnemonic: string[]) => {
    localStorage.setItem('mnemosyne_mnemonic', JSON.stringify(newMnemonic));
    setMnemonic(newMnemonic);
  };

  const handleRecordingToggle = async () => {
    if (isListening) {
      stopListening();
      if (transcript.trim()) {
        try {
          if (!auth.currentUser) {
            console.error('Usuário não autenticado');
            return;
          }
          // No MVP, enviamos o texto e metadados. 
          // O próximo passo será a Cloud Function que extrai o KG.
          await addDoc(collection(db, "sessions"), {
            text: transcript,
            timestamp: Date.now(),
            updatedAt: Date.now(),
            uid: auth.currentUser.uid
          });
        } catch (e) {
          console.error("Erro ao sincronizar Firestore:", e);
        }
      }
    } else {
      startListening();
    }
  };

  const handleManualSubmit = async () => {
    if (!manualText.trim()) return;

    if (!auth.currentUser) {
      console.error('Usuário não autenticado. Aguarde...');
      return;
    }

    try {
      await addDoc(collection(db, "sessions"), {
        text: manualText.trim(),
        timestamp: Date.now(),
        updatedAt: Date.now(),
        uid: auth.currentUser.uid
      });
      setManualText('');
      setIsWritingMode(false);
    } catch (e) {
      console.error("Erro ao sincronizar Firestore:", e);
    }
  };


  if (isLoading) return <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
    <motion.div
      animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 2, repeat: Infinity }}
      className="w-12 h-12 rounded-full bg-indigo-500/20"
    />
  </div>;

  return (
    <Routes>
      <Route path="/share/:shareId" element={<ShareView />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/checkout/success" element={<CheckoutSuccess />} />
      <Route path="/checkout/cancel" element={<CheckoutCancel />} />
      <Route path="/analytics" element={
        <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] p-8">
          <div className="max-w-7xl mx-auto">
            <AnalyticsDashboard />
          </div>
        </div>
      } />
      <Route path="/" element={
        <div className="min-h-screen bg-[#0a0a0a] text-[#ededed]">
          {/* Background decoration */}
          <div className="fixed inset-0 pointer-events-none">
            <div className="absolute top-[10%] left-[20%] w-[40vw] h-[40vw] bg-indigo-600/5 rounded-full blur-[120px]" />
            <div className="absolute bottom-[20%] right-[10%] w-[30vw] h-[30vw] bg-purple-600/5 rounded-full blur-[100px]" />
          </div>

          {!mnemonic ? (
            <KeyCeremony onComplete={handleKeyComplete} />
          ) : (
            <div className="relative z-10 p-8 max-w-7xl mx-auto">
              {/* Header */}
              <header className="flex flex-col gap-6 mb-12">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 glass-card flex items-center justify-center">
                      <Brain className="w-6 h-6 text-indigo-400" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tighter glow-text">MNEMOSYNE</h1>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => window.location.href = '/pricing'}
                      className="glass-button !p-2"
                      title="Upgrade de Plano"
                    >
                      <Crown className="w-5 h-5 text-indigo-400" />
                    </button>
                    <button
                      onClick={() => window.location.href = '/analytics'}
                      className="glass-button !p-2"
                      title="Analytics"
                    >
                      <BarChart3 className="w-5 h-5" />
                    </button>
                    <NotificationCenter />
                    <button
                      onClick={toggleTheme}
                      className="glass-button !p-2"
                      title={`Mudar para tema ${theme === 'dark' ? 'claro' : 'escuro'}`}
                    >
                      {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => setIsSettingsOpen(true)}
                      className="glass-button !p-2"
                      title="Configurações"
                    >
                      <Settings className="w-5 h-5" />
                    </button>
                    <LogoutButton />
                  </div>
                </div>

                {/* Search and Filters */}
                <div className="flex gap-4 items-center">
                  <SearchBar onSearch={setSearchQuery} />
                  <FilterPanel
                    onFilterChange={setFilters}
                    availableTags={availableTags}
                    availableCategories={availableCategories}
                  />
                </div>
              </header>

              {/* Main Content Area (Placeholder for Dashboard) */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                <aside className="lg:col-span-1 space-y-6">
                  <div className="glass-card p-6">
                    <h3 className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-4">Estatísticas</h3>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span>Total de Memórias</span>
                          <span className="text-indigo-400 font-bold">{sessions.length}</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500/50" style={{ width: `${Math.min(100, (sessions.length / 20) * 100)}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span>Palavras Escritas</span>
                          <span className="text-purple-400 font-bold">
                            {sessions.reduce((acc, s) => acc + (s.text?.split(' ').length || 0), 0)}
                          </span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-500/50"
                            style={{ width: `${Math.min(100, (sessions.reduce((acc, s) => acc + (s.text?.split(' ').length || 0), 0) / 500) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span>Esta Semana</span>
                          <span className="text-green-400 font-bold">
                            {sessions.filter(s => {
                              const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                              return s.timestamp > weekAgo;
                            }).length}
                          </span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500/50"
                            style={{
                              width: `${Math.min(100, (sessions.filter(s => {
                                const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
                                return s.timestamp > weekAgo;
                              }).length / 10) * 100)}%`
                            }}
                          />
                        </div>
                      </div>
                      {sessions.length > 0 && (
                        <div className="pt-3 border-t border-white/5">
                          <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Última Atividade</div>
                          <div className="text-xs text-indigo-300">
                            {new Date(Math.max(...sessions.map(s => s.timestamp))).toLocaleString('pt-PT', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Subscription Status */}
                  <SubscriptionStatus />

                  <nav className="space-y-4">
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-2">Navegação</h4>
                      <div className="space-y-2">
                        <button className="w-full glass-button flex items-center gap-3 text-indigo-300 bg-indigo-500/10 border-indigo-500/20">
                          <Star className="w-4 h-4" /> Constelação
                        </button>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-2">
                        Crónicas Recentes
                        {searchQuery || filters.dateRange !== 'all' || filters.tags.length > 0 || filters.category ? (
                          <span className="ml-2 text-indigo-400">({filteredSessions.length})</span>
                        ) : null}
                      </h4>
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {filteredSessions.length === 0 ? (
                          <p className="text-xs text-gray-600 px-2 italic">
                            {sessions.length === 0 ? 'Nenhuma memória ainda...' : 'Nenhum resultado encontrado'}
                          </p>
                        ) : (
                          filteredSessions.map(s => (
                            <div
                              key={s.id}
                              onClick={() => setEditingSession(s)}
                              className="glass-card p-3 text-xs border-white/5 hover:border-white/10 hover:bg-white/5 transition-all cursor-pointer group animate-in fade-in slide-in-from-left-2"
                            >
                              <div className="flex justify-between items-start mb-1">
                                <span className="text-indigo-300 truncate max-w-[120px] font-medium group-hover:text-indigo-200">{s.text.substring(0, 20)}...</span>
                                <span className="text-[10px] text-gray-500">{new Date(s.timestamp).toLocaleDateString()}</span>
                              </div>
                              <p className="text-gray-500 group-hover:text-gray-400 truncate text-[11px] leading-tight">{s.text}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </nav>
                </aside>

                <main className="lg:col-span-3">
                  <div className="glass-card h-[600px] flex flex-col relative overflow-hidden">
                    {isWritingMode ? (
                      <div className="flex-1 flex flex-col p-6">
                        <div className="flex justify-between items-center mb-4">
                          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Nova Memória</h3>
                          <button
                            onClick={() => setIsWritingMode(false)}
                            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-2 transition-colors"
                          >
                            <Eye className="w-4 h-4" /> Ver Grafo
                          </button>
                        </div>
                        <textarea
                          value={manualText}
                          onChange={(e) => setManualText(e.target.value)}
                          placeholder="Comece a escrever a sua memória aqui..."
                          className="flex-1 bg-transparent text-indigo-100 placeholder-gray-700 border-none focus:ring-0 resize-none text-lg leading-relaxed font-light"
                          autoFocus
                        />
                        <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-white/5">
                          <button
                            onClick={() => {
                              setManualText('');
                              setIsWritingMode(false);
                            }}
                            className="px-6 py-2 text-gray-400 hover:text-white transition-colors text-sm font-bold uppercase tracking-tighter"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleManualSubmit}
                            disabled={!manualText.trim()}
                            className="flex items-center gap-2 px-8 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-bold uppercase tracking-tighter shadow-lg shadow-indigo-500/20"
                          >
                            <Send className="w-4 h-4" /> Guardar Memória
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <MemoryGraph data={graphData} />

                        {/* Recording UI */}
                        <div className="absolute bottom-10 right-10 flex flex-col items-end gap-4">
                          <AnimatePresence>
                            {isListening && (
                              <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="bg-red-500/20 border border-red-500/40 px-4 py-2 rounded-full flex items-center gap-3"
                              >
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                <span className="text-xs font-bold text-red-400 uppercase tracking-tighter">
                                  {transcript ? "Processando..." : "Escutando..."}
                                </span>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {isListening && transcript && (
                            <motion.div
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="glass-card p-3 max-w-xs text-[10px] text-indigo-200 border-indigo-500/30"
                            >
                              <p className="italic">"{transcript}..."</p>
                            </motion.div>
                          )}

                          {!isListening && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="flex items-center gap-2"
                            >
                              <button
                                onClick={() => setIsWritingMode(true)}
                                className="p-4 glass-card hover:bg-white/10 text-indigo-400 rounded-full transition-all shadow-xl hover:scale-110"
                                title="Escrever memória"
                              >
                                <Edit3 className="w-6 h-6" />
                              </button>
                            </motion.div>
                          )}

                          <button
                            onClick={handleRecordingToggle}
                            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all hover:scale-110 shadow-2xl shrink-0 ${isListening
                              ? 'bg-red-600/40 border-red-500 shadow-red-500/30'
                              : 'bg-indigo-600/40 border-indigo-400/30 shadow-indigo-500/20'
                              } border`}
                          >
                            {isListening ? <StopCircle className="w-10 h-10 text-white" /> : <Mic className="w-10 h-10 text-white" />}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </main>
              </div>

              <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                mnemonic={mnemonic}
                onResetKey={() => {
                  localStorage.removeItem('mnemosyne_mnemonic');
                  setMnemonic(null);
                }}
              />

              <MemoryEditorModal
                session={editingSession}
                onClose={() => setEditingSession(null)}
              />

              <AuthModal
                isOpen={showAuthModal}
                onClose={() => setShowAuthModal(false)}
              />
            </div>
          )}
        </div>
      } />
    </Routes>
  );
};

export default App;
