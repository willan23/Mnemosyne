import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { deriveAesKeyFromMnemonic } from '../utils/crypto';
import { auth } from '../firebase';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Brain, Key, Eye, EyeOff, Shield, AlertTriangle, Cpu, RotateCcw, Smartphone, QrCode, Copy, UploadCloud, Download, Globe, Folder, Compass, Lock, Search, type LucideIcon } from 'lucide-react';
import {
    disableLocalPin,
    enableLocalPin,
    isLocalPinEnabled,
} from '../utils/localPin';
import toast from 'react-hot-toast';
import { resetOnboarding } from './OnboardingTour';
import { PlansModal } from './PlanosModal';
import { SyncConflictPanel } from './SyncConflictPanel';
import { McpIntegrationPanel } from './McpIntegrationPanel';
import { learnDocumentBatch } from '../services/learningService';
import { isTauriRuntime, selectAndReadTauriDirectory } from '../utils/tauriFolderImporter';
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
import { useUniverseStore } from '../store/universeStore';
import { useTranslation } from '../utils/translations';
import type { UniverseType } from '../types/universe';
import { DESKTOP_APP_DOWNLOAD_URL, MOBILE_APP_DOWNLOAD_URL, openExternalDownload } from '../config/downloads';
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

type SettingsSectionId = 'identity' | 'mobile' | 'universe' | 'ai' | 'integrations' | 'privacy' | 'account';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    mnemonic: string[] | null;
    onResetKey: () => void;
    sessions?: SessionData[];
    onReplayOnboarding?: () => void;
    /** Secção inicial (ex: 'privacy', 'ai') — deep-link da Command Palette */
    initialSection?: SettingsSectionId | string | null;
}

const SETTINGS_SECTION_KEY = 'mnemosyne.settings.section.v1';

const SETTINGS_SEARCH_INDEX: Record<SettingsSectionId, string[]> = {
    identity: ['chave', 'mnemónica', 'mnemonic', 'uid', 'identidade', 'seed', 'backup'],
    mobile: ['android', 'qr', 'sync', 'mobile', 'dispositivo', 'pairing', 'telefone'],
    universe: ['universo', 'galáxia', 'tema visual', '3d', 'nebulosa', 'void'],
    ai: ['ia', 'ai', 'ollama', 'openai', 'modelo', 'llm', 'nvidia', 'gemini', 'anthropic', 'mistral', 'permissões'],
    integrations: ['importar', 'pasta', 'download', 'desktop', 'app', 'integrar', 'ficheiros'],
    privacy: ['pin', 'privacidade', 'zero-knowledge', 'partilha', 'onboarding', 'segurança', 'idle'],
    account: ['conta', 'apagar', 'eliminar', 'danger', 'delete'],
};

const isSettingsSection = (value: string | null | undefined): value is SettingsSectionId =>
    Boolean(value && value in SETTINGS_SEARCH_INDEX);

const universeTypes = [
    { id: 'galaxia', name: 'Galáxia', universeType: 'stellar' as UniverseType, color: 'from-purple-500 to-blue-500' },
    { id: 'sistema-solar', name: 'Sistema Solar', universeType: 'solar' as UniverseType, color: 'from-orange-400 to-yellow-500' },
    { id: 'nebulosa', name: 'Nebulosa', universeType: 'mythic' as UniverseType, color: 'from-pink-500 to-rose-400' },
    { id: 'buraco-negro', name: 'Buraco Negro', universeType: 'void' as UniverseType, color: 'from-gray-700 to-black' }
];

interface SettingsTab {
    id: SettingsSectionId;
    label: string;
    description: string;
    icon: LucideIcon;
}



