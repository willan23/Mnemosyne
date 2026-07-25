import React, { useState, useEffect, useRef } from 'react';
import { deriveAesKeyFromMnemonic } from '../utils/crypto';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Brain, Key, Eye, EyeOff, Shield, AlertTriangle, Cpu, RotateCcw, Smartphone, QrCode, Copy, UploadCloud } from 'lucide-react';
import { PlansModal } from './PlanosModal';
import { SyncConflictPanel } from './SyncConflictPanel';
import {
    cancelMobilePairingInvite,
    createMobilePairingInvite,
    revokeTrustedDevice,
    trustAcceptedMobilePairing,
    watchMobilePairingInvite,
    watchTrustedDevices,
    type MobilePairingRecord,
    type MobilePairingInvite,
    type TrustedDevice,
} from '../services/mobilePairing';
import {
    cleanupMobileSyncArtifacts,
    importQueuedDesktopSyncEnvelopes,
    queueDesktopMemoryDelta,
    queueMobileMemorySnapshot,
} from '../services/mobileSync';
import { getOrCreateDesktopSyncIdentity } from '../services/desktopSyncIdentity';
import type { SessionData } from '../hooks/useSessions';
import {
    AI_PROVIDERS,
    clearProviderSecret,
    getLocalAiConfig,
    hasProviderSecret,
    saveLocalAiConfig,
    saveProviderSecret,
    type AiProviderId,
    type AiProviderConfig,
    type LocalAiConfig,
} from '../services/localAiConfig';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    mnemonic: string[] | null;
    onResetKey: () => void;
    sessions?: SessionData[];
}

