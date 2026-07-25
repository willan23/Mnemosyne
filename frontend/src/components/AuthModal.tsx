import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Lock, User, AlertCircle, Key } from 'lucide-react';
import { auth } from '../firebase';
import { deriveAesKeyFromMnemonic, generateMnemonic, validateBip39Mnemonic } from '../utils/crypto';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signInWithPopup,
    GoogleAuthProvider
} from 'firebase/auth';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialMode?: 'login' | 'register' | 'reset' | 'mnemonic';
    onMnemonicComplete?: (mnemonic: string[]) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, initialMode = 'login', onMnemonicComplete }) => {
    const [mode, setMode] = useState<'login' | 'register' | 'reset' | 'mnemonic'>(initialMode);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [mnemonic, setMnemonic] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setMode(initialMode);
        setError(null);
        setSuccess(null);
    }, [initialMode, isOpen]);

    const handleGoogleLogin = async () => {
        setLoading(true);
        setError(null);
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            onClose();
        } catch {
            setError('Erro ao entrar com Google');
        } finally {
            setLoading(false);
        }
    };

    const handleMnemonicLogin = async () => {
        setError(null);
        const words = mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!(await validateBip39Mnemonic(words))) {
            setError('A chave deve conter exatamente 12 palavras BIP39 válidas.');
            return;
        }
        await deriveAesKeyFromMnemonic(words, `mnemosyne:${auth.currentUser?.uid ?? 'local'}`);
        if (!onMnemonicComplete) {
            setError('Sessão autenticada necessária para desbloquear a mente.');
            return;
        }
        onMnemonicComplete(words);
        onClose();
    };

    const generateNewMnemonic = async () => {
        setMnemonic((await generateMnemonic()).join(' '));
        setError(null);
    };

    const handleLogin = async () => {
        setError(null);
        setLoading(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
            onClose();
        } catch (error) {
            const err = error as { code?: string };
            setError(err.code === 'auth/invalid-credential' ? 'Email ou senha incorretos' : 'Erro ao fazer login');
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async () => {
        setError(null);
        if (password !== confirmPassword) {
            setError('As senhas não coincidem');
            return;
        }
        if (password.length < 6) {
            setError('A senha deve ter pelo menos 6 caracteres');
            return;
        }
        setLoading(true);
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            onClose();
        } catch (error) {
            const err = error as { code?: string };
            setError(err.code === 'auth/email-already-in-use' ? 'Email já está em uso' : 'Erro ao criar conta');
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async () => {
        setError(null);
        setSuccess(null);
        if (!email) {
            setError('Digite seu email');
            return;
        }
        setLoading(true);
        try {
            await sendPasswordResetEmail(auth, email);
            setSuccess('Email de recuperação enviado! Verifique sua caixa de entrada.');
        } catch {
            setError('Erro ao enviar email de recuperação');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
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
                        className="relative w-full max-w-md glass-card overflow-hidden"
                    >
                        <div className="p-6 border-b border-white/5 flex flex-col gap-4 bg-white/5">
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                        <User className="w-5 h-5 text-indigo-400" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold glow-text">
                                            {mode === 'login' ? 'Aceder' : mode === 'register' ? 'Iniciar' : mode === 'mnemonic' ? 'Recuperar Mente' : 'Recuperar Senha'}
                                        </h2>
                                        <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                                            Mnemosyne Cognitive OS
                                        </p>
                                    </div>
                                </div>
                                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                    <X className="w-5 h-5 text-gray-400" />
                                </button>
                            </div>
                            <div className="text-sm text-gray-300 font-medium">
                                "Tu não estás a criar uma conta. Estás a criar a tua mente digital."
                            </div>
                            <div className="text-xs text-gray-500">
                                As tuas memórias são encriptadas. Só tu tens acesso.
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            {error && (
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-red-400" />
                                    <p className="text-xs text-red-300">{error}</p>
                                </div>
                            )}

                            {success && (
                                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                                    <p className="text-xs text-green-300">{success}</p>
                                </div>
                            )}

                            {mode === 'mnemonic' ? (
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-gray-400 mb-1 block">Frase de 12 Palavras (Semente Cognitiva)</label>
                                        <div className="relative">
                                            <Key className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
                                            <textarea
                                                value={mnemonic}
                                                onChange={(e) => setMnemonic(e.target.value)}
                                                placeholder="insira as suas 12 palavras separadas por espaço..."
                                                className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[80px] resize-none"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={generateNewMnemonic}
                                        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors block text-right w-full"
                                    >
                                        Gerar nova chave
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs text-gray-400 mb-1 block">Email</label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                            <input
                                                type="email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                placeholder="seu@email.com"
                                                className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                            />
                                        </div>
                                    </div>

                                    {mode !== 'reset' && (
                                        <div>
                                            <label className="text-xs text-gray-400 mb-1 block">Senha</label>
                                            <div className="relative">
                                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                                <input
                                                    type="password"
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                    placeholder="••••••••"
                                                    className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {mode === 'register' && (
                                        <div>
                                            <label className="text-xs text-gray-400 mb-1 block">Confirmar Senha</label>
                                            <div className="relative">
                                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                                <input
                                                    type="password"
                                                    value={confirmPassword}
                                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                                    placeholder="••••••••"
                                                    className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <button
                                onClick={mode === 'mnemonic' ? handleMnemonicLogin : mode === 'login' ? handleLogin : mode === 'register' ? handleRegister : handleResetPassword}
                                disabled={loading}
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-bold uppercase tracking-tighter transition-all"
                            >
                                {loading ? 'Processando...' : mode === 'mnemonic' ? 'Desbloquear Mente' : mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar Mente Digital' : 'Enviar Email'}
                            </button>

                            {mode !== 'mnemonic' && mode !== 'reset' && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1 h-px bg-white/10" />
                                        <span className="text-xs text-gray-500">ou entrar com</span>
                                        <div className="flex-1 h-px bg-white/10" />
                                    </div>
                                    
                                    <button
                                        onClick={handleGoogleLogin}
                                        disabled={loading}
                                        className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all"
                                    >
                                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                        </svg>
                                        Google
                                    </button>
                                </>
                            )}

                            <div className="text-center space-y-2">
                                {mode === 'login' && (
                                    <>
                                        <button
                                            onClick={() => setMode('register')}
                                            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                                        >
                                            Não tens a tua Mente Digital? Iniciar
                                        </button>
                                        <br />
                                        <button
                                            onClick={() => setMode('mnemonic')}
                                            className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                                        >
                                            Aceder com Chave (12 Palavras)
                                        </button>
                                        <br />
                                        <button
                                            onClick={() => setMode('reset')}
                                            className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
                                        >
                                            Esqueceu a senha?
                                        </button>
                                    </>
                                )}
                                {mode === 'register' && (
                                    <button
                                        onClick={() => setMode('login')}
                                        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                                    >
                                        Já tens acesso? Entrar
                                    </button>
                                )}
                                {(mode === 'reset' || mode === 'mnemonic') && (
                                    <button
                                        onClick={() => setMode('login')}
                                        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                                    >
                                        Voltar
                                    </button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
