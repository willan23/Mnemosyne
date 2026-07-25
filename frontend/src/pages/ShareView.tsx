import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Brain, Clock, AlertCircle, Download, Lock, Shield, Inbox, Loader2, LogIn } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import {
    decryptSharePayload,
    isEncryptedShare,
    type EncryptedSharePayload,
} from '../utils/encryptedShare';
import { readPassphraseFromHash } from '../utils/deepLinks';
import { importCapsuleAsMemory } from '../services/learningService';
import toast from 'react-hot-toast';

export const ShareView: React.FC = () => {
    const { shareId } = useParams<{ shareId: string }>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [shareMeta, setShareMeta] = useState<Record<string, unknown> | null>(null);
    const [plainText, setPlainText] = useState<string | null>(null);
    const [passphrase, setPassphrase] = useState('');
    const [unlocking, setUnlocking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [unlockError, setUnlockError] = useState<string | null>(null);
    const [user, setUser] = useState<User | null>(() => auth.currentUser);
    const [importing, setImporting] = useState(false);
    const [importedId, setImportedId] = useState<string | null>(null);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, setUser);
        return () => unsub();
    }, []);

    useEffect(() => {
        const loadShare = async () => {
            if (!shareId) {
                setError('Link inválido');
                setLoading(false);
                return;
            }

            try {
                const shareDoc = await getDoc(doc(db, 'shares', shareId));

                if (!shareDoc.exists()) {
                    setError('Esta cápsula não existe ou foi removida.');
                    setLoading(false);
                    return;
                }

                const data = shareDoc.data() as Record<string, unknown>;

                if (data.expiresAt && typeof data.expiresAt === 'number' && data.expiresAt < Date.now()) {
                    setError('Este link expirou.');
                    setLoading(false);
                    return;
                }

                setShareMeta(data);

                if (typeof data.text === 'string' && !isEncryptedShare(data)) {
                    setPlainText(data.text);
                }

                const fromHash = readPassphraseFromHash(window.location.hash);
                if (fromHash) {
                    setPassphrase(fromHash);
                }

                updateDoc(doc(db, 'shares', shareId), {
                    views: increment(1),
                }).catch(() => undefined);
            } catch (e) {
                console.error('Erro ao carregar cápsula:', e);
                setError('Erro ao carregar a cápsula.');
            } finally {
                setLoading(false);
            }
        };

        void loadShare();
    }, [shareId]);

    useEffect(() => {
        if (!shareMeta || plainText) return;
        if (!isEncryptedShare(shareMeta)) return;
        const fromHash = readPassphraseFromHash(window.location.hash);
        if (!fromHash) return;
        let cancelled = false;
        (async () => {
            try {
                const ciphertext = shareMeta.ciphertext as EncryptedSharePayload;
                const text = await decryptSharePayload(ciphertext, fromHash);
                if (!cancelled) setPlainText(text);
            } catch {
                // keep UI for manual unlock
            }
        })();
        return () => { cancelled = true; };
    }, [shareMeta, plainText]);

    const unlock = async () => {
        if (!shareMeta || !isEncryptedShare(shareMeta)) return;
        setUnlocking(true);
        setUnlockError(null);
        try {
            const ciphertext = shareMeta.ciphertext as EncryptedSharePayload;
            const text = await decryptSharePayload(ciphertext, passphrase);
            setPlainText(text);
        } catch {
            setUnlockError('Passphrase incorreta ou cápsula corrompida.');
        } finally {
            setUnlocking(false);
        }
    };

    const downloadAsFile = () => {
        if (!plainText) return;
        const blob = new Blob([plainText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'memoria-capsula.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const importToUniverse = async () => {
        if (!plainText || !user) {
            navigate(`/?next=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
            return;
        }
        setImporting(true);
        try {
            const ownerUid = typeof shareMeta?.uid === 'string' ? shareMeta.uid : null;
            const result = await importCapsuleAsMemory(
                user.uid,
                {
                    text: plainText,
                    titleHint: typeof shareMeta?.titleHint === 'string' ? shareMeta.titleHint : null,
                    shareId: shareId || null,
                    ownerUid,
                },
                [],
            );
            setImportedId(result.id);
            toast.success(
                result.importedCount > 1
                    ? `${result.importedCount} memórias assimiladas no teu universo.`
                    : 'Cápsula importada para o teu universo.',
            );
        } catch (e) {
            console.error(e);
            toast.error(e instanceof Error ? e.message : 'Não foi possível importar a cápsula.');
        } finally {
            setImporting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#020617]">
                <motion.div
                    animate={{ scale: [1, 1.15, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="h-12 w-12 rounded-full bg-violet-500/20"
                />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#020617] p-4 text-slate-100">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mnem-glass-heavy max-w-md p-8 text-center"
                >
                    <AlertCircle className="mx-auto mb-4 h-14 w-14 text-rose-400" />
                    <h1 className="mb-2 text-2xl font-bold">{error}</h1>
                    <p className="mb-6 text-sm text-slate-500">
                        O link pode ter expirado ou a cápsula foi removida.
                    </p>
                    <button type="button" onClick={() => navigate('/')} className="mnem-btn-primary">
                        Ir para Mnemosyne
                    </button>
                </motion.div>
            </div>
        );
    }

    const encrypted = shareMeta ? isEncryptedShare(shareMeta) : false;
    const legacyPlain = Boolean(shareMeta && typeof shareMeta.text === 'string' && !encrypted);

    return (
        <div className="min-h-screen bg-[#020617] text-slate-100">
            <div className="pointer-events-none fixed inset-0">
                <div className="absolute left-[20%] top-[10%] h-[40vw] w-[40vw] rounded-full bg-violet-600/5 blur-[120px]" />
                <div className="absolute bottom-[20%] right-[10%] h-[30vw] w-[30vw] rounded-full bg-cyan-600/5 blur-[100px]" />
            </div>

            <div className="relative z-10 mx-auto max-w-3xl p-6 md:p-10">
                <motion.header
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-10 flex items-center justify-between"
                >
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10">
                            <Brain className="h-5 w-5 text-violet-300" />
                        </div>
                        <h1 className="text-xl font-semibold tracking-tight">Mnemosyne</h1>
                    </div>
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="mnem-btn-ghost text-sm"
                        style={{ padding: '0.5rem 1rem' }}
                    >
                        {user ? 'Abrir app' : 'Criar conta'}
                    </button>
                </motion.header>

                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mnem-glass-heavy p-6 md:p-8"
                >
                    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-violet-200">
                                <Shield className="h-3 w-3" />
                                {encrypted ? 'Cápsula cifrada' : legacyPlain ? 'Link legado' : 'Cápsula'}
                            </div>
                            <h2 className="text-xl font-semibold text-white">
                                {(shareMeta?.titleHint as string) || 'Memória partilhada'}
                            </h2>
                            {typeof shareMeta?.createdAt === 'number' && (
                                <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                                    <Clock className="h-3 w-3" />
                                    {new Date(shareMeta.createdAt as number).toLocaleDateString('pt-PT', {
                                        day: '2-digit',
                                        month: 'long',
                                        year: 'numeric',
                                    })}
                                </div>
                            )}
                        </div>
                        {plainText && (
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={downloadAsFile}
                                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600/20 px-4 py-2 text-xs font-bold uppercase tracking-wide text-emerald-200 hover:bg-emerald-600/30"
                                >
                                    <Download className="h-4 w-4" /> Baixar
                                </button>
                            </div>
                        )}
                    </div>

                    {legacyPlain && plainText && (
                        <div className="mb-4 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100/90">
                            Este link foi criado no formato antigo (texto em claro na cloud). Novas partilhas
                            usam apenas cápsulas cifradas ou Comms E2E.
                        </div>
                    )}

                    {encrypted && !plainText && (
                        <div className="space-y-4">
                            <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <Lock className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                                <p className="text-sm leading-relaxed text-slate-300">
                                    O conteúdo está cifrado. Introduz a passphrase que recebeste num canal
                                    separado (ou no fragmento #k= do link).
                                </p>
                            </div>
                            <input
                                type="password"
                                value={passphrase}
                                onChange={(e) => setPassphrase(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') void unlock();
                                }}
                                placeholder="Passphrase da cápsula"
                                className="mnem-input"
                                style={{ paddingLeft: '1rem' }}
                                autoComplete="off"
                            />
                            {unlockError && <p className="text-xs text-rose-300">{unlockError}</p>}
                            <button
                                type="button"
                                onClick={() => void unlock()}
                                disabled={unlocking || passphrase.length < 1}
                                className="mnem-btn-primary disabled:opacity-50"
                            >
                                {unlocking ? 'A desbloquear…' : 'Desbloquear memória'}
                            </button>
                        </div>
                    )}

                    {plainText && (
                        <>
                            <div className="prose prose-invert max-w-none">
                                <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-100 md:text-lg">
                                    {plainText}
                                </p>
                            </div>

                            <div className="mt-6 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.07] p-4">
                                <div className="flex items-start gap-3">
                                    <Inbox className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-cyan-50">
                                            Importar para o teu universo
                                        </p>
                                        <p className="mt-1 text-xs leading-relaxed text-slate-400">
                                            Cria memória(s) no teu universo com embeddings e autolink.
                                            Packs multi-memória expandem-se em várias estrelas. A cápsula original não muda.
                                            {typeof shareMeta?.itemCount === 'number' && shareMeta.itemCount > 1
                                                ? ` Este pack tem ${shareMeta.itemCount} itens.`
                                                : ''}
                                        </p>
                                        {importedId ? (
                                            <button
                                                type="button"
                                                onClick={() => navigate(`/?memory=${importedId}`)}
                                                className="mt-3 mnem-btn-primary text-sm"
                                                style={{ borderRadius: '0.75rem', padding: '0.55rem 1.1rem' }}
                                            >
                                                Ver no grafo
                                            </button>
                                        ) : user ? (
                                            <button
                                                type="button"
                                                onClick={() => void importToUniverse()}
                                                disabled={importing}
                                                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2.5 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/25 disabled:opacity-50"
                                            >
                                                {importing ? (
                                                    <>
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        A importar…
                                                    </>
                                                ) : (
                                                    <>
                                                        <Inbox className="h-4 w-4" />
                                                        Assimilar cápsula
                                                    </>
                                                )}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => navigate('/')}
                                                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                                            >
                                                <LogIn className="h-4 w-4" />
                                                Entrar para importar
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    <div className="mt-8 border-t border-white/5 pt-5 text-center text-[11px] text-slate-600">
                        Cápsula Mnemosyne · Founder Preview
                        {typeof shareMeta?.views === 'number' ? ` · ${shareMeta.views} aberturas` : ''}
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.25 }}
                    className="mt-8 text-center"
                >
                    <p className="mb-4 text-sm text-slate-500">
                        Cria o teu universo cognitivo privado — Founder Preview gratuito
                    </p>
                    <button type="button" onClick={() => navigate('/')} className="mnem-btn-primary">
                        Começar grátis
                    </button>
                </motion.div>
            </div>
        </div>
    );
};