const universeTypes = [
    { id: 'galaxia', name: 'Galáxia', color: 'from-purple-500 to-blue-500' },
    { id: 'sistema-solar', name: 'Sistema Solar', color: 'from-orange-400 to-yellow-500' },
    { id: 'nebulosa', name: 'Nebulosa', color: 'from-pink-500 to-rose-400' },
    { id: 'buraco-negro', name: 'Buraco Negro', color: 'from-gray-700 to-black' }
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, mnemonic, onResetKey, sessions = [] }) => {
    const [showMnemonic, setShowMnemonic] = useState(false);
    const [universeType, setUniverseType] = useState('galaxia');
    const [shareEnabled, setShareEnabled] = useState(false);
    const [planosOpen, setPlanosOpen] = useState(false);
    const [aesKeyReady, setAesKeyReady] = useState(false);
    const [localAiConfig, setLocalAiConfig] = useState<LocalAiConfig>(() => getLocalAiConfig());
    const [secretInput, setSecretInput] = useState('');
    const [isSavingSecret, setIsSavingSecret] = useState(false);
    const [pairingInvite, setPairingInvite] = useState<Omit<MobilePairingInvite, 'privateKey'> | null>(null);
    const [pairingRecord, setPairingRecord] = useState<MobilePairingRecord | null>(null);
    const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
    const [isCreatingPairing, setIsCreatingPairing] = useState(false);
    const [pairingError, setPairingError] = useState<string | null>(null);
    const [syncingDeviceId, setSyncingDeviceId] = useState<string | null>(null);
    const [mobileSyncMessage, setMobileSyncMessage] = useState<string | null>(null);
    const pairingPrivateKeyRef = useRef<CryptoKey | null>(null);
    const trustedPairingIdRef = useRef<string | null>(null);
    const selectedProvider = localAiConfig.primaryProvider;
    const activeProvider = AI_PROVIDERS.find((provider) => provider.id === selectedProvider) || AI_PROVIDERS[0];
    const activeProviderConfig = localAiConfig.providers[selectedProvider];
    const providerGroups = [
        { title: 'Local e backend controlado', providers: AI_PROVIDERS.filter((provider) => provider.kind !== 'cloud') },
        { title: 'Cloud com consentimento', providers: AI_PROVIDERS.filter((provider) => provider.kind === 'cloud') },
    ];

    // Deriva a chave AES-GCM a partir da mnemônica, apenas em memória
    useEffect(() => {
        let cancelled = false;
        async function deriveKey() {
            if (mnemonic && mnemonic.length === 12) {
                setAesKeyReady(false);
                try {
                    const key = await deriveAesKeyFromMnemonic(mnemonic, `mnemosyne:${auth.currentUser?.uid ?? 'local'}`);
                    if (!cancelled) {
                        void key;
                        setAesKeyReady(true);
                    }
                } catch {
                    if (!cancelled) {
                        setAesKeyReady(false);
                    }
                }
            } else {
                setAesKeyReady(false);
            }
        }
        deriveKey();
        return () => { cancelled = true; };
    }, [mnemonic]);

    useEffect(() => {
        const user = auth.currentUser;
        if (!isOpen || !user) return;
        setLocalAiConfig((current) => {
            const providers = { ...current.providers };
            for (const provider of AI_PROVIDERS) {
                providers[provider.id] = {
                    ...providers[provider.id],
                    hasSecret: provider.needsSecret ? hasProviderSecret(user.uid, provider.id) : false,
                };
            }
            return { ...current, providers };
        });
    }, [isOpen]);

    useEffect(() => {
        const user = auth.currentUser;
        if (!isOpen || !user) {
            setTrustedDevices([]);
            return;
        }

        return watchTrustedDevices(user.uid, setTrustedDevices);
    }, [isOpen]);

    useEffect(() => {
        const user = auth.currentUser;
        if (!pairingInvite || !user) {
            setPairingRecord(null);
            return;
        }

        return watchMobilePairingInvite(pairingInvite.pairingId, async (record) => {
            setPairingRecord(record);
            if (
                record?.status === 'accepted' &&
                pairingPrivateKeyRef.current &&
                trustedPairingIdRef.current !== record.pairingId
            ) {
                trustedPairingIdRef.current = record.pairingId;
                try {
                    const desktopSyncIdentity = await getOrCreateDesktopSyncIdentity(user.uid, mnemonic);
                    await trustAcceptedMobilePairing(user.uid, pairingPrivateKeyRef.current, record, desktopSyncIdentity.publicKeyJwk);
                    pairingPrivateKeyRef.current = null;
                } catch (error) {
                    trustedPairingIdRef.current = null;
                    setPairingError(error instanceof Error ? error.message : 'Não foi possível confiar neste dispositivo.');
                }
            }
        });
    }, [pairingInvite]);

    const handleResetIdentity = async () => {
        if (!confirm('⚠️ ATENÇÃO: Reiniciar a identidade significa que você NÃO poderá mais descriptografar suas memórias antigas sem o backup da chave. Tem certeza?')) {
            return;
        }

        const deleteOldMemories = confirm('Deseja ELIMINAR todas as memórias antigas da rede?\n\n✅ SIM = Limpar tudo e começar do zero\n❌ NÃO = Manter memórias isoladas');

        try {
            if (deleteOldMemories) {
                const { auth, db } = await import('../firebase');
                const { collection, getDocs, query, where, deleteDoc } = await import('firebase/firestore');

                if (auth.currentUser) {
                    const sessionsRef = collection(db, 'sessions');
                    const q = query(sessionsRef, where('uid', '==', auth.currentUser.uid));
                    const snapshot = await getDocs(q);

                    const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
                    await Promise.all(deletePromises);
                }
            }

            onResetKey();
            onClose();
        } catch (error: any) {
            console.error('Error during identity reset:', error);
            alert(`❌ Erro ao reiniciar identidade: ${error.message}`);
        }
    };

    const persistLocalAiConfig = (patch: Partial<LocalAiConfig>) => {
        setLocalAiConfig((current) => saveLocalAiConfig({ ...current, ...patch }));
    };

    const persistProviderConfig = (provider: AiProviderId, patch: Partial<AiProviderConfig>) => {
        setLocalAiConfig((current) => saveLocalAiConfig({
            ...current,
            host: provider === 'ollama' && patch.endpoint !== undefined ? patch.endpoint : current.host,
            model: provider === 'ollama' && patch.model !== undefined ? patch.model : current.model,
            providers: {
                ...current.providers,
                [provider]: {
                    ...current.providers[provider],
                    ...patch,
                },
            },
        }));
    };

    const selectPrimaryProvider = (provider: AiProviderId) => {
        setSecretInput('');
        persistLocalAiConfig({
            primaryProvider: provider,
            providers: {
                ...localAiConfig.providers,
                [provider]: {
                    ...localAiConfig.providers[provider],
                    enabled: true,
                    hasSecret: auth.currentUser ? hasProviderSecret(auth.currentUser.uid, provider) : localAiConfig.providers[provider].hasSecret,
                },
            },
        });
    };

    const handleSaveProviderSecret = async () => {
        const user = auth.currentUser;
        if (!user) return;
        setIsSavingSecret(true);
        try {
            await saveProviderSecret(user.uid, selectedProvider, secretInput, mnemonic);
            persistProviderConfig(selectedProvider, { hasSecret: true, enabled: true });
            setSecretInput('');
            alert('API key guardada no cofre local cifrado.');
        } catch (error: any) {
            alert(error.message || 'Não foi possível guardar a API key.');
        } finally {
            setIsSavingSecret(false);
        }
    };

    const handleClearProviderSecret = () => {
        const user = auth.currentUser;
        if (!user) return;
        clearProviderSecret(user.uid, selectedProvider);
        persistProviderConfig(selectedProvider, { hasSecret: false });
        setSecretInput('');
    };

    const handleCreateMobilePairing = async () => {
        const user = auth.currentUser;
        if (!user) return;
        if (!mnemonic || mnemonic.length !== 12) {
            setPairingError('Desbloqueia primeiro a mnemónica para criar um convite de pareamento.');
            return;
        }

        setIsCreatingPairing(true);
        setPairingError(null);
        try {
            const invite = await createMobilePairingInvite(user.uid);
            pairingPrivateKeyRef.current = invite.privateKey;
            trustedPairingIdRef.current = null;
            setPairingInvite({
                pairingId: invite.pairingId,
                pairingUri: invite.pairingUri,
                qrDataUrl: invite.qrDataUrl,
                expiresAt: invite.expiresAt,
            });
        } catch (error) {
            console.error('Unable to create mobile pairing invite:', error);
            setPairingError(error instanceof Error ? error.message : 'Não foi possível criar o convite de pareamento.');
        } finally {
            setIsCreatingPairing(false);
        }
    };

    const handleCancelMobilePairing = async () => {
        if (!pairingInvite) return;
        try {
            await cancelMobilePairingInvite(pairingInvite.pairingId);
        } catch (error) {
            console.warn('Unable to cancel mobile pairing invite:', error);
        } finally {
            pairingPrivateKeyRef.current = null;
            trustedPairingIdRef.current = null;
            setPairingInvite(null);
            setPairingRecord(null);
        }
    };

    const handleCopyPairingPayload = async () => {
        if (!pairingInvite) return;
        try {
            await navigator.clipboard.writeText(pairingInvite.pairingUri);
        } catch {
            setPairingError('Não foi possível copiar automaticamente o convite.');
        }
    };

    const handleRevokeTrustedDevice = async (deviceId: string) => {
        if (!confirm('Revogar este dispositivo? Ele deixará de aparecer como confiável.')) return;
        try {
            await revokeTrustedDevice(deviceId);
        } catch (error) {
            setPairingError(error instanceof Error ? error.message : 'Não foi possível revogar o dispositivo.');
        }
    };

    const handleQueueMobileSnapshot = async (device: TrustedDevice) => {
        const user = auth.currentUser;
        if (!user) return;
        setSyncingDeviceId(device.deviceId);
        setMobileSyncMessage(null);
        setPairingError(null);
        try {
            const envelopeId = await queueMobileMemorySnapshot(user.uid, device, sessions);
            setMobileSyncMessage(`Snapshot cifrado preparado para ${device.name}. Envelope ${envelopeId.slice(0, 8)}.`);
        } catch (error) {
            setPairingError(error instanceof Error ? error.message : 'Não foi possível preparar o sync cifrado.');
        } finally {
            setSyncingDeviceId(null);
        }
    };

    const desktopToMobileCursorKey = (deviceId: string) => `mnemosyne_sync_cursor_desktop_to_mobile_${deviceId}`;

    const handleQueueMobileDelta = async (device: TrustedDevice) => {
        const user = auth.currentUser;
        if (!user) return;
        const since = Number(localStorage.getItem(desktopToMobileCursorKey(device.deviceId)) || '0');
        const nextCursor = sessions.reduce(
            (max, session) => Math.max(max, session.updatedAt || session.timestamp || 0),
            since
        );
        setSyncingDeviceId(device.deviceId);
        setMobileSyncMessage(null);
        setPairingError(null);
        try {
            const envelopeId = await queueDesktopMemoryDelta(user.uid, device, sessions, since);
            localStorage.setItem(desktopToMobileCursorKey(device.deviceId), String(nextCursor));
            setMobileSyncMessage(`Delta cifrado preparado para ${device.name}. Envelope ${envelopeId.slice(0, 8)}.`);
        } catch (error) {
            setPairingError(error instanceof Error ? error.message : 'Não foi possível preparar o delta cifrado.');
        } finally {
            setSyncingDeviceId(null);
        }
    };

    const handleImportMobileDelta = async (device: TrustedDevice) => {
        const user = auth.currentUser;
        if (!user) return;
        setSyncingDeviceId(device.deviceId);
        setMobileSyncMessage(null);
        setPairingError(null);
        try {
            const desktopSyncIdentity = await getOrCreateDesktopSyncIdentity(user.uid, mnemonic);
            const result = await importQueuedDesktopSyncEnvelopes(
                user.uid,
                device.deviceId,
                desktopSyncIdentity.privateKeyJwk
            );
            setMobileSyncMessage(`${result.importedMemories} memórias recebidas de ${device.name}; ${result.conflicts} conflito(s).`);
        } catch (error) {
            setPairingError(error instanceof Error ? error.message : 'Não foi possível receber deltas mobile.');
        } finally {
            setSyncingDeviceId(null);
        }
    };

    const handleCleanupMobileSync = async () => {
        const user = auth.currentUser;
        if (!user) return;
        if (!confirm('Limpar envelopes consumidos/falhados e tombstones com mais de 30 dias?')) return;
        setPairingError(null);
        setMobileSyncMessage(null);
        try {
            const result = await cleanupMobileSyncArtifacts(user.uid, sessions, trustedDevices);
            setMobileSyncMessage(
                `Limpeza concluída: ${result.deletedEnvelopes} envelope(s), ${result.deletedTombstones} tombstone(s). ${result.retainedTombstones} tombstone(s) aguardam ack.`
            );
        } catch (error) {
            setPairingError(error instanceof Error ? error.message : 'Não foi possível limpar artefactos de sync.');
        }
    };

    const handleDeleteAccount = async () => {
        const confirmText = prompt('Digite "ELIMINAR" para confirmar a destruição permanente da sua mente digital:');
        if (confirmText !== 'ELIMINAR') return;

        if (!confirm('ÚLTIMA CONFIRMAÇÃO: Todo o seu conhecimento será eliminado permanentemente. Continuar?')) return;

        try {
            const { getFunctions, httpsCallable } = await import('firebase/functions');
            const { default: app } = await import('../firebase');
            const functions = getFunctions(app, 'europe-west1');
            const deleteUserAccount = httpsCallable(functions, 'deleteUserAccount');

            await deleteUserAccount();

            localStorage.clear();
            sessionStorage.clear();

            const { signOut } = await import('firebase/auth');
            const { auth } = await import('../firebase');
            await signOut(auth);

            alert('✅ Mente digital eliminada com sucesso. A regressar ao vazio.');
            window.location.href = '/';
        } catch (error: any) {
            alert(`❌ Erro ao eliminar mente digital: ${error.message}`);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-[#020617]/40 backdrop-blur-sm"
                    />

                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 10 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 10 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col
                                   bg-[#0a0f1e]/65 backdrop-blur-lg rounded-[24px] 
                                   border border-white/5 shadow-[0_0_40px_rgba(139,92,246,0.15)]"
                    >
                        {/* HEADER */}
                        <div className="p-6 flex justify-between items-center border-b border-white/[0.03]">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-purple-500/10 rounded-xl">
                                    <Brain className="w-5 h-5 text-purple-400" />
                                </div>
                                <h2 className="text-xl font-bold text-[#e2e8f0] tracking-wide">
                                    Definições
                                </h2>
                            </div>
                            <button 
                                onClick={onClose} 
                                className="p-2 text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-white/5 rounded-full transition-all"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* CONTENT */}
                        <div className="p-8 space-y-12 overflow-y-auto flex-1 scrollbar-hide">
                            
                            {/* IDENTIDADE */}
                            <section className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-bold text-[#e2e8f0] tracking-widest uppercase mb-1">Identidade</h3>
                                    <p className="text-xs text-[#94a3b8]">A tua chave define o acesso à tua mente digital.</p>
                                </div>
                                
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center border border-white/5">
                                                <Key className="w-4 h-4 text-purple-300" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-[#e2e8f0]">Chave ativa</p>
                                                <p className="text-xs text-cyan-400/80">Encriptação local ativa</p>
                                                {aesKeyReady ? (
                                                    <span className="text-green-400 text-xs">Chave AES derivada da mnemônica</span>
                                                ) : (
                                                    <span className="text-yellow-400 text-xs">Aguardando mnemônica...</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => setShowMnemonic(!showMnemonic)}
                                            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-white/10 bg-transparent hover:bg-white/5 hover:border-white/20 transition-all text-sm font-medium text-[#e2e8f0] hover:scale-[1.02]"
                                        >
                                            {showMnemonic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            {showMnemonic ? 'Ocultar palavras' : 'Ver palavras-chave'}
                                        </button>
                                        
                                        <button
                                            onClick={handleResetIdentity}
                                            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-white/10 bg-transparent hover:bg-white/5 hover:border-white/20 transition-all text-sm font-medium text-[#e2e8f0] hover:scale-[1.02]"
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                            Reiniciar identidade
                                        </button>
                                    </div>

                                    {showMnemonic && mnemonic && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            className="grid grid-cols-3 gap-2 p-4 bg-black/30 rounded-2xl border border-white/5"
                                        >
                                            {mnemonic.map((word, i) => (
                                                <div key={i} className="text-xs text-purple-200/70 bg-white/5 p-2 rounded-lg text-center backdrop-blur-md">
                                                    <span className="text-[#94a3b8] mr-2 text-[10px]">{i + 1}</span>
                                                    {word}
                                                </div>
                                            ))}
                                        </motion.div>
                                    )}
                                </div>
                            </section>

                            {/* MOBILE SYNC */}
                            <section className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-bold text-[#e2e8f0] tracking-widest uppercase mb-1">Mobile Sync</h3>
                                    <p className="text-xs text-[#94a3b8]">Pareamento efémero por QR para ligar um dispositivo móvel sem expor a tua semente.</p>
                                </div>

                                <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                                                <Smartphone className="w-4 h-4 text-cyan-300" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-[#e2e8f0]">Convite de pareamento</p>
                                                <p className="text-xs text-cyan-300/70">
                                                    {pairingInvite
                                                        ? `Expira às ${new Date(pairingInvite.expiresAt).toLocaleTimeString()}`
                                                        : 'Gera um QR válido por 10 minutos.'}
                                                </p>
                                            </div>
                                        </div>

                                        {pairingInvite ? (
                                            <button
                                                onClick={handleCancelMobilePairing}
                                                className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 transition-all text-xs font-bold uppercase tracking-widest text-red-200"
                                            >
                                                <X className="w-4 h-4" />
                                                Cancelar
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleCreateMobilePairing}
                                                disabled={isCreatingPairing || !aesKeyReady}
                                                className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs font-bold uppercase tracking-widest text-cyan-100"
                                            >
                                                <QrCode className="w-4 h-4" />
                                                {isCreatingPairing ? 'A gerar' : 'Gerar QR'}
                                            </button>
                                        )}
                                    </div>

                                    {pairingError && (
                                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                                            {pairingError}
                                        </div>
                                    )}

                                    {pairingRecord?.status === 'accepted' && (
                                        <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-200">
                                            Dispositivo aceite. Handshake ECDH validado e adicionado aos dispositivos confiáveis.
                                        </div>
                                    )}

                                    {mobileSyncMessage && (
                                        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                                            {mobileSyncMessage}
                                        </div>
                                    )}

                                    {pairingInvite && (
                                        <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-4 items-center">
                                            <div className="rounded-2xl bg-slate-50 p-3 w-fit">
                                                <img
                                                    src={pairingInvite.qrDataUrl}
                                                    alt="QR code de pareamento mobile"
                                                    className="w-48 h-48"
                                                />
                                            </div>
                                            <div className="space-y-3 min-w-0">
                                                <p className="text-xs leading-relaxed text-[#94a3b8]">
                                                    O QR contém apenas o convite, a chave pública efémera e o identificador da conta. A chave privada de pareamento fica só nesta sessão do browser.
                                                </p>
                                                <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                                                    <p className="truncate text-[10px] font-mono text-cyan-200/70">
                                                        {pairingInvite.pairingUri}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={handleCopyPairingPayload}
                                                    className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-xs font-bold uppercase tracking-widest text-[#e2e8f0]"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                    Copiar convite
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-3 border-t border-white/5 pt-4">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-bold uppercase tracking-widest text-[#94a3b8]">Dispositivos confiáveis</p>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={handleCleanupMobileSync}
                                                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#94a3b8] hover:bg-white/10"
                                                >
                                                    Limpar
                                                </button>
                                                <span className="text-[10px] text-cyan-200/60">{trustedDevices.filter((device) => device.status === 'active').length} ativo(s)</span>
                                            </div>
                                        </div>

                                        {trustedDevices.length === 0 ? (
                                            <p className="text-xs text-[#94a3b8]">Ainda não há dispositivos pareados.</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {trustedDevices.map((device) => (
                                                    <div key={device.deviceId} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-xs font-medium text-[#e2e8f0]">{device.name}</p>
                                                            <p className="text-[10px] text-[#94a3b8]">
                                                                {device.status === 'active' ? 'Ativo' : 'Revogado'} · {new Date(device.pairedAt).toLocaleString()}
                                                            </p>
                                                        </div>
                                                        {device.status === 'active' && (
                                                            <div className="flex shrink-0 items-center gap-2">
                                                                <button
                                                                    onClick={() => handleQueueMobileSnapshot(device)}
                                                                    disabled={syncingDeviceId === device.deviceId}
                                                                    className="flex items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
                                                                >
                                                                    <UploadCloud className="w-3.5 h-3.5" />
                                                                    Snapshot
                                                                </button>
                                                                <button
                                                                    onClick={() => handleQueueMobileDelta(device)}
                                                                    disabled={syncingDeviceId === device.deviceId}
                                                                    className="flex items-center gap-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
                                                                >
                                                                    <UploadCloud className="w-3.5 h-3.5" />
                                                                    {syncingDeviceId === device.deviceId ? 'Sync' : 'Delta'}
                                                                </button>
                                                                <button
                                                                    onClick={() => handleImportMobileDelta(device)}
                                                                    disabled={syncingDeviceId === device.deviceId}
                                                                    className="rounded-lg border border-purple-500/20 bg-purple-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-purple-200 hover:bg-purple-500/20 disabled:opacity-40"
                                                                >
                                                                    Receber
                                                                </button>
                                                                <button
                                                                    onClick={() => handleRevokeTrustedDevice(device.deviceId)}
                                                                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-500/20"
                                                                >
                                                                    Revogar
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <SyncConflictPanel sessions={sessions} />
                                </div>
                            </section>

                            {/* UNIVERSO */}
                            <section className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-bold text-[#e2e8f0] tracking-widest uppercase mb-1">Universo</h3>
                                    <p className="text-xs text-[#94a3b8]">Define como a tua mente é representada.</p>
                                </div>

                                <div className="grid grid-cols-4 gap-3">
                                    {universeTypes.map((type) => (
                                        <button
                                            key={type.id}
                                            onClick={() => setUniverseType(type.id)}
                                            className={`relative group p-3 rounded-2xl border transition-all duration-300 flex flex-col items-center gap-3 hover:scale-[1.05] ${
                                                universeType === type.id 
                                                    ? 'border-purple-500/50 bg-purple-500/10' 
                                                    : 'border-white/5 bg-black/20 hover:border-white/20 hover:bg-white/5'
                                            }`}
                                        >
                                            <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${type.color} opacity-80 group-hover:opacity-100 group-hover:shadow-[0_0_15px_rgba(139,92,246,0.5)] transition-all`} />
                                            <span className="text-[10px] font-medium text-[#94a3b8] group-hover:text-[#e2e8f0]">
                                                {type.name}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {/* INTELIGÊNCIAS */}
                            <section className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-bold text-[#e2e8f0] tracking-widest uppercase mb-1">AI Hub</h3>
                                    <p className="text-xs text-[#94a3b8]">Escolhe provedores, modelos, permissões e chaves cifradas localmente.</p>
                                </div>

                                <div className="space-y-4">
                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <Cpu className="w-4 h-4 text-purple-400" />
                                                <span className="text-sm font-medium text-[#e2e8f0]">Provedor primário</span>
                                            </div>
                                            <select
                                                className="bg-[#0b1120] text-xs text-white border border-white/10 rounded-lg px-2 py-1 outline-none"
                                                value={selectedProvider}
                                                onChange={(e) => selectPrimaryProvider(e.target.value as AiProviderId)}
                                            >
                                                {AI_PROVIDERS.map((provider) => (
                                                    <option key={provider.id} value={provider.id}>
                                                        {provider.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="space-y-3">
                                            {providerGroups.map((group) => (
                                                <div key={group.title} className="space-y-2">
                                                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#64748b]">
                                                        {group.title}
                                                    </p>
                                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                        {group.providers.map((provider) => {
                                                            const cfg = localAiConfig.providers[provider.id];
                                                            const selected = selectedProvider === provider.id;
                                                            return (
                                                                <button
                                                                    key={provider.id}
                                                                    onClick={() => selectPrimaryProvider(provider.id)}
                                                                    className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                                                                        selected
                                                                            ? 'border-purple-500/50 bg-purple-500/10 text-purple-100'
                                                                            : 'border-white/5 bg-black/20 text-[#94a3b8] hover:border-white/20'
                                                                    }`}
                                                                >
                                                                    <span className="block text-[11px] font-bold">{provider.label}</span>
                                                                    <span className="text-[9px] uppercase tracking-widest opacity-70">
                                                                        {provider.kind}{cfg.hasSecret ? ' / key' : ''}
                                                                    </span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <label className="space-y-1">
                                                <span className="text-[10px] text-[#94a3b8] uppercase tracking-widest">
                                                    {activeProvider.kind === 'cloud' ? 'Endpoint opcional' : 'Endpoint'}
                                                </span>
                                                <input
                                                    value={activeProviderConfig.endpoint}
                                                    onChange={(e) => persistProviderConfig(selectedProvider, { endpoint: e.target.value, enabled: true })}
                                                    className="w-full bg-[#0b1120] text-xs text-white border border-white/10 rounded-lg px-3 py-2 outline-none focus:border-purple-500/50"
                                                    placeholder={activeProvider.defaultEndpoint || 'usar endpoint padrão do provedor'}
                                                />
                                            </label>
                                            <label className="space-y-1">
                                                <span className="text-[10px] text-[#94a3b8] uppercase tracking-widest">Modelo</span>
                                                <input
                                                    value={activeProviderConfig.model}
                                                    onChange={(e) => persistProviderConfig(selectedProvider, { model: e.target.value, enabled: true })}
                                                    className="w-full bg-[#0b1120] text-xs text-white border border-white/10 rounded-lg px-3 py-2 outline-none focus:border-purple-500/50"
                                                    placeholder="nome exato do modelo no provedor"
                                                />
                                            </label>
                                        </div>

                                        {activeProvider.needsSecret && (
                                            <div className="space-y-2 rounded-xl border border-white/5 bg-black/20 p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-xs font-medium text-[#e2e8f0]">API key cifrada</p>
                                                        <p className="text-[10px] text-[#94a3b8]">
                                                            {activeProviderConfig.hasSecret ? 'Existe uma key guardada neste dispositivo.' : 'Nenhuma key guardada.'}
                                                        </p>
                                                    </div>
                                                    {activeProviderConfig.hasSecret && (
                                                        <button
                                                            onClick={handleClearProviderSecret}
                                                            className="px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-[10px] font-bold uppercase tracking-widest text-red-300 hover:bg-red-500/20"
                                                        >
                                                            Remover
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="password"
                                                        value={secretInput}
                                                        onChange={(e) => setSecretInput(e.target.value)}
                                                        className="flex-1 bg-[#0b1120] text-xs text-white border border-white/10 rounded-lg px-3 py-2 outline-none focus:border-purple-500/50"
                                                        placeholder="colar API key para guardar no cofre local"
                                                    />
                                                    <button
                                                        onClick={handleSaveProviderSecret}
                                                        disabled={isSavingSecret || !secretInput.trim() || !aesKeyReady}
                                                        className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-500/20 text-[10px] font-bold uppercase tracking-widest hover:bg-purple-500/30 disabled:opacity-40"
                                                    >
                                                        Guardar
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-[#94a3b8]">Permissões de Memória</span>
                                            <select
                                                value={localAiConfig.memoryPermission}
                                                onChange={(e) => persistLocalAiConfig({ memoryPermission: e.target.value as LocalAiConfig['memoryPermission'] })}
                                                className="bg-[#0b1120] text-xs text-red-400 border border-white/10 rounded-lg px-2 py-1 outline-none"
                                            >
                                                <option value="never-cloud">Nunca enviar para Cloud</option>
                                                <option value="confirm-cloud">Confirmar cada envio</option>
                                                <option value="allow-cloud">Permitir cloud configurada</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-[#94a3b8]">Se a IA falhar</span>
                                            <select
                                                value={localAiConfig.failurePolicy}
                                                onChange={(e) => persistLocalAiConfig({ failurePolicy: e.target.value as LocalAiConfig['failurePolicy'] })}
                                                className="bg-[#0b1120] text-xs text-amber-300 border border-white/10 rounded-lg px-2 py-1 outline-none"
                                            >
                                                <option value="save-with-warning">Guardar com aviso</option>
                                                <option value="confirm-before-save">Confirmar antes de guardar</option>
                                                <option value="block-save">Bloquear gravação</option>
                                            </select>
                                        </div>
                                        <p className="text-[10px] leading-relaxed text-[#94a3b8]">
                                            Providers cloud só devem receber memórias quando esta permissão permitir. A política de falha define se erros de IA permitem guardar a memória sem enriquecimento.
                                        </p>
                                    </div>
                                </div>
                            </section>

                            {/* INTEGRAÇÕES */}
                            <section className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-bold text-[#e2e8f0] tracking-widest uppercase mb-1">Integrações Desktop</h3>
                                    <p className="text-xs text-[#94a3b8]">Expande o Mnemosyne para o teu SO.</p>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-[#e2e8f0]">Windows Explorer Context Menu</span>
                                        </div>
                                        <button className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-medium transition-colors text-white">
                                            Instalar "Enviar para Mnemosyne"
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-[#e2e8f0]">Plano Atual</span>
                                        </div>
                                        <button 
                                            onClick={() => setPlanosOpen(true)}
                                            className="px-3 py-1 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 rounded-lg text-xs font-medium transition-colors">
                                            Ver Planos (Sovereign)
                                        </button>
                                    </div>
                                </div>
                            </section>

                            {/* PRIVACIDADE */}
                            <section className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-bold text-[#e2e8f0] tracking-widest uppercase mb-1">Privacidade</h3>
                                    <p className="text-xs text-[#94a3b8]">O teu conhecimento pertence apenas a ti.</p>
                                </div>

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="flex items-center gap-3">
                                            <Shield className="w-4 h-4 text-green-400" />
                                            <span className="text-sm font-medium text-green-400">Zero-Knowledge ativo</span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-[#e2e8f0]">Partilha entre utilizadores</span>
                                        </div>
                                        <button 
                                            onClick={() => setShareEnabled(!shareEnabled)}
                                            className={`w-10 h-5 rounded-full relative transition-colors duration-300 ${shareEnabled ? 'bg-cyan-500' : 'bg-white/10'}`}
                                        >
                                            <motion.div 
                                                className="w-4 h-4 bg-white rounded-full absolute top-0.5"
                                                animate={{ left: shareEnabled ? '22px' : '2px' }}
                                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                            />
                                        </button>
                                    </div>
                                </div>
                            </section>

                            {/* ZONA CRÍTICA */}
                            <section className="pt-6 border-t border-red-500/10">
                                <h3 className="text-sm font-bold text-red-400/80 tracking-widest uppercase mb-4 flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4" /> Zona Crítica
                                </h3>
                                
                                <div className="p-5 bg-red-500/[0.03] rounded-2xl border border-red-500/10">
                                    <button
                                        onClick={handleDeleteAccount}
                                        className="w-full py-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-sm hover:bg-red-500/20 hover:shadow-[0_0_20px_rgba(239,68,68,0.2)] transition-all hover:scale-[1.01]"
                                    >
                                        Eliminar conta permanentemente
                                    </button>
                                </div>
                            </section>

                        </div>
                    </motion.div>
                    
                    <PlansModal isOpen={planosOpen} onClose={() => setPlanosOpen(false)} />
                </div>
            )}
        </AnimatePresence>
    );
};
