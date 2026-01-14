import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Key, Info, Database } from 'lucide-react';
import { seedDatabase, removeTestData } from '../utils/seedData';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    mnemonic: string[] | null;
    onResetKey: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, mnemonic, onResetKey }) => {
    const [showMnemonic, setShowMnemonic] = React.useState(false);
    const [isSeeding, setIsSeeding] = React.useState(false);
    const [seedMessage, setSeedMessage] = React.useState<string | null>(null);

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />

                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 20 }}
                        className="relative w-full max-w-lg max-h-[90vh] glass-card overflow-hidden flex flex-col"
                    >
                        <div className="p-6 border-b border-white/5 flex justify-between items-center">
                            <h2 className="text-xl font-bold flex items-center gap-3">
                                <Key className="w-5 h-5 text-indigo-400" /> Definições
                            </h2>
                            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-8 overflow-y-auto flex-1">
                            {/* Key Section */}
                            <section className="space-y-4">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Segurança & Chaves</h3>
                                <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                                <Key className="w-4 h-4 text-indigo-400" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium">Chave Ancestral Ativa</p>
                                                <p className="text-[10px] text-gray-500 italic">E2EE habilitado (PBKDF2 + AES-GCM)</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <button
                                            onClick={() => setShowMnemonic(!showMnemonic)}
                                            className="w-full flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 transition-colors"
                                        >
                                            <div className="flex items-center gap-3 text-indigo-300">
                                                <Key className="w-4 h-4" />
                                                <span className="text-xs font-bold uppercase tracking-tighter">
                                                    {showMnemonic ? 'Ocultar Palavras-Chave' : 'Ver Palavras-Chave'}
                                                </span>
                                            </div>
                                        </button>

                                        {showMnemonic && mnemonic && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                className="grid grid-cols-3 gap-2 p-3 bg-black/40 rounded-lg border border-white/5"
                                            >
                                                {mnemonic.map((word, i) => (
                                                    <div key={i} className="text-[10px] text-gray-400 bg-white/5 p-1 rounded text-center">
                                                        <span className="text-gray-600 mr-1">{i + 1}.</span>{word}
                                                    </div>
                                                ))}
                                            </motion.div>
                                        )}

                                        <button
                                            onClick={() => {
                                                if (confirm('Tem certeza? Isso apagará sua chave local. Você precisará dos 12 nomes para recuperar seus dados.')) {
                                                    onResetKey();
                                                    onClose();
                                                }
                                            }}
                                            className="w-full flex items-center justify-between p-3 rounded-lg border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 transition-colors group"
                                        >
                                            <div className="flex items-center gap-3 text-red-400">
                                                <Trash2 className="w-4 h-4" />
                                                <span className="text-xs font-bold uppercase tracking-tighter">Resetar Chave Local</span>
                                            </div>
                                            <div className="text-[10px] text-red-500/50 opacity-0 group-hover:opacity-100 transition-opacity">
                                                Ação irreversível
                                            </div>
                                        </button>
                                    </div>
                                </div>
                            </section>

                            {/* Data Section */}
                            <section className="space-y-4">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Dados de Teste</h3>
                                <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                    <div className="flex items-start gap-3 mb-3">
                                        <Database className="w-4 h-4 text-green-300 mt-1 shrink-0" />
                                        <p className="text-xs text-gray-500 leading-relaxed">
                                            Carregue 10 memórias de exemplo para testar o grafo com dados diversos.
                                        </p>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            setIsSeeding(true);
                                            setSeedMessage(null);
                                            const result = await seedDatabase();
                                            setIsSeeding(false);
                                            if (result.success) {
                                                setSeedMessage(`✅ ${result.count} memórias adicionadas com sucesso!`);
                                                setTimeout(() => setSeedMessage(null), 3000);
                                            } else {
                                                setSeedMessage(`❌ Erro: ${result.error}`);
                                            }
                                        }}
                                        disabled={isSeeding}
                                        className="w-full flex items-center justify-center gap-3 p-3 rounded-lg border border-green-500/20 bg-green-500/5 hover:bg-green-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Database className="w-4 h-4 text-green-400" />
                                        <span className="text-xs font-bold uppercase tracking-tighter text-green-400">
                                            {isSeeding ? 'Carregando...' : 'Carregar Dados de Teste'}
                                        </span>
                                    </button>

                                    <button
                                        onClick={async () => {
                                            if (!confirm('Tem certeza que deseja remover TODAS as memórias de teste? Esta ação não pode ser desfeita.')) return;

                                            setIsSeeding(true);
                                            setSeedMessage(null);
                                            const result = await removeTestData();
                                            setIsSeeding(false);
                                            if (result.success) {
                                                if (result.count === 0) {
                                                    setSeedMessage('ℹ️ Nenhuma memória de teste encontrada');
                                                } else {
                                                    setSeedMessage(`✅ ${result.count} memórias de teste removidas!`);
                                                }
                                                setTimeout(() => setSeedMessage(null), 3000);
                                            } else {
                                                setSeedMessage(`❌ Erro: ${result.error}`);
                                            }
                                        }}
                                        disabled={isSeeding}
                                        className="w-full flex items-center justify-center gap-3 p-3 rounded-lg border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Trash2 className="w-4 h-4 text-red-400" />
                                        <span className="text-xs font-bold uppercase tracking-tighter text-red-400">
                                            {isSeeding ? 'Removendo...' : 'Remover Dados de Teste'}
                                        </span>
                                    </button>

                                    {seedMessage && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="mt-3 text-xs text-center text-gray-400"
                                        >
                                            {seedMessage}
                                        </motion.div>
                                    )}
                                </div>
                            </section>

                            {/* Migration Section */}
                            <section className="space-y-4">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Migração de Dados</h3>
                                <div className="p-4 bg-white/5 rounded-xl border border-white/5">
                                    <div className="flex items-start gap-3 mb-3">
                                        <Database className="w-4 h-4 text-yellow-300 mt-1 shrink-0" />
                                        <p className="text-xs text-gray-500 leading-relaxed">
                                            Se você tem memórias antigas que não consegue eliminar, clique aqui para atualizar a propriedade delas.
                                        </p>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            if (!confirm('Isso atualizará todas as memórias antigas para serem de sua propriedade. Continuar?')) return;

                                            setIsSeeding(true);
                                            setSeedMessage(null);

                                            try {
                                                const { auth, db } = await import('../firebase');
                                                const { collection, getDocs, doc, updateDoc, query, where } = await import('firebase/firestore');

                                                if (!auth.currentUser) {
                                                    setSeedMessage('❌ Erro: Você precisa estar autenticado');
                                                    setIsSeeding(false);
                                                    return;
                                                }

                                                const sessionsRef = collection(db, 'sessions');
                                                // Only get sessions that belong to current user and need migration
                                                // Note: Firestore queries cannot directly combine 'OR' conditions on different fields or values.
                                                // To handle 'anon' sessions, we'll fetch current user's sessions and then check for 'anon' within the loop.
                                                // A more robust solution for 'anon' sessions would involve a separate query or a server-side function.
                                                const q = query(
                                                    sessionsRef,
                                                    where('uid', '==', auth.currentUser.uid)
                                                );
                                                const snapshot = await getDocs(q);

                                                let updated = 0;
                                                for (const docSnap of snapshot.docs) {
                                                    const data = docSnap.data();
                                                    // Only migrate if uid is 'anon' or missing migratedAt field
                                                    // The query already filters for uid == auth.currentUser.uid,
                                                    // so data.uid === 'anon' will not be true here unless the query was different.
                                                    // This condition will primarily catch documents owned by the current user that lack migratedAt.
                                                    if (data.uid === 'anon' || !data.migratedAt) {
                                                        try {
                                                            await updateDoc(doc(db, 'sessions', docSnap.id), {
                                                                uid: auth.currentUser.uid,
                                                                migratedAt: Date.now()
                                                            });
                                                            updated++;
                                                        } catch (e) {
                                                            console.error('Error updating:', e);
                                                        }
                                                    }
                                                }

                                                setSeedMessage(`✅ ${updated} memórias atualizadas com sucesso!`);
                                                setTimeout(() => setSeedMessage(null), 3000);
                                            } catch (error: any) {
                                                setSeedMessage(`❌ Erro: ${error.message}`);
                                            } finally {
                                                setIsSeeding(false);
                                            }
                                        }}
                                        disabled={isSeeding}
                                        className="w-full flex items-center justify-center gap-3 p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 hover:bg-yellow-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Database className="w-4 h-4 text-yellow-400" />
                                        <span className="text-xs font-bold uppercase tracking-tighter text-yellow-400">
                                            {isSeeding ? 'Migrando...' : 'Migrar Memórias Antigas'}
                                        </span>
                                    </button>
                                    {seedMessage && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="mt-3 text-xs text-center text-gray-400"
                                        >
                                            {seedMessage}
                                        </motion.div>
                                    )}
                                </div>
                            </section>

                            <section className="space-y-4">
                                <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest">Zona de Perigo</h3>
                                <div className="p-4 bg-red-500/5 rounded-xl border border-red-500/20">
                                    <div className="flex items-start gap-3 mb-3">
                                        <Trash2 className="w-4 h-4 text-red-300 mt-1 shrink-0" />
                                        <p className="text-xs text-gray-500 leading-relaxed">
                                            Eliminar sua conta permanentemente. Esta ação não pode ser desfeita.
                                        </p>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            const confirmText = prompt('Digite "ELIMINAR" para confirmar a eliminação permanente da conta:');
                                            if (confirmText !== 'ELIMINAR') return;

                                            if (!confirm('ÚLTIMA CONFIRMAÇÃO: Todos os seus dados serão eliminados permanentemente. Continuar?')) return;

                                            try {
                                                const { getFunctions, httpsCallable } = await import('firebase/functions');
                                                const { default: app } = await import('../firebase');
                                                const functions = getFunctions(app, 'europe-west1');
                                                const deleteUserAccount = httpsCallable(functions, 'deleteUserAccount');

                                                // Delete account from backend
                                                await deleteUserAccount();

                                                // Clear all local data
                                                localStorage.clear();
                                                sessionStorage.clear();

                                                // Sign out from Firebase
                                                const { signOut } = await import('firebase/auth');
                                                const { auth } = await import('../firebase');
                                                await signOut(auth);

                                                // Show success message BEFORE redirect
                                                alert('✅ Conta eliminada com sucesso! Você será redirecionado.');

                                                // Redirect to home to show Key Ceremony (only once!)
                                                window.location.href = '/';
                                            } catch (error: any) {
                                                alert(`❌ Erro ao eliminar conta: ${error.message}`);
                                            }
                                        }}
                                        className="w-full flex items-center justify-center gap-3 p-3 rounded-lg border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4 text-red-400" />
                                        <span className="text-xs font-bold uppercase tracking-tighter text-red-400">
                                            Eliminar Conta Permanentemente
                                        </span>
                                    </button>
                                </div>
                            </section>

                            {/* About Section */}
                            <section className="space-y-4">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Sobre o MNEMOSYNE</h3>
                                <div className="p-4 bg-white/5 rounded-xl border border-white/5 space-y-3">
                                    <div className="flex items-start gap-3">
                                        <Info className="w-4 h-4 text-indigo-300 mt-1 shrink-0" />
                                        <p className="text-xs text-gray-500 leading-relaxed">
                                            A Mnemosyne utiliza criptografia de ponta a ponta (Zero-Knowledge).
                                            Seus dados são encriptados no seu navegador antes de serem enviados.
                                            Nós nunca temos acesso à sua chave.
                                        </p>
                                    </div>
                                    <div className="pt-2 border-t border-white/5 flex justify-between items-center text-[10px] text-gray-600">
                                        <span>Versão MVP v0.1.0</span>
                                        <span>Build 21.12.25</span>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
