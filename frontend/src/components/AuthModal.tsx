import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, Lock, User, AlertCircle } from 'lucide-react';
import { auth } from '../firebase';
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signInAnonymously
} from 'firebase/auth';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleLogin = async () => {
        setError(null);
        setLoading(true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
            onClose();
        } catch (err: any) {
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
        } catch (err: any) {
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
        } catch (err: any) {
            setError('Erro ao enviar email de recuperação');
        } finally {
            setLoading(false);
        }
    };

    const handleAnonymous = async () => {
        setLoading(true);
        try {
            await signInAnonymously(auth);
            onClose();
        } catch (err) {
            setError('Erro ao entrar anonimamente');
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
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                    <User className="w-5 h-5 text-indigo-400" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold glow-text">
                                        {mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar Conta' : 'Recuperar Senha'}
                                    </h2>
                                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                                        Mnemosyne
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
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

                            <button
                                onClick={mode === 'login' ? handleLogin : mode === 'register' ? handleRegister : handleResetPassword}
                                disabled={loading}
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-bold uppercase tracking-tighter transition-all"
                            >
                                {loading ? 'Processando...' : mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar Conta' : 'Enviar Email'}
                            </button>

                            <div className="flex items-center gap-2">
                                <div className="flex-1 h-px bg-white/10" />
                                <span className="text-xs text-gray-500">ou</span>
                                <div className="flex-1 h-px bg-white/10" />
                            </div>

                            <button
                                onClick={handleAnonymous}
                                disabled={loading}
                                className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-bold uppercase tracking-tighter transition-all"
                            >
                                Continuar sem Conta
                            </button>

                            <div className="text-center space-y-2">
                                {mode === 'login' && (
                                    <>
                                        <button
                                            onClick={() => setMode('register')}
                                            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                                        >
                                            Não tem conta? Criar nova
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
                                        Já tem conta? Entrar
                                    </button>
                                )}
                                {mode === 'reset' && (
                                    <button
                                        onClick={() => setMode('login')}
                                        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                                    >
                                        Voltar para login
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
