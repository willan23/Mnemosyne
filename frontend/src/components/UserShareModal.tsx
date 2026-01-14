import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Search, Check, Eye, Edit3, Trash2 } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';

interface SharedUser {
    uid: string;
    email: string;
    permission: 'view' | 'edit';
}

interface UserShareModalProps {
    session: any;
    onClose: () => void;
}

export const UserShareModal: React.FC<UserShareModalProps> = ({ session, onClose }) => {
    const [searchEmail, setSearchEmail] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [sharedUsers, setSharedUsers] = useState<SharedUser[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        // Load existing shared users
        if (session?.sharedWith) {
            setSharedUsers(session.sharedWith);
        }
    }, [session]);

    const handleSearch = async () => {
        if (!searchEmail.trim()) return;

        setIsSearching(true);
        try {
            // Search for users by email
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', searchEmail.trim().toLowerCase()));
            const snapshot = await getDocs(q);

            const results = snapshot.docs.map(doc => ({
                uid: doc.id,
                ...doc.data()
            }));

            // Filter out current user and already shared users
            const filtered = results.filter(user =>
                user.uid !== auth.currentUser?.uid &&
                !sharedUsers.some(su => su.uid === user.uid)
            );

            setSearchResults(filtered);
        } catch (error) {
            console.error('Search error:', error);
            alert('Erro ao buscar usuário');
        } finally {
            setIsSearching(false);
        }
    };

    const handleAddUser = (user: any, permission: 'view' | 'edit') => {
        const newUser: SharedUser = {
            uid: user.uid,
            email: user.email,
            permission
        };
        setSharedUsers([...sharedUsers, newUser]);
        setSearchResults(searchResults.filter(u => u.uid !== user.uid));
        setSearchEmail('');
    };

    const handleRemoveUser = (uid: string) => {
        setSharedUsers(sharedUsers.filter(u => u.uid !== uid));
    };

    const handleChangePermission = (uid: string, permission: 'view' | 'edit') => {
        setSharedUsers(sharedUsers.map(u =>
            u.uid === uid ? { ...u, permission } : u
        ));
    };

    const handleSave = async () => {
        if (!session) return;

        setIsSaving(true);
        try {
            await updateDoc(doc(db, 'sessions', session.id), {
                sharedWith: sharedUsers,
                updatedAt: Date.now()
            });
            onClose();
        } catch (error) {
            console.error('Save error:', error);
            alert('Erro ao salvar compartilhamento');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-black/80 backdrop-blur-md"
                />

                <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    className="relative w-full max-w-2xl glass-card overflow-hidden flex flex-col max-h-[80vh]"
                >
                    {/* Header */}
                    <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                <UserPlus className="w-5 h-5 text-indigo-400" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold glow-text">Compartilhar com Usuários</h2>
                                <p className="text-xs text-gray-500">Convide pessoas para ver ou editar esta memória</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                            <X className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
                        {/* Search */}
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                                Buscar Usuário por Email
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="email"
                                    value={searchEmail}
                                    onChange={(e) => setSearchEmail(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                                    placeholder="usuario@exemplo.com"
                                    className="flex-1 bg-white/5 text-indigo-100 placeholder-gray-700 border border-white/10 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                />
                                <button
                                    onClick={handleSearch}
                                    disabled={isSearching || !searchEmail.trim()}
                                    className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg font-bold transition-all"
                                >
                                    <Search className="w-4 h-4" />
                                    {isSearching ? 'Buscando...' : 'Buscar'}
                                </button>
                            </div>
                        </div>

                        {/* Search Results */}
                        {searchResults.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                    Resultados da Busca
                                </h3>
                                {searchResults.map(user => (
                                    <div key={user.uid} className="glass-card p-4 flex items-center justify-between">
                                        <div>
                                            <p className="font-medium">{user.email}</p>
                                            {user.displayName && (
                                                <p className="text-sm text-gray-400">{user.displayName}</p>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleAddUser(user, 'view')}
                                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold transition-all"
                                            >
                                                <Eye className="w-4 h-4" />
                                                Visualizar
                                            </button>
                                            <button
                                                onClick={() => handleAddUser(user, 'edit')}
                                                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-bold transition-all"
                                            >
                                                <Edit3 className="w-4 h-4" />
                                                Editar
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Shared Users List */}
                        {sharedUsers.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                    Compartilhado com ({sharedUsers.length})
                                </h3>
                                {sharedUsers.map(user => (
                                    <div key={user.uid} className="glass-card p-4 flex items-center justify-between">
                                        <div>
                                            <p className="font-medium">{user.email}</p>
                                            <p className="text-xs text-gray-400">
                                                Permissão: {user.permission === 'view' ? 'Visualizar' : 'Editar'}
                                            </p>
                                        </div>
                                        <div className="flex gap-2">
                                            <select
                                                value={user.permission}
                                                onChange={(e) => handleChangePermission(user.uid, e.target.value as 'view' | 'edit')}
                                                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1 text-sm focus:ring-2 focus:ring-indigo-500"
                                            >
                                                <option value="view">Visualizar</option>
                                                <option value="edit">Editar</option>
                                            </select>
                                            <button
                                                onClick={() => handleRemoveUser(user.uid)}
                                                className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {sharedUsers.length === 0 && searchResults.length === 0 && (
                            <div className="text-center py-12 text-gray-500">
                                <UserPlus className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                <p>Nenhum usuário compartilhado ainda</p>
                                <p className="text-sm">Busque por email para adicionar pessoas</p>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-4 bg-black/40 border-t border-white/5 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 rounded-lg text-gray-400 hover:text-white transition-colors font-bold uppercase tracking-tighter"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex items-center gap-2 px-8 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-all font-bold uppercase tracking-tighter shadow-lg shadow-indigo-500/20"
                        >
                            <Check className="w-4 h-4" />
                            {isSaving ? 'Salvando...' : 'Salvar'}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
