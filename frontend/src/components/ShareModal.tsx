import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Link as LinkIcon, Download, Copy, Check, Clock, Shield, Radio, AlertTriangle, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { db, auth } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { downloadMemory } from '../utils/export';
import { encryptSharePayload } from '../utils/encryptedShare';
import { FAIR_USE } from '../config/fairUse';
import { buildCapsuleDeepLink } from '../utils/deepLinks';
import { encodeCapsulePack } from '../services/capsuleService';
import type { SessionData } from '../hooks/useSessions';

interface ShareModalProps {
    session: SessionData | null;
    /** Memórias ligadas / extras para pack multi-memória */
    relatedSessions?: SessionData[];
    onClose: () => void;
    onOpenComms?: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
    session,
    relatedSessions = [],
    onClose,
    onOpenComms,
}) => {
    const [shareLink, setShareLink] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [copied, setCopied] = useState(false);
    const [expirationDays, setExpirationDays] = useState<number>(FAIR_USE.shareLinkDefaultDays);
    const [passphrase, setPassphrase] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [embedPassInLink, setEmbedPassInLink] = useState(false);
    const [savedPassphrase, setSavedPassphrase] = useState('');
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [includeLinked, setIncludeLinked] = useState(false);
    const [packCount, setPackCount] = useState(1);

    useEffect(() => {
        if (!shareLink) {
            setQrDataUrl(null);
            return;
        }
        let cancelled = false;
        QRCode.toDataURL(shareLink, {
            width: 220,
            margin: 2,
            color: { dark: '#e2e8f0', light: '#0b1120' },
            errorCorrectionLevel: 'M',
        })
            .then((url) => {
                if (!cancelled) setQrDataUrl(url);
            })
            .catch(() => {
                if (!cancelled) setQrDataUrl(null);
            });
        return () => {
            cancelled = true;
        };
    }, [shareLink]);

    const downloadQr = () => {
        if (!qrDataUrl) return;
        const a = document.createElement('a');
        a.href = qrDataUrl;
        a.download = `mnemosyne-capsula-qr.png`;
        a.click();
    };

    const generateEncryptedCapsule = async () => {
        if (!session) return;
        const user = auth.currentUser;
        if (!user) {
            setError('Precisas de estar autenticado para criar uma cápsula.');
            return;
        }
        if (passphrase.trim().length < 8) {
            setError('Passphrase com pelo menos 8 caracteres. Partilha-a fora do link (voz, Signal, etc.).');
            return;
        }

        setIsGenerating(true);
        setError(null);

        try {
            const days = Math.min(Math.max(expirationDays, 1), FAIR_USE.shareLinkMaxDays);
            const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
            const pass = passphrase.trim();

            const linked = includeLinked
                ? relatedSessions
                    .filter((s) => s.id !== session.id && s.text?.trim())
                    .slice(0, 12)
                : [];

            const items = [
                {
                    title: session.title,
                    text: session.text,
                    tags: session.tags,
                },
                ...linked.map((s) => ({
                    title: s.title,
                    text: s.text,
                    tags: s.tags,
                })),
            ];

            const plainPayload = items.length > 1
                ? encodeCapsulePack(items)
                : session.text;

            const ciphertext = await encryptSharePayload(plainPayload, pass);
            const itemCount = items.length;
            setPackCount(itemCount);

            const shareDoc = await addDoc(collection(db, 'shares'), {
                sessionId: session.id,
                encrypted: true,
                ciphertext,
                titleHint: (session.title || 'Memória').slice(0, 48),
                pack: itemCount > 1,
                itemCount,
                createdAt: Date.now(),
                expiresAt,
                views: 0,
                importCount: 0,
                uid: user.uid,
            });

            setSavedPassphrase(pass);
            const link = buildCapsuleDeepLink(shareDoc.id, embedPassInLink ? pass : undefined);
            setShareLink(link);
        } catch (e) {
            console.error('Erro ao gerar cápsula cifrada:', e);
            setError(e instanceof Error ? e.message : 'Erro ao gerar cápsula cifrada.');
        } finally {
            setIsGenerating(false);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error('Erro ao copiar:', e);
        }
    };

    return (
        <AnimatePresence>
            {session && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/80 backdrop-blur-md"
                    />

                    <motion.div
                        initial={{ scale: 0.94, opacity: 0, y: 16 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.96, opacity: 0, y: 10 }}
                        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#07101f]/95 shadow-2xl"
                    >
                        <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.03] p-5">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20">
                                    <Shield className="h-5 w-5 text-violet-300" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-white">Partilhar memória</h2>
                                    <p className="text-[10px] uppercase tracking-widest text-slate-500">
                                        Zero-Knowledge first
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-full p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="space-y-4 p-5">
                            <div className="flex gap-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100/90">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                                <p>
                                    Links públicos com texto em claro foram desativados. Usa cápsula cifrada
                                    (passphrase fora do link) ou <strong>Comms E2E</strong> para outro utilizador.
                                </p>
                            </div>

                            {/* Comms */}
                            {onOpenComms && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        onOpenComms();
                                    }}
                                    className="flex w-full items-center gap-3 rounded-xl border border-indigo-400/25 bg-indigo-500/10 p-4 text-left transition hover:bg-indigo-500/15"
                                >
                                    <Radio className="h-5 w-5 text-indigo-300" />
                                    <div>
                                        <h3 className="text-sm font-semibold text-indigo-100">Enviar por Comms (E2E)</h3>
                                        <p className="text-[11px] text-slate-400">
                                            Destinatário Mnemosyne · envelope AES + RSA
                                        </p>
                                    </div>
                                </button>
                            )}

                            {/* Encrypted capsule */}
                            <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex items-center gap-3">
                                    <LinkIcon className="h-5 w-5 text-violet-300" />
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-violet-100">Cápsula cifrada (link)</h3>
                                        <p className="text-[11px] text-slate-500">
                                            O servidor só guarda ciphertext. A passphrase não vai no URL.
                                        </p>
                                    </div>
                                </div>

                                {!shareLink ? (
                                    <>
                                        <label className="block space-y-1.5">
                                            <span className="text-[11px] uppercase tracking-wider text-slate-500">
                                                Passphrase (mín. 8)
                                            </span>
                                            <input
                                                type="password"
                                                value={passphrase}
                                                onChange={(e) => setPassphrase(e.target.value)}
                                                placeholder="Partilha esta chave por outro canal"
                                                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/50"
                                                autoComplete="new-password"
                                            />
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <Clock className="h-4 w-4 text-slate-500" />
                                            <span className="text-xs text-slate-400">Expira em:</span>
                                            <select
                                                value={expirationDays}
                                                onChange={(e) => setExpirationDays(Number(e.target.value))}
                                                className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-violet-200"
                                            >
                                                <option value={1}>1 dia</option>
                                                <option value={7}>7 dias</option>
                                                <option value={30}>30 dias</option>
                                            </select>
                                        </div>
                                        {relatedSessions.filter((s) => s.id !== session.id && s.text?.trim()).length > 0 && (
                                            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-cyan-400/15 bg-cyan-500/[0.06] p-2.5">
                                                <input
                                                    type="checkbox"
                                                    checked={includeLinked}
                                                    onChange={(e) => setIncludeLinked(e.target.checked)}
                                                    className="mt-0.5"
                                                />
                                                <span className="text-[11px] leading-relaxed text-slate-300">
                                                    Pack multi-memória: incluir até{' '}
                                                    {Math.min(
                                                        12,
                                                        relatedSessions.filter((s) => s.id !== session.id && s.text?.trim()).length,
                                                    )}{' '}
                                                    memória(s) ligada(s) nesta cápsula.
                                                </span>
                                            </label>
                                        )}
                                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/5 bg-black/20 p-2.5">
                                            <input
                                                type="checkbox"
                                                checked={embedPassInLink}
                                                onChange={(e) => setEmbedPassInLink(e.target.checked)}
                                                className="mt-0.5"
                                            />
                                            <span className="text-[11px] leading-relaxed text-slate-400">
                                                Incluir passphrase no fragmento do link (#k=…).
                                                Não vai ao servidor, mas pode ficar no histórico do browser — menos seguro.
                                            </span>
                                        </label>
                                        {error && (
                                            <p className="text-xs text-rose-300">{error}</p>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => void generateEncryptedCapsule()}
                                            disabled={isGenerating}
                                            className="mnem-btn-primary w-full justify-center disabled:opacity-50"
                                            style={{ borderRadius: '0.75rem' }}
                                        >
                                            {isGenerating ? 'A cifrar…' : 'Gerar cápsula cifrada'}
                                        </button>
                                    </>
                                ) : (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 p-2">
                                            <input
                                                type="text"
                                                value={shareLink}
                                                readOnly
                                                className="min-w-0 flex-1 border-none bg-transparent text-xs text-violet-200 outline-none"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => void copyToClipboard(shareLink)}
                                                className="rounded p-2 hover:bg-white/10"
                                            >
                                                {copied ? (
                                                    <Check className="h-4 w-4 text-emerald-400" />
                                                ) : (
                                                    <Copy className="h-4 w-4 text-slate-400" />
                                                )}
                                            </button>
                                        </div>
                                        <p className="text-[11px] leading-relaxed text-slate-500">
                                            {packCount > 1
                                                ? `Pack com ${packCount} memórias cifradas num só link.`
                                                : embedPassInLink
                                                ? 'Link com chave no fragmento. Qualquer pessoa com o URL completo pode ler.'
                                                : 'Envia o link e a passphrase em canais separados.'}
                                        </p>
                                        {!embedPassInLink && savedPassphrase && (
                                            <button
                                                type="button"
                                                onClick={() => void copyToClipboard(savedPassphrase)}
                                                className="text-[11px] font-medium text-violet-300 underline-offset-2 hover:underline"
                                            >
                                                Copiar passphrase
                                            </button>
                                        )}

                                        {qrDataUrl && (
                                            <div className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-4">
                                                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                                                    <QrCode className="h-3.5 w-3.5" />
                                                    QR da cápsula
                                                </div>
                                                <img
                                                    src={qrDataUrl}
                                                    alt="QR code da cápsula cifrada"
                                                    className="h-[180px] w-[180px] rounded-xl border border-white/10"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={downloadQr}
                                                    className="text-[11px] font-medium text-cyan-300 underline-offset-2 hover:underline"
                                                >
                                                    Descarregar QR (PNG)
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Copy local */}
                            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="flex items-center gap-3">
                                    <Copy className="h-5 w-5 text-purple-300" />
                                    <div>
                                        <h3 className="text-sm font-semibold text-purple-100">Copiar texto local</h3>
                                        <p className="text-[11px] text-slate-500">Só no teu dispositivo</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => void copyToClipboard(session.text)}
                                    className="rounded-lg bg-purple-600/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-purple-200 hover:bg-purple-600/30"
                                >
                                    {copied ? 'Copiado' : 'Copiar'}
                                </button>
                            </div>

                            {/* Export */}
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                                <div className="mb-3 flex items-center gap-3">
                                    <Download className="h-5 w-5 text-emerald-300" />
                                    <div>
                                        <h3 className="text-sm font-semibold text-emerald-100">Exportar ficheiro</h3>
                                        <p className="text-[11px] text-slate-500">Download local</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['txt', 'md', 'json'] as const).map((fmt) => (
                                        <button
                                            key={fmt}
                                            type="button"
                                            onClick={() => downloadMemory(session, fmt)}
                                            className="rounded-lg bg-emerald-600/15 py-2 text-xs font-bold uppercase tracking-wide text-emerald-200 hover:bg-emerald-600/25"
                                        >
                                            {fmt}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