const SectionHeader: React.FC<{
    icon: LucideIcon;
    title: string;
    description: string;
}> = ({ icon: Icon, title, description }) => (
    <div className="flex flex-col gap-4 border-b border-white/5 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-purple-400/20 bg-purple-500/10 p-3">
                <Icon className="h-5 w-5 text-purple-300" />
            </div>
            <div>
                <h3 className="text-lg font-bold tracking-tight text-[#f8fafc]">{title}</h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[#94a3b8]">{description}</p>
            </div>
        </div>
    </div>
);

const getErrorMessage = (error: unknown, fallback: string) => (
    error instanceof Error ? error.message : fallback
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    mnemonic,
    onResetKey,
    sessions = [],
    onReplayOnboarding,
    initialSection = null,
}) => {
    const { t, language } = useTranslation();
    const setLanguage = useUniverseStore((state) => state.setLanguage);

    const tabs: SettingsTab[] = [
        { id: 'identity', label: t('tabIdentity'), description: t('tabIdentityDesc'), icon: Key },
        { id: 'mobile', label: t('tabMobile'), description: t('tabMobileDesc'), icon: Smartphone },
        { id: 'universe', label: t('tabUniverse'), description: t('tabUniverseDesc'), icon: Brain },
        { id: 'ai', label: t('tabAi'), description: t('tabAiDesc'), icon: Cpu },
        { id: 'integrations', label: t('tabIntegrations'), description: t('tabIntegrationsDesc'), icon: Download },
        { id: 'privacy', label: t('tabPrivacy'), description: t('tabPrivacyDesc'), icon: Shield },
        { id: 'account', label: t('tabAccount'), description: t('tabAccountDesc'), icon: AlertTriangle },
    ];

    const [showMnemonic, setShowMnemonic] = useState(false);
    const [shareEnabled, setShareEnabled] = useState(false);
    const [pinEnabled, setPinEnabled] = useState(() => isLocalPinEnabled());
    const [pinInput, setPinInput] = useState('');
    const [pinConfirm, setPinConfirm] = useState('');
    const [pinBusy, setPinBusy] = useState(false);
    const [planosOpen, setPlanosOpen] = useState(false);
    const [settingsQuery, setSettingsQuery] = useState('');
    const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => {
        try {
            const saved = localStorage.getItem(SETTINGS_SECTION_KEY) as SettingsSectionId | null;
            if (saved && SETTINGS_SEARCH_INDEX[saved]) return saved;
        } catch { /* ignore */ }
        return 'identity';
    });
    const [aesKeyReady, setAesKeyReady] = useState(false);
    const [mobileInstallQr, setMobileInstallQr] = useState<string | null>(null);
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
    const mnemonicPanelRef = useRef<HTMLDivElement | null>(null);
    const settingsFolderInputRef = useRef<HTMLInputElement | null>(null);
    const [isImportingFolder, setIsImportingFolder] = useState(false);
    const universeType = useUniverseStore((state) => state.universeType);
    const setGlobalUniverseType = useUniverseStore((state) => state.setUniverseType);
    const selectedUniverse = universeTypes.find((type) => type.universeType === universeType) || universeTypes[0];
    const selectedUniversePreset = selectedUniverse.id;
    const selectedProvider = localAiConfig.primaryProvider;
    const activeProvider = AI_PROVIDERS.find((provider) => provider.id === selectedProvider) || AI_PROVIDERS[0];
    const activeProviderConfig = localAiConfig.providers[selectedProvider];
    const trustedActiveCount = trustedDevices.filter((device) => device.status === 'active').length;
    const activeTab = tabs.find((tab) => tab.id === activeSection) || tabs[0];
    const ActiveTabIcon = activeTab.icon;
    const activeProviderBadge = activeProvider.label.replace(' Local', '').replace(' Backend', '');
    const tabBadges: Record<SettingsSectionId, string> = {
        identity: aesKeyReady ? 'AES' : t('badgeIdentityLocked'),
        mobile: trustedActiveCount > 0 
            ? `${trustedActiveCount} ${t('badgeMobileActive')}` 
            : `0 ${t('badgeMobilePairs')}`,
        universe: selectedUniverse.id === 'galaxia' ? t('badgeUniverseGalaxy') :
                  selectedUniverse.id === 'sistema-solar' ? t('badgeUniverseSolar') :
                  selectedUniverse.id === 'nebulosa' ? t('badgeUniverseNebula') :
                  selectedUniverse.id === 'buraco-negro' ? t('badgeUniverseVoid') : selectedUniverse.name,
        ai: activeProviderBadge,
        integrations: t('badgeIntegrationsFree'),
        privacy: shareEnabled ? t('badgePrivacySharing') : t('badgePrivacyPrivate'),
        account: t('badgeAccountCritical'),
    };
    const providerGroups = [
        { title: 'Local e backend controlado', providers: AI_PROVIDERS.filter((provider) => provider.kind !== 'cloud') },
        { title: 'Cloud com consentimento', providers: AI_PROVIDERS.filter((provider) => provider.kind === 'cloud') },
    ];

    const selectSection = (section: SettingsSectionId) => {
        setActiveSection(section);
        try {
            localStorage.setItem(SETTINGS_SECTION_KEY, section);
        } catch { /* ignore */ }
    };

    // Deep-link / última secção ao abrir
    useEffect(() => {
        if (!isOpen) return;
        if (isSettingsSection(initialSection)) {
            selectSection(initialSection);
            return;
        }
        try {
            const saved = localStorage.getItem(SETTINGS_SECTION_KEY);
            if (isSettingsSection(saved)) setActiveSection(saved);
        } catch { /* ignore */ }
    }, [isOpen, initialSection]);

    // Atalhos 1–7 para secções quando o modal está aberto
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
            const idx = Number(event.key) - 1;
            if (idx >= 0 && idx < tabs.length) {
                event.preventDefault();
                selectSection(tabs[idx].id);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, tabs]);

    const visibleTabs = tabs.filter((tab) => {
        const q = settingsQuery.trim().toLowerCase();
        if (!q) return true;
        const keywords = SETTINGS_SEARCH_INDEX[tab.id].join(' ');
        return (
            tab.label.toLowerCase().includes(q) ||
            tab.description.toLowerCase().includes(q) ||
            keywords.includes(q) ||
            tab.id.includes(q)
        );
    });

    useEffect(() => {
        if (!settingsQuery.trim()) return;
        if (visibleTabs.some((tab) => tab.id === activeSection)) return;
        if (visibleTabs[0]) selectSection(visibleTabs[0].id);
    }, [settingsQuery, visibleTabs, activeSection]);

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
        if (!isOpen) return;
        let cancelled = false;
        QRCode.toDataURL(MOBILE_APP_DOWNLOAD_URL, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 220,
            color: {
                dark: '#020617',
                light: '#f8fafc',
            },
        }).then((dataUrl) => {
            if (!cancelled) setMobileInstallQr(dataUrl);
        }).catch(() => {
            if (!cancelled) setMobileInstallQr(null);
        });
        return () => { cancelled = true; };
    }, [isOpen]);

    useEffect(() => {
        if (!showMnemonic) return;
        requestAnimationFrame(() => {
            mnemonicPanelRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
            });
        });
    }, [showMnemonic]);

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
    }, [mnemonic, pairingInvite]);

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
        } catch (error: unknown) {
            console.error('Error during identity reset:', error);
            alert(`❌ Erro ao reiniciar identidade: ${getErrorMessage(error, 'Erro desconhecido')}`);
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
        } catch (error: unknown) {
            alert(getErrorMessage(error, 'Não foi possível guardar a API key.'));
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
            setPairingError('Desbloqueia primeiro a mnemónica para criar um convite de emparelhamento.');
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
            setPairingError(error instanceof Error ? error.message : 'Não foi possível criar o convite de emparelhamento.');
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
        } catch (error: unknown) {
            alert(`❌ Erro ao eliminar mente digital: ${getErrorMessage(error, 'Erro desconhecido')}`);
        }
    };

    const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const fileArray = Array.from(files);

        // Filtrar ficheiros ignorados (como node_modules, .git, .vscode, lockfiles, ficheiros ocultos ou de 0 bytes)
        const ignoredPatterns = [
            /[\\/]\.git[\\/]/,
            /[\\/]\.vscode[\\/]/,
            /[\\/]node_modules[\\/]/,
            /[\\/]\.next[\\/]/,
            /[\\/]dist[\\/]/,
            /[\\/]build[\\/]/,
            /\.DS_Store$/i,
            /thumbs\.db$/i,
            /package-lock\.json$/i,
            /yarn\.lock$/i,
            /pnpm-lock\.yaml$/i,
        ];

        const eligibleFiles = fileArray.filter((file) => {
            const path = file.webkitRelativePath || file.name;
            const isIgnored = ignoredPatterns.some((pattern) => pattern.test(path));
            const isDotFile = file.name.startsWith('.');
            return !isIgnored && !isDotFile && file.size > 0;
        });

        if (eligibleFiles.length === 0) {
            alert(t('noFilesFound'));
            if (settingsFolderInputRef.current) settingsFolderInputRef.current.value = '';
            return;
        }

        let finalFiles = eligibleFiles;
        if (eligibleFiles.length > 20) {
            alert(t('folderLimitWarning'));
            finalFiles = eligibleFiles.slice(0, 20);
        }

        const user = auth.currentUser;
        if (!user) return;

        setIsImportingFolder(true);
        try {
            await learnDocumentBatch(user.uid, finalFiles, sessions);
            alert(t('foldersLearnedSuccess', { count: finalFiles.length }));
        } catch (error: unknown) {
            console.error('Erro ao assimilar pasta:', error);
            alert(t('foldersLearnedError'));
        } finally {
            setIsImportingFolder(false);
            if (settingsFolderInputRef.current) settingsFolderInputRef.current.value = '';
        }
    };

    const triggerFolderImport = async () => {
        if (isTauriRuntime()) {
            try {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const selected = await open({
                    directory: true,
                    multiple: false,
                });
                if (!selected) return;

                setIsImportingFolder(true);
                const importedFiles = await selectAndReadTauriDirectory(selected);

                if (importedFiles.length === 0) {
                    alert(t('noFilesFound'));
                    return;
                }

                let finalFiles = importedFiles;
                if (importedFiles.length > 20) {
                    alert(t('folderLimitWarning'));
                    finalFiles = importedFiles.slice(0, 20);
                }

                const user = auth.currentUser;
                if (!user) return;

                await learnDocumentBatch(user.uid, finalFiles, sessions);
                alert(t('foldersLearnedSuccess', { count: finalFiles.length }));
            } catch (error: unknown) {
                console.error('Erro ao assimilar pasta via Tauri:', error);
                alert(t('foldersLearnedError'));
            } finally {
                setIsImportingFolder(false);
            }
        } else {
            settingsFolderInputRef.current?.click();
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-5">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-[#020617]/55 backdrop-blur-md"
                    />

                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 10 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 10 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-title"
                        className="relative mx-auto flex h-[calc(100dvh-1.5rem)] max-h-[900px] min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-[24px]
                                   border border-white/10 bg-[#070d1b]/90 shadow-[0_24px_90px_rgba(0,0,0,0.55),0_0_48px_rgba(139,92,246,0.14)] backdrop-blur-2xl"
                    >
                        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="rounded-2xl border border-purple-400/20 bg-purple-500/10 p-2.5">
                                        <Brain className="h-5 w-5 text-purple-300" />
                                    </div>
                                    <div className="min-w-0">
                                        <h2 id="settings-title" className="text-lg font-bold tracking-tight text-[#f8fafc]">
                                            Definições
                                        </h2>
                                        <p className="hidden truncate text-xs text-[#94a3b8] sm:block">
                                            Centro de controlo: privacidade, universo, IA e sincronização · teclas 1–7
                                        </p>
                                    </div>
                                </div>
                                <button 
                                    onClick={onClose} 
                                    className="rounded-full p-2 text-[#94a3b8] transition-all hover:bg-white/5 hover:text-[#e2e8f0]"
                                    aria-label="Fechar definições"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                                <input
                                    type="search"
                                    value={settingsQuery}
                                    onChange={(e) => setSettingsQuery(e.target.value)}
                                    placeholder="Procurar em definições (PIN, Ollama, sync, privacidade…)"
                                    className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400/40 focus:ring-2 focus:ring-violet-400/15"
                                />
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">
                                    {sessions.length} memórias
                                </span>
                                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">
                                    PIN {pinEnabled ? 'ativo' : 'off'}
                                </span>
                                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">
                                    IA · {activeProviderBadge}
                                </span>
                                <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-400">
                                    Sync · {trustedActiveCount} dispositivo(s)
                                </span>
                            </div>
                        </div>

                        <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)]">
                            <aside className="hidden border-r border-white/[0.06] bg-black/10 p-4 lg:block">
                                <div className="mb-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-purple-200/70">Secção ativa</p>
                                    <div className="mt-3 flex items-center gap-3">
                                        <div className="rounded-xl border border-purple-400/20 bg-purple-500/10 p-2">
                                            <ActiveTabIcon className="h-4 w-4 text-purple-300" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-bold text-[#f8fafc]">{activeTab.label}</p>
                                            <p className="truncate text-xs text-[#94a3b8]">{tabBadges[activeTab.id]}</p>
                                        </div>
                                    </div>
                                </div>
                                <nav className="space-y-1" aria-label="Secções das definições">
                                    {visibleTabs.map((tab, index) => {
                                        const Icon = tab.icon;
                                        const active = activeSection === tab.id;
                                        const originalIndex = tabs.findIndex((t) => t.id === tab.id);
                                        return (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                onClick={() => selectSection(tab.id)}
                                                className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all ${
                                                    active
                                                        ? 'border-purple-400/35 bg-purple-500/12 text-[#f8fafc] shadow-[0_0_24px_rgba(139,92,246,0.10)]'
                                                        : 'border-transparent text-[#94a3b8] hover:border-white/10 hover:bg-white/[0.04] hover:text-[#e2e8f0]'
                                                }`}
                                            >
                                                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-purple-200' : 'text-[#64748b]'}`} />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-semibold">{tab.label}</span>
                                                    <span className="block truncate text-[11px] text-[#64748b]">{tab.description}</span>
                                                </span>
                                                <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${
                                                    active ? 'bg-purple-400/15 text-purple-100' : 'bg-white/[0.04] text-[#64748b]'
                                                }`}>
                                                    {originalIndex >= 0 ? originalIndex + 1 : index + 1}
                                                </span>
                                            </button>
                                        );
                                    })}
                                    {visibleTabs.length === 0 && (
                                        <p className="px-2 py-6 text-center text-xs text-slate-500">
                                            Nenhuma secção corresponde a “{settingsQuery}”.
                                        </p>
                                    )}
                                </nav>
                            </aside>

                            <div className="flex min-h-0 min-w-0 flex-col">
                                <div className="border-b border-white/[0.06] px-4 py-3 lg:hidden">
                                    <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Secções das definições">
                                        {visibleTabs.map((tab) => {
                                            const Icon = tab.icon;
                                            const active = activeSection === tab.id;
                                            return (
                                                <button
                                                    key={tab.id}
                                                    type="button"
                                                    onClick={() => selectSection(tab.id)}
                                                    className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
                                                        active
                                                            ? 'border-purple-400/35 bg-purple-500/15 text-purple-100'
                                                            : 'border-white/5 bg-white/[0.03] text-[#94a3b8]'
                                                    }`}
                                                >
                                                    <Icon className="h-3.5 w-3.5" />
                                                    {tab.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-5 sm:p-6 lg:p-8 custom-scrollbar">
                                    {activeSection === 'identity' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={Key}
                                    title="Identidade"
                                    description="Gere a tua chave, estado de encriptação, UID e frase de recuperação."
                                />
                                
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
                                                    <span className="text-green-400 text-xs">Chave AES derivada da mnemónica</span>
                                                ) : (
                                                    <span className="text-yellow-400 text-xs">A aguardar mnemónica...</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-4 p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-[#e2e8f0]">UID do utilizador</p>
                                            <p className="truncate font-mono text-xs text-cyan-300/80">{auth.currentUser?.uid || 'UID indisponível'}</p>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const uid = auth.currentUser?.uid;
                                                if (uid) navigator.clipboard.writeText(uid);
                                            }}
                                            className="shrink-0 px-3 py-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 hover:bg-cyan-500/20 transition-all text-[10px] font-bold uppercase tracking-widest text-cyan-100"
                                        >
                                            Copiar UID
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => setShowMnemonic(!showMnemonic)}
                                            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-white/10 bg-transparent hover:bg-white/5 hover:border-white/20 transition-all text-sm font-medium text-[#e2e8f0] hover:scale-[1.02]"
                                        >
                                            {showMnemonic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            {showMnemonic ? 'Ocultar palavras' : 'Ver 12 palavras'}
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
                                            ref={mnemonicPanelRef}
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
                                    )}

                                    {activeSection === 'mobile' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={Smartphone}
                                    title="Mobile Sync"
                                    description="Instala a app Android, cria convites QR e gere dispositivos confiáveis sem expor a tua semente."
                                />

                                <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-4">
                                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                                                <Download className="w-4 h-4 text-emerald-300" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-[#e2e8f0]">Instalar app Android</p>
                                                <p className="text-xs text-emerald-300/70">QR direto para a Play Store.</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => openExternalDownload(MOBILE_APP_DOWNLOAD_URL)}
                                            className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all text-xs font-bold uppercase tracking-widest text-emerald-100"
                                        >
                                            <Smartphone className="w-4 h-4" />
                                            Abrir Play Store
                                        </button>
                                    </div>
                                    {mobileInstallQr && (
                                        <div className="grid grid-cols-1 md:grid-cols-[auto,1fr] gap-4 items-center">
                                            <div className="rounded-2xl bg-slate-50 p-3 w-fit">
                                                <img
                                                    src={mobileInstallQr}
                                                    alt="QR code para instalar a app pela Play Store"
                                                    className="w-40 h-40"
                                                />
                                            </div>
                                            <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2">
                                                <p className="truncate text-[10px] font-mono text-emerald-200/70">
                                                    {MOBILE_APP_DOWNLOAD_URL}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                                                <Smartphone className="w-4 h-4 text-cyan-300" />
                                            </div>
                                            <div className="min-w-0">
                                            <p className="text-sm font-bold text-[#e2e8f0]">Convite de emparelhamento</p>
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
                                                    alt="QR code de emparelhamento mobile"
                                                    className="w-48 h-48"
                                                />
                                            </div>
                                            <div className="space-y-3 min-w-0">
                                                <p className="text-xs leading-relaxed text-[#94a3b8]">
                                                    O QR contém apenas o convite, a chave pública efémera e o identificador da conta. A chave privada de emparelhamento fica só nesta sessão do browser.
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
                                    )}

                                    {activeSection === 'universe' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={Brain}
                                    title={t('universeTitle')}
                                    description={t('universeDesc')}
                                />

                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                    {universeTypes.map((type) => (
                                        <button
                                            key={type.id}
                                            onClick={() => setGlobalUniverseType(type.universeType)}
                                            className={`relative group p-3 rounded-2xl border transition-all duration-300 flex flex-col items-center gap-3 hover:scale-[1.05] ${
                                                selectedUniversePreset === type.id
                                                    ? 'border-purple-500/50 bg-purple-500/10' 
                                                    : 'border-white/5 bg-black/20 hover:border-white/20 hover:bg-white/5'
                                            }`}
                                        >
                                            <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${type.color} opacity-80 group-hover:opacity-100 group-hover:shadow-[0_0_15px_rgba(139,92,246,0.5)] transition-all`} />
                                            <span className="text-[10px] font-medium text-[#94a3b8] group-hover:text-[#e2e8f0]">
                                                {type.id === 'galaxia' ? t('badgeUniverseGalaxy') :
                                                 type.id === 'sistema-solar' ? t('badgeUniverseSolar') :
                                                 type.id === 'nebulosa' ? t('badgeUniverseNebula') :
                                                 type.id === 'buraco-negro' ? t('badgeUniverseVoid') : type.name}
                                            </span>
                                        </button>
                                    ))}
                                </div>

                                <div className="border-t border-white/5 pt-6">
                                    <div className="flex flex-col gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className="rounded-2xl border border-purple-400/20 bg-purple-500/10 p-3">
                                                <Globe className="h-5 w-5 text-purple-300" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-bold tracking-tight text-[#f8fafc]">{t('languageTitle')}</h4>
                                                <p className="mt-1 text-xs text-[#94a3b8]">{t('languageDesc')}</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 max-w-lg mt-2">
                                            <button 
                                                onClick={() => setLanguage('pt-pt')} 
                                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                    language === 'pt-pt' 
                                                        ? 'border-purple-500/50 bg-purple-500/10 text-purple-100' 
                                                        : 'border-white/5 bg-black/20 text-[#94a3b8] hover:border-white/20'
                                                }`}
                                            >
                                                <span className="text-xs font-semibold">{t('languagePortuguesePT')}</span>
                                                {language === 'pt-pt' && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
                                            </button>
                                            <button 
                                                onClick={() => setLanguage('pt-br')} 
                                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                    language === 'pt-br' 
                                                        ? 'border-purple-500/50 bg-purple-500/10 text-purple-100' 
                                                        : 'border-white/5 bg-black/20 text-[#94a3b8] hover:border-white/20'
                                                }`}
                                            >
                                                <span className="text-xs font-semibold">{t('languagePortugueseBR')}</span>
                                                {language === 'pt-br' && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
                                            </button>
                                            <button 
                                                onClick={() => setLanguage('en')} 
                                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                    language === 'en' 
                                                        ? 'border-purple-500/50 bg-purple-500/10 text-purple-100' 
                                                        : 'border-white/5 bg-black/20 text-[#94a3b8] hover:border-white/20'
                                                }`}
                                            >
                                                <span className="text-xs font-semibold">{t('languageEnglish')}</span>
                                                {language === 'en' && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </section>
                                    )}

                                    {activeSection === 'ai' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={Cpu}
                                    title="Inteligências"
                                    description="Escolhe fornecedores, modelos, permissões e chaves cifradas localmente."
                                />

                                <div className="space-y-4">
                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <Cpu className="w-4 h-4 text-purple-400" />
                                                <span className="text-sm font-medium text-[#e2e8f0]">Fornecedor primário</span>
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
                                                    placeholder={activeProvider.defaultEndpoint || 'usar endpoint padrão do fornecedor'}
                                                />
                                            </label>
                                            <label className="space-y-1">
                                                <span className="text-[10px] text-[#94a3b8] uppercase tracking-widest">Modelo</span>
                                                <input
                                                    value={activeProviderConfig.model}
                                                    onChange={(e) => persistProviderConfig(selectedProvider, { model: e.target.value, enabled: true })}
                                                    className="w-full bg-[#0b1120] text-xs text-white border border-white/10 rounded-lg px-3 py-2 outline-none focus:border-purple-500/50"
                                                    placeholder="nome exato do modelo no fornecedor"
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
                                            Fornecedores cloud só devem receber memórias quando esta permissão permitir. A política de falha define se erros de IA permitem guardar a memória sem enriquecimento.
                                        </p>
                                    </div>
                                </div>
                            </section>
                                    )}

                                    {activeSection === 'integrations' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={Download}
                                    title="Integrações & Servidor MCP"
                                    description="Expande o Mnemosyne com Protocolo MCP para Claude, Cursor AI, APIs REST e descarrega a app desktop."
                                />
                                <div className="space-y-6">
                                    <McpIntegrationPanel />
                                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-[#e2e8f0]">Windows Explorer Context Menu</span>
                                        </div>
                                        <button
                                            onClick={() => openExternalDownload(DESKTOP_APP_DOWNLOAD_URL)}
                                            className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-medium transition-colors text-white"
                                        >
                                            Descarregar app desktop
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium text-[#e2e8f0]">Plano atual</span>
                                        </div>
                                        <button 
                                            onClick={() => setPlanosOpen(true)}
                                            className="px-3 py-1 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 rounded-lg text-xs font-medium transition-colors">
                                            Gratuito ativo
                                        </button>
                                    </div>

                                    <div className="flex flex-col gap-4 p-5 bg-white/5 rounded-2xl border border-white/5 backdrop-blur-md relative overflow-hidden">
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                            <div className="flex items-start gap-4 min-w-0">
                                                <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shrink-0">
                                                    <Folder className="w-4 h-4 text-purple-300 animate-pulse" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-bold text-[#e2e8f0]">
                                                        {t('localFolderAssimilation')}
                                                    </p>
                                                    <p className="text-xs text-[#94a3b8] mt-1">
                                                        {t('localFolderAssimilationDesc')}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="shrink-0">
                                                <input
                                                    type="file"
                                                    ref={settingsFolderInputRef}
                                                    className="hidden"
                                                    onChange={handleFolderChange}
                                                    {...{ webkitdirectory: "", directory: "", multiple: true }}
                                                />
                                                <button
                                                    onClick={triggerFolderImport}
                                                    disabled={isImportingFolder}
                                                    className="w-full sm:w-auto flex items-center justify-center gap-2 py-2 px-4 rounded-xl border border-purple-500/20 bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs font-bold uppercase tracking-widest text-purple-100 hover:scale-[1.02]"
                                                >
                                                    <UploadCloud className="w-4 h-4" />
                                                    {t('selectFolder')}
                                                </button>
                                            </div>
                                        </div>

                                        {isImportingFolder && (
                                            <div className="mt-3 flex items-center gap-3 p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 backdrop-blur-sm animate-pulse">
                                                <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin shrink-0" />
                                                <span className="text-xs text-cyan-200 font-medium">
                                                    {t('folderImporting')}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </section>
                                    )}

                                    {activeSection === 'privacy' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={Shield}
                                    title="Privacidade"
                                    description="Controla o que sai da tua sessão e mantém o conhecimento sob a tua chave."
                                />

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                        <div className="flex items-center gap-3">
                                            <Shield className="w-4 h-4 text-green-400" />
                                            <span className="text-sm font-medium text-green-400">Zero-Knowledge ativo</span>
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.06] p-4 space-y-3">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/15 p-2">
                                                <Lock className="h-4 w-4 text-cyan-200" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-semibold text-white">PIN local opcional</p>
                                                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                                                    Após idle lock, reabre a sessão com um PIN em vez das 12 palavras.
                                                    O PIN fica só neste dispositivo; a mnemónica é cifrada com AES-GCM.
                                                </p>
                                                <p className="mt-2 text-[11px] text-cyan-100/70">
                                                    Estado: {pinEnabled ? 'ativo neste dispositivo' : 'desligado'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <input
                                                type="password"
                                                inputMode="numeric"
                                                autoComplete="off"
                                                value={pinInput}
                                                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 12))}
                                                placeholder={pinEnabled ? 'PIN atual' : 'Novo PIN (4–12 dígitos)'}
                                                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40"
                                            />
                                            {!pinEnabled && (
                                                <input
                                                    type="password"
                                                    inputMode="numeric"
                                                    autoComplete="off"
                                                    value={pinConfirm}
                                                    onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 12))}
                                                    placeholder="Confirmar PIN"
                                                    className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40"
                                                />
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {!pinEnabled ? (
                                                <button
                                                    type="button"
                                                    disabled={pinBusy || !mnemonic}
                                                    onClick={async () => {
                                                        if (!mnemonic) {
                                                            toast.error('Desbloqueia a sessão com a mnemónica primeiro.');
                                                            return;
                                                        }
                                                        setPinBusy(true);
                                                        try {
                                                            await enableLocalPin(pinInput, pinConfirm, mnemonic);
                                                            setPinEnabled(true);
                                                            setPinInput('');
                                                            setPinConfirm('');
                                                            toast.success('PIN local ativado.');
                                                        } catch (error) {
                                                            toast.error(getErrorMessage(error, 'Não foi possível ativar o PIN.'));
                                                        } finally {
                                                            setPinBusy(false);
                                                        }
                                                    }}
                                                    className="rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-40"
                                                >
                                                    {pinBusy ? 'A ativar…' : 'Ativar PIN'}
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    disabled={pinBusy}
                                                    onClick={async () => {
                                                        setPinBusy(true);
                                                        try {
                                                            await disableLocalPin(pinInput);
                                                            setPinEnabled(false);
                                                            setPinInput('');
                                                            toast.success('PIN local desativado.');
                                                        } catch (error) {
                                                            toast.error(getErrorMessage(error, 'PIN incorreto.'));
                                                        } finally {
                                                            setPinBusy(false);
                                                        }
                                                    }}
                                                    className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:opacity-40"
                                                >
                                                    {pinBusy ? 'A desativar…' : 'Desativar PIN'}
                                                </button>
                                            )}
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

                                    <div className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="rounded-xl border border-violet-400/25 bg-violet-500/15 p-2">
                                                <Compass className="h-4 w-4 text-violet-200" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-semibold text-white">Tour guiado</p>
                                                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                                                    Volta a ver o onboarding de ~30s (Flow, grafo, Ctrl+K, Universo, Comms).
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        resetOnboarding();
                                                        onReplayOnboarding?.();
                                                        onClose();
                                                    }}
                                                    className="mt-3 inline-flex items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/15 px-4 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-500/25"
                                                >
                                                    <RotateCcw className="h-3.5 w-3.5" />
                                                    Repetir onboarding
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>
                                    )}

                                    {activeSection === 'account' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={AlertTriangle}
                                    title="Conta"
                                    description="Área reservada para ações permanentes. Confirma tudo com calma antes de avançar."
                                />
                                
                                <div className="p-5 bg-red-500/[0.03] rounded-2xl border border-red-500/10">
                                    <button
                                        onClick={handleDeleteAccount}
                                        className="w-full py-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-sm hover:bg-red-500/20 hover:shadow-[0_0_20px_rgba(239,68,68,0.2)] transition-all hover:scale-[1.01]"
                                    >
                                        Eliminar conta permanentemente
                                    </button>
                                </div>
                            </section>
                                    )}

                                </div>
                            </div>
                        </div>
                    </motion.div>
                    
                    <PlansModal isOpen={planosOpen} onClose={() => setPlanosOpen(false)} />
                </div>
            )}
        </AnimatePresence>
    );
};
