import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { deriveAesKeyFromMnemonic } from '../utils/crypto';
import { auth } from '../firebase';
import { ACCOUNT_DELETION_ENABLED, PERSONAL_REVISION_WRITES_ENABLED } from '../config/releaseGates';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Brain, Key, Eye, EyeOff, Shield, AlertTriangle, Cpu, RotateCcw, Smartphone, QrCode, Copy, UploadCloud, Download, Globe, Folder, Compass, Lock, Search, Crosshair, Keyboard, Users, type LucideIcon } from 'lucide-react';
import {
    disableLocalPin,
    enableLocalPin,
    isLocalPinEnabled,
} from '../utils/localPin';
import {
    clearWebAuthnCredential,
    isWebAuthnAvailable,
    readWebAuthnCredentialId,
    registerWebAuthnGate,
} from '../utils/webauthnVault';
import toast from 'react-hot-toast';
import { resetOnboarding } from './OnboardingTour';
import { PlansModal } from './PlanosModal';
import { SyncConflictPanel } from './SyncConflictPanel';
import { LocalMemoryActivityPanel } from './LocalMemoryActivityPanel';
import { SyncRecoveryActions } from './SyncRecoveryActions';
import { syncOutboxMessage } from '../services/mobileSyncMessages';
import { McpIntegrationPanel } from './McpIntegrationPanel';
import { ApiKeysPanel } from './ApiKeysPanel';
import { TeamSettings } from './TeamSettings';
import { CommsIdentityBackupPanel } from './CommsIdentityBackupPanel';
import { AiModelPicker } from './AiModelPicker';
import {EmailVerificationPanel} from './EmailVerificationPanel';
import { EmbeddingReindexPanel } from './EmbeddingReindexPanel';
import { EmbeddingPublicationPanel } from './EmbeddingPublicationPanel';
import { importFolderMemories } from '../services/folderMemoryImport';
import {looksLikeObsidianVault} from '../services/obsidianVaultImport';
import { isTauriRuntime, selectAndReadTauriDirectory } from '../utils/tauriFolderImporter';
import { formatCaptureHotkeyLabel } from '../utils/desktopCapture';
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
import { useSyncFeedback } from '../hooks/useSyncFeedback';
import {personalMigrationWritesEnabled} from '../services/personalMigrationRecovery';
import {hasPendingMemoryEdit} from '../services/memoryEditRecovery';
import {removePersonalMemoriesForIdentityReset, PersonalIdentityResetError, type IdentityResetProgress} from '../services/personalIdentityReset';
import { useTranslation } from '../utils/translations';
import { listUniverseThemes } from '../engines/universeThemes';
import { DESKTOP_APP_DOWNLOAD_URL, MOBILE_APP_DOWNLOAD_URL, openExternalDownload } from '../config/downloads';
import {
    MemoryCryptoLockedError,
    MemoryMigrationCancelledError,
    migrateLegacyMemoriesToEncrypted,
    type MemoryMigrationProgress,
} from '../services/memoryCrypto';
import {
    AI_PROVIDERS,
    isAiProviderEnabled,
    clearProviderSecret,
    getLocalAiConfig,
    hasProviderSecret,
    saveLocalAiConfig,
    saveProviderSecret,
    type AiProviderId,
    type AiProviderConfig,
    type LocalAiConfig,
} from '../services/localAiConfig';

type SettingsSectionId = 'identity' | 'mobile' | 'universe' | 'ai' | 'integrations' | 'capture' | 'privacy' | 'teams' | 'account';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    mnemonic: string[] | null;
    onResetKey: () => void;
    sessions?: readonly SessionData[];
    onReplayOnboarding?: () => void;
    onOpenExport?: () => void;
    /** Secção inicial (ex: 'privacy', 'ai') — deep-link da Command Palette */
    initialSection?: SettingsSectionId | string | null;
}

const SETTINGS_SECTION_KEY = 'mnemosyne.settings.section.v1';

const SETTINGS_SEARCH_INDEX: Record<SettingsSectionId, string[]> = {
    identity: ['chave', 'mnemónica', 'mnemonic', 'uid', 'identidade', 'seed', 'backup'],
    mobile: ['android', 'qr', 'sync', 'mobile', 'dispositivo', 'pairing', 'telefone'],
    universe: ['universo', 'galáxia', 'tema visual', '3d', 'nebulosa', 'void'],
    ai: ['ia', 'ai', 'ollama', 'openai', 'openrouter', 'gemma', 'gratuito', 'modelo', 'llm', 'nvidia', 'gemini', 'anthropic', 'mistral', 'permissões'],
    integrations: ['importar', 'pasta', 'download', 'desktop', 'app', 'integrar', 'ficheiros'],
    capture: ['captura', 'clipper', 'atalho', 'hotkey', 'extensão', 'chrome', 'edge', 'clip', 'api', 'keys', 'mcp', 'bearer'],
    privacy: ['pin', 'privacidade', 'zero-knowledge', 'partilha', 'onboarding', 'segurança', 'idle', 'cifrar', 'encriptar', 'e2ee'],
    teams: ['equipa', 'equipas', 'team', 'teams', 'convite', 'membros', 'e2ee', 'teamkey', 'colaborar'],
    account: ['conta', 'apagar', 'eliminar', 'danger', 'delete'],
};

const isSettingsSection = (value: string | null | undefined): value is SettingsSectionId =>
    Boolean(value && value in SETTINGS_SEARCH_INDEX);

const universeThemes = listUniverseThemes();

interface SettingsTab {
    id: SettingsSectionId;
    label: string;
    description: string;
    icon: LucideIcon;
}



const btnPrimary =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40';
const btnSecondary =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-transparent px-3.5 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40';
const btnDanger =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40';
const cardClass = 'rounded-xl border border-white/[0.08] bg-white/[0.03] p-4';
const inputClass =
    'w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/25';
const fieldLabelClass = 'mb-1.5 block text-xs font-medium text-slate-400';

const SectionHeader: React.FC<{
    icon: LucideIcon;
    title: string;
    description: string;
}> = ({ icon: Icon, title, description }) => (
    <div className="flex items-start gap-3 border-b border-white/[0.08] pb-4">
        <div className="mt-0.5 rounded-lg border border-white/10 bg-white/[0.04] p-2">
            <Icon className="h-4 w-4 text-slate-300" aria-hidden />
        </div>
        <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-white">{title}</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
        </div>
    </div>
);

const SETTINGS_FOCUSABLE =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const collectFocusable = (root: HTMLElement | null): HTMLElement[] => {
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(SETTINGS_FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
    );
};

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
    onOpenExport,
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
        { id: 'capture', label: t('tabCapture'), description: t('tabCaptureDesc'), icon: Crosshair },
        { id: 'privacy', label: t('tabPrivacy'), description: t('tabPrivacyDesc'), icon: Shield },
        { id: 'teams', label: t('tabTeams'), description: t('tabTeamsDesc'), icon: Users },
        { id: 'account', label: t('tabAccount'), description: t('tabAccountDesc'), icon: AlertTriangle },
    ];

    const [showMnemonic, setShowMnemonic] = useState(false);
    const [identityResetBusy, setIdentityResetBusy] = useState(false);
    const [identityResetProgress, setIdentityResetProgress] = useState<IdentityResetProgress | null>(null);
    const identityResetBusyRef = useRef(false);
    const [shareEnabled, setShareEnabled] = useState(false);
    const [pinEnabled, setPinEnabled] = useState(() => isLocalPinEnabled());
    const [webauthnEnabled, setWebauthnEnabled] = useState(() => Boolean(readWebAuthnCredentialId()));
    const [pinInput, setPinInput] = useState('');
    const [pinConfirm, setPinConfirm] = useState('');
    const [pinBusy, setPinBusy] = useState(false);
    const [encMigrating, setEncMigrating] = useState(false);
    const [encMigration, setEncMigration] = useState<MemoryMigrationProgress | null>(null);
    const [encMigrationOutcome, setEncMigrationOutcome] = useState<'completed' | 'stopped' | 'failed' | null>(null);
    const migrationAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!isOpen) migrationAbortRef.current?.abort();
    }, [isOpen]);
    const [confirmDialog, setConfirmDialog] = useState<{
        title: string;
        message: string;
        confirmLabel?: string;
        danger?: boolean;
        requirePhrase?: string;
        resolve: (ok: boolean) => void;
    } | null>(null);
    const [confirmPhrase, setConfirmPhrase] = useState('');
    const confirmResolveRef = useRef<((ok: boolean) => void) | null>(null);
    useEffect(() => {
        if (!isOpen) {
            confirmResolveRef.current?.(false);confirmResolveRef.current=null;
            setConfirmDialog(null);setConfirmPhrase('');
        }
    }, [isOpen]);
    useEffect(() => () => {confirmResolveRef.current?.(false);confirmResolveRef.current=null;}, []);
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
    const [trustedDeviceRows, setTrustedDevices] = useState<TrustedDevice[]>([]);
    const [trustedDeviceView,setTrustedDeviceView]=useState<{uid:string|null;status:'loading'|'ready'|'unavailable'}>({uid:null,status:'loading'});
    const trustedDevices=trustedDeviceView.uid===auth.currentUser?.uid&&trustedDeviceView.status==='ready'?trustedDeviceRows:[];
    const [isCreatingPairing, setIsCreatingPairing] = useState(false);
    const [pairingError, setPairingError] = useState<string | null>(null);
    const [syncingDeviceId, setSyncingDeviceId] = useState<string | null>(null);
    const [mobileSyncMessage, setMobileSyncMessage] = useState<string | null>(null);
    const pairingCreationRef = useRef<object | null>(null);
    const trustedPairingIdRef = useRef<string | null>(null);
    const mnemonicPanelRef = useRef<HTMLDivElement | null>(null);
    const settingsFolderInputRef = useRef<HTMLInputElement | null>(null);
    const folderActorRef = useRef<{uid:string;current:()=>boolean}|null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const contentScrollRef = useRef<HTMLDivElement | null>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    const accountEmailOpen = useRef(isOpen); accountEmailOpen.current = isOpen;
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const syncFeedback = useSyncFeedback(isOpen);
    const capturePairing=syncFeedback.capture;
    const captureDeviceAccount=syncFeedback.captureAccount;
    useEffect(()=>{migrationAbortRef.current?.abort();setEncMigrating(false);setEncMigrationOutcome(null);setEncMigration(null);},[syncFeedback.epoch]);
    useEffect(() => {pairingCreationRef.current=null;trustedPairingIdRef.current=null;setIsCreatingPairing(false);setPairingInvite(null);setPairingRecord(null);setSyncingDeviceId(null);setMobileSyncMessage(null);setPairingError(null);},[syncFeedback.epoch,isOpen]);
    const [isImportingFolder, setIsImportingFolder] = useState(false);
    const universeType = useUniverseStore((state) => state.universeType);
    const setGlobalUniverseType = useUniverseStore((state) => state.setUniverseType);
    const selectedUniverseTheme = universeThemes.find((theme) => theme.id === universeType) || universeThemes[0];
    const langIsEn = language === 'en' || language === 'fr';
    const selectedProvider = localAiConfig.primaryProvider;
    const activeProvider = AI_PROVIDERS.find((provider) => provider.id === selectedProvider) || AI_PROVIDERS[0];
    const activeProviderConfig = localAiConfig.providers[selectedProvider];
    const trustedActiveCount = trustedDevices.filter((device) => device.status === 'active').length;
    const activeTab = tabs.find((tab) => tab.id === activeSection) || tabs[0];
    const ActiveTabIcon = activeTab.icon;
    const activeProviderBadge = activeProvider.label.replace(' Local', '').replace(' Backend', '') +
        (isAiProviderEnabled(selectedProvider) ? '' : ` · ${t('settingsAiProviderUnavailable')}`);
    const tabBadges: Record<SettingsSectionId, string> = {
        identity: aesKeyReady ? 'AES' : t('badgeIdentityLocked'),
        mobile: trustedActiveCount > 0 
            ? `${trustedActiveCount} ${t('badgeMobileActive')}` 
            : `0 ${t('badgeMobilePairs')}`,
        universe: langIsEn ? selectedUniverseTheme.labelEn : selectedUniverseTheme.labelPt,
        ai: activeProviderBadge,
        integrations: t('badgeIntegrationsFree'),
        capture: formatCaptureHotkeyLabel(),
        privacy: shareEnabled ? t('badgePrivacySharing') : t('badgePrivacyPrivate'),
        teams: 'Read only',
        account: t('badgeAccountCritical'),
    };
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

    useEffect(() => {
        if (!isOpen) return;
        contentScrollRef.current?.scrollTo({ top: 0 });
    }, [isOpen, activeSection]);

    useEffect(() => {
        if (!isOpen) return;
        previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const frame = requestAnimationFrame(() => {
            const search = dialogRef.current?.querySelector<HTMLElement>('input[type="search"]');
            (search || dialogRef.current)?.focus();
        });
        return () => {
            cancelAnimationFrame(frame);
            previouslyFocusedRef.current?.focus?.();
        };
    }, [isOpen]);

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
                    hasSecret: hasProviderSecret(user.uid, provider.id),
                };
            }
            return { ...current, providers };
        });
    }, [isOpen]);

    useEffect(() => {
        const user = auth.currentUser;
        if (!isOpen || !user) {
            setTrustedDevices([]);
            setTrustedDeviceView({uid:null,status:'loading'});
            return;
        }
        let live=true;const captured=captureDeviceAccount(user.uid),current=()=>live&&accountEmailOpen.current&&captured();setTrustedDeviceView({uid:user.uid,status:'loading'});
        const stop=watchTrustedDevices(user.uid,devices=>{if(current()){setTrustedDevices(devices);setTrustedDeviceView({uid:user.uid,status:'ready'});}},()=>{if(current())setTrustedDeviceView({uid:user.uid,status:'unavailable'});});
        return()=>{live=false;stop();};
    }, [isOpen,syncFeedback.epoch,captureDeviceAccount]);

    const confirmPairing = useCallback(async(record:MobilePairingRecord,external:()=>void=()=>{})=>{
        const user=auth.currentUser;if(!user||record.ownerUid!==user.uid||trustedPairingIdRef.current===record.pairingId)return;
        const captured=capturePairing(user.uid),current=()=>{try{external();return accountEmailOpen.current&&captured();}catch{return false;}};
        const guard=()=>{if(!current())throw Error('Vista retirada.');};if(!current())return;trustedPairingIdRef.current=record.pairingId;
        try{const identity=await getOrCreateDesktopSyncIdentity(user.uid,mnemonic,guard);guard();await trustAcceptedMobilePairing(user.uid,record,identity.publicKeyJwk,guard);guard();setPairingInvite(null);setPairingRecord(null);setPairingError(null);}
        catch{if(current()){trustedPairingIdRef.current=null;setPairingError('Não foi possível confirmar o dispositivo. O pedido cifrado foi conservado; retoma a confirmação.');}}
    },[mnemonic,capturePairing]);
    useEffect(() => {
        const user=auth.currentUser;if(!isOpen||!pairingInvite||!user){setPairingRecord(null);return;}
        let live=true;const captured=capturePairing(user.uid),current=()=>live&&accountEmailOpen.current&&captured(),guard=()=>{if(!current())throw Error('Vista retirada.');};
        const stop=watchMobilePairingInvite(pairingInvite.pairingId,record=>{if(!current())return;setPairingRecord(record);if(record&&['accepted','trusted'].includes(record.status))void confirmPairing(record,guard);},()=>{if(current())setPairingError('Não foi possível atualizar o estado do convite. A chave e o pedido foram conservados.');});
        return()=>{live=false;stop();};
    },[isOpen,pairingInvite,syncFeedback.epoch,capturePairing,confirmPairing]);

    const askConfirm = (opts: {
        title: string;
        message: string;
        confirmLabel?: string;
        danger?: boolean;
        requirePhrase?: string;
    }): Promise<boolean> => {
        setConfirmPhrase('');
        return new Promise((resolve) => {
            confirmResolveRef.current?.(false);
            confirmResolveRef.current=resolve;
            setConfirmDialog({ ...opts, resolve });
        });
    };

    const closeConfirm = (ok: boolean) => {
        if (!confirmDialog) return;
        if (ok && confirmDialog.requirePhrase && confirmPhrase !== confirmDialog.requirePhrase) {
            toast.error(`Escreve "${confirmDialog.requirePhrase}" para confirmar.`);
            return;
        }
        confirmResolveRef.current=null;confirmDialog.resolve(ok);
        setConfirmDialog(null);
        setConfirmPhrase('');
    };

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (confirmDialog) {
                    closeConfirm(false);
                } else {
                    onClose();
                }
                return;
            }
            if (event.key === 'Tab') {
                const trapRoot = confirmDialog
                    ? overlayRef.current?.querySelector<HTMLElement>('[aria-labelledby="settings-confirm-title"]')
                    : dialogRef.current;
                const items = collectFocusable(trapRoot ?? null);
                if (items.length === 0) return;
                const first = items[0];
                const last = items[items.length - 1];
                const active = document.activeElement;
                if (event.shiftKey && active === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && active === last) {
                    event.preventDefault();
                    first.focus();
                } else if (trapRoot && active instanceof Node && !trapRoot.contains(active)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                }
                return;
            }
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
            const idx = Number(event.key) - 1;
            if (idx >= 0 && idx < tabs.length) {
                event.preventDefault();
                selectSection(tabs[idx].id);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, tabs, confirmDialog, onClose]);

    const handleMigrateLegacyMemories = async () => {
        const user = auth.currentUser;
        if (!user) {
            toast.error('Inicia sessão primeiro.');
            return;
        }
        const current=syncFeedback.capture(user.uid);
        if(!current()||!personalMigrationWritesEnabled())return;
        if (!mnemonic || mnemonic.length !== 12) {
            toast.error('Desbloqueia a mnemónica de 12 palavras antes de cifrar memórias antigas.');
            return;
        }
        const confirmed = await askConfirm({
            title: 'Cifrar memórias antigas',
            message: 'O texto e título de memórias pessoais antigas e das suas versões históricas serão cifrados com a mnemónica atualmente desbloqueada. Confirma que é a frase correta desta conta e que tens um export Firestore recuperável antes de continuar. Uma frase errada pode tornar os dados ilegíveis.',
            confirmLabel: 'Cifrar memórias',
            danger: true,
        });
        if (!confirmed||!current()) return;
        setEncMigrating(true);
        setEncMigration({ total: 0, migrated: 0, skipped: 0, failed: 0 });
        setEncMigrationOutcome(null);
        const controller = new AbortController();
        migrationAbortRef.current = controller;
        try {
            const result = await migrateLegacyMemoriesToEncrypted(user.uid,progress=>{if(current())setEncMigration(progress);}, {
                signal: controller.signal,
            });
            if(!current())return;
            const summary = result.total === 0
                ? 'Não há memórias nem versões pessoais elegíveis em texto claro para cifrar.'
                : `Cifrados ${result.migrated} registos. ${result.skipped} ignorados ou alterados entretanto. ${result.failed} falha(s).`;
            if (result.failed > 0) toast.error(summary);
            else toast.success(summary);
            setEncMigrationOutcome(result.failed > 0 ? 'failed' : 'completed');
        } catch (error) {
            if(!current())return;
            if (error instanceof MemoryCryptoLockedError) {
                toast.error(error.message);
                setEncMigrationOutcome('failed');
            } else if (error instanceof MemoryMigrationCancelledError) {
                toast(error.message);
                setEncMigrationOutcome('stopped');
            } else {
                toast.error('Não foi possível confirmar a migração. Recupera o pedido pendente antes de repetir.');
                setEncMigrationOutcome('failed');
            }
        } finally {
            if(migrationAbortRef.current===controller)migrationAbortRef.current = null;
            if(current())setEncMigrating(false);
        }
    };

    const handleResetIdentity = async (removeMemories: boolean) => {
        const uid=auth.currentUser?.uid;
        if(!uid||identityResetBusyRef.current||removeMemories&&!PERSONAL_REVISION_WRITES_ENABLED)return;
        const current=removeMemories?syncFeedback.capture(uid):syncFeedback.captureAccount(uid);
        const guard=()=>{if(!current())throw Error('Vista retirada.');};
        if(!current())return;
        identityResetBusyRef.current=true;setIdentityResetBusy(true);setIdentityResetProgress(null);
        try {
            if(hasPendingMemoryEdit(uid)){
                toast.error('Confirma ou cancela a alteração de memória pendente antes de reiniciar a chave.');return;
            }
            if(removeMemories){
                const result=await removePersonalMemoriesForIdentityReset({uid,assertCurrent:guard,
                    confirm:count=>askConfirm({title:'Remover memórias pessoais e reiniciar',
                        message:`Serão removidas da vista ${count} memórias pessoais classificadas. O histórico cifrado, os ficheiros, as memórias de equipa e eventuais registos por classificar permanecem. Guarda as 12 palavras atuais para aceder aos dados antigos. Uma interrupção conserva a chave e as remoções já confirmadas.`,
                        confirmLabel:'Remover e reiniciar',danger:true}),
                    progress:value=>{if(current())setIdentityResetProgress(value);},
                });
                guard();if(result.status!=='completed')return;
            }else{
                const confirmed=await askConfirm({title:'Reiniciar chave neste dispositivo',
                    message:'As memórias permanecem guardadas e exigem as 12 palavras atuais para serem abertas. Conserva esse backup, incluindo para histórico e outros dispositivos. Pretendes trocar a chave local?',
                    confirmLabel:'Reiniciar chave',danger:true});
                guard();if(!confirmed)return;
            }
            guard();if(hasPendingMemoryEdit(uid))throw Error('Alteração de memória pendente.');
            onResetKey();onClose();
        } catch(error:unknown) {
            if(current())toast.error(error instanceof PersonalIdentityResetError
                ? `${error.removed} remoções confirmadas. A operação foi interrompida e a chave foi conservada. Verifica os pedidos pendentes antes de repetir.`
                : 'Não foi possível concluir o reinício. A chave atual foi conservada.');
        } finally {
            identityResetBusyRef.current=false;setIdentityResetBusy(false);
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
            toast.success('API key guardada no cofre local cifrado.');
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Não foi possível guardar a API key.'));
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
        if (!user||pairingCreationRef.current) return;
        if (!mnemonic || mnemonic.length !== 12) {
            setPairingError('Desbloqueia primeiro a mnemónica para criar um convite de emparelhamento.');
            return;
        }

        const captured=syncFeedback.capture(user.uid),current=()=>accountEmailOpen.current&&captured(),guard=()=>{if(!current())throw Error('Vista retirada.');};if(!current())return;
        const token={};pairingCreationRef.current=token;setIsCreatingPairing(true);
        setPairingError(null);
        try {
            const invite = await createMobilePairingInvite(user.uid,undefined,guard);guard();
            trustedPairingIdRef.current = null;
            setPairingInvite({
                pairingId: invite.pairingId,
                pairingUri: invite.pairingUri,
                qrDataUrl: invite.qrDataUrl,
                expiresAt: invite.expiresAt,
                creationDigest: invite.creationDigest,
            });
        } catch {
            if(current())setPairingError('Não foi possível confirmar o convite. A chave e o pedido cifrados foram conservados; volta a criar/retomar o QR.');
        } finally {
            if(pairingCreationRef.current===token){pairingCreationRef.current=null;if(current())setIsCreatingPairing(false);}
        }
    };

    const handleCancelMobilePairing = async () => {
        const user=auth.currentUser;if (!pairingInvite||!user) return;
        const captured=syncFeedback.capture(user.uid),current=()=>accountEmailOpen.current&&captured(),guard=()=>{if(!current())throw Error('Vista retirada.');};if(!current())return;
        try {
            await cancelMobilePairingInvite(pairingInvite.pairingId,guard);guard();
            trustedPairingIdRef.current = null;
            setPairingInvite(null);
            setPairingRecord(null);
        } catch {if(current())setPairingError('O cancelamento ainda não foi confirmado. O pedido e a chave foram conservados. Se o dispositivo já estiver ativo, revoga-o na lista.');}
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
        const uid=auth.currentUser?.uid;if(!uid)return;const captured=syncFeedback.captureAccount(uid),current=()=>accountEmailOpen.current&&captured(),guard=()=>{if(!current())throw Error('Vista retirada.');};if(!current())return;
        const confirmed = await askConfirm({
            title: 'Revogar dispositivo',
            message: 'Este dispositivo deixará de aparecer como confiável.',
            confirmLabel: 'Revogar',
            danger: true,
        });
        if (!confirmed||!current()) return;
        try {
            await revokeTrustedDevice(deviceId,guard);
        } catch {
            if(current())setPairingError('Não foi possível confirmar a revogação. Atualiza a lista e repete a operação.');
        }
    };

    const handleQueueMobileSnapshot = async (device: TrustedDevice) => {
        const user = auth.currentUser;
        if (!user) return;
        const feedbackCurrent = syncFeedback.capture(user.uid);
        if (!feedbackCurrent()) { setPairingError('Desbloqueia o cofre antes de enviar memórias.'); return; }
        setSyncingDeviceId(device.deviceId);
        setMobileSyncMessage(null);
        setPairingError(null);
        try {
            const result = await queueMobileMemorySnapshot(user.uid, device, sessions);
            if (feedbackCurrent()) setMobileSyncMessage(syncOutboxMessage(result));
        } catch (error) {
            if (feedbackCurrent()) setPairingError(error instanceof Error ? error.message : 'Não foi possível preparar o sync cifrado.');
        } finally {
            if (feedbackCurrent()) setSyncingDeviceId(null);
        }
    };

    const handleQueueMobileDelta = async (device: TrustedDevice) => {
        const user = auth.currentUser;
        if (!user) return;
        const feedbackCurrent = syncFeedback.capture(user.uid);
        if (!feedbackCurrent()) { setPairingError('Desbloqueia o cofre antes de enviar memórias.'); return; }
        setSyncingDeviceId(device.deviceId);
        setMobileSyncMessage(null);
        setPairingError(null);
        try {
            const result = await queueDesktopMemoryDelta(user.uid, device, sessions);
            if (feedbackCurrent()) setMobileSyncMessage(syncOutboxMessage(result));
        } catch (error) {
            if (feedbackCurrent()) setPairingError(error instanceof Error ? error.message : 'Não foi possível preparar o delta cifrado.');
        } finally {
            if (feedbackCurrent()) setSyncingDeviceId(null);
        }
    };

    const handleImportMobileDelta = async (device: TrustedDevice) => {
        const user = auth.currentUser;
        if (!user) return;
        const feedbackCurrent = syncFeedback.capture(user.uid);
        if (!feedbackCurrent()) {setPairingError('Desbloqueia o cofre antes de importar memórias.');return;}
        setSyncingDeviceId(device.deviceId);
        setMobileSyncMessage(null);
        setPairingError(null);
        try {
            const desktopSyncIdentity = await getOrCreateDesktopSyncIdentity(user.uid, mnemonic,()=>{if(!feedbackCurrent())throw Error('Vista retirada.');});
            if (!feedbackCurrent()) return;
            const result = await importQueuedDesktopSyncEnvelopes(
                user.uid,
                device.deviceId,
                desktopSyncIdentity.privateKeyJwk
            );
            if (!feedbackCurrent()) return;
            setMobileSyncMessage(`${result.importedMemories} memórias recebidas de ${device.name}; ${result.conflicts} conflito(s).`);
        } catch (error) {
            if (feedbackCurrent()) setPairingError(error instanceof Error ? error.message : 'Não foi possível receber deltas mobile.');
        } finally {
            if (feedbackCurrent()) setSyncingDeviceId(null);
        }
    };

    const handleCleanupMobileSync = async () => {
        const user = auth.currentUser;
        if (!user) return;
        const confirmed = await askConfirm({
            title: 'Limpar artefactos de sync',
            message: 'Limpar envelopes consumidos/falhados e tombstones com mais de 30 dias?',
            confirmLabel: 'Limpar',
        });
        if (!confirmed) return;
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
        if (!ACCOUNT_DELETION_ENABLED) { toast.error('A eliminação automática está em validação. Usa a página de eliminação para contactar o suporte.'); return; }
        const confirmedUid = auth.currentUser?.uid;
        if (!confirmedUid) { toast.error('Inicia sessão para eliminar a conta.'); return; }
        const typed = await askConfirm({
            title: 'Eliminar mente digital',
            message: 'Vais iniciar a eliminação da tua conta e dos seus dados ativos. Escreve ELIMINAR para confirmar.',
            confirmLabel: 'Eliminar',
            danger: true,
            requirePhrase: 'ELIMINAR',
        });
        if (!typed) return;

        const last = await askConfirm({
            title: 'Última confirmação',
            message: 'Serão eliminados os teus dados ativos, anexos e equipas de que és dono, incluindo os dados guardados nessas equipas por outros membros. Os ficheiros que enviaste para equipas de outros donos também serão retirados das memórias e do histórico que os usam; o restante conteúdo desses membros será preservado. Cópias já descarregadas e backups seguem a política de retenção. Continuar?',
            confirmLabel: 'Eliminar conta',
            danger: true,
        });
        if (!last) return;

        try {
            if (auth.currentUser?.uid !== confirmedUid) throw new Error('A conta mudou durante a confirmação.');
            const { requestAccountDeletion } = await import('../services/accountDeletion');
            const result = await requestAccountDeletion(confirmedUid, 'start');
            if (result.status === 'pending') {
                toast('Eliminação em curso. Podes retomar o pedido na página de eliminação.');
                window.location.href = '/account-deletion'; return;
            }

            const { signOut } = await import('firebase/auth');
            if (auth.currentUser?.uid !== confirmedUid) throw new Error('A conta mudou durante a eliminação.');
            await signOut(auth);

            toast.success('Mente digital eliminada. A regressar ao vazio.');
            window.location.href = '/';
        } catch (error: unknown) {
            toast.error(`Não foi possível concluir a eliminação: ${getErrorMessage(error, 'Erro desconhecido')}. Podes retomar na página de eliminação.`);
        }
    };

    const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const actor=folderActorRef.current;folderActorRef.current=null;
        if(!actor?.current()){e.target.value='';return;}
        const guard=()=>{if(!actor.current())throw new Error('Import context unavailable');};

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
            toast.error(t('noFilesFound'));
            if (settingsFolderInputRef.current) settingsFolderInputRef.current.value = '';
            return;
        }

        if (eligibleFiles.length > 20&&!looksLikeObsidianVault(eligibleFiles)) {
            toast(t('folderLimitWarning'), { icon: '⚠️' });
        }

        setIsImportingFolder(true);
        try {
            const result=await importFolderMemories(actor.uid,eligibleFiles,sessions,guard);
            if(actor.current())toast.success(t('foldersLearnedSuccess', { count: result.imported }));
        } catch {
            if(actor.current())toast.error('Importação não concluída. Verifica as notas e usa a recuperação de importações ou ligações antes de repetir.');
        } finally {
            setIsImportingFolder(false);
            if (settingsFolderInputRef.current) settingsFolderInputRef.current.value = '';
        }
    };

    const triggerFolderImport = async () => {
        const uid=auth.currentUser?.uid;if(!uid)return;
        const current=syncFeedback.capture(uid);if(!current())return;
        const guard=()=>{if(!current())throw new Error('Import context unavailable');};
        if (isTauriRuntime()) {
            try {
                const { open } = await import('@tauri-apps/plugin-dialog');
                guard();
                const selected = await open({
                    directory: true,
                    multiple: false,
                });
                guard();
                if (!selected) return;

                setIsImportingFolder(true);
                const importedFiles = await selectAndReadTauriDirectory(selected,guard);
                guard();

                if (importedFiles.length === 0) {
                    toast.error(t('noFilesFound'));
                    return;
                }

                if (importedFiles.length > 20&&!looksLikeObsidianVault(importedFiles)) {
                    toast(t('folderLimitWarning'), { icon: '⚠️' });
                }
                const result=await importFolderMemories(uid,importedFiles,sessions,guard);
                if(current())toast.success(t('foldersLearnedSuccess', { count: result.imported }));
            } catch {
                if(current())toast.error('Importação não concluída. Verifica as notas e usa a recuperação de importações ou ligações antes de repetir.');
            } finally {
                setIsImportingFolder(false);
            }
        } else {
            folderActorRef.current={uid,current};
            settingsFolderInputRef.current?.click();
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div
                    ref={overlayRef}
                    className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4"
                    onWheel={(event) => event.stopPropagation()}
                >
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-[#020617]/70 backdrop-blur-md"
                    />

                    <motion.div
                        ref={dialogRef}
                        initial={{ scale: 0.98, opacity: 0, y: 8 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.98, opacity: 0, y: 8 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-title"
                        tabIndex={-1}
                        className="settings-dialog relative rounded-2xl border border-white/10 bg-[#0b1220] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
                    >
                        <div className="shrink-0 border-b border-white/[0.08] px-5 py-4 sm:px-6">
                            <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <h2 id="settings-title" className="text-base font-semibold tracking-tight text-white">
                                        {t('settings')}
                                    </h2>
                                    <p className="mt-0.5 hidden truncate text-sm text-slate-400 sm:block">
                                        {t('settingsSubtitle')}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-white"
                                    aria-label={t('settingsCloseAria')}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <label className="relative mt-3 block">
                                <span className="sr-only">Procurar em definições</span>
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
                                <input
                                    type="search"
                                    value={settingsQuery}
                                    onChange={(e) => setSettingsQuery(e.target.value)}
                                    placeholder={t('settingsSearchPlaceholder')}
                                    className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-white/25"
                                />
                            </label>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                <span className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-400">
                                    {sessions.length} memórias
                                </span>
                                <span className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-400">
                                    PIN {pinEnabled ? 'ativo' : 'desligado'}
                                </span>
                                <span className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-400">
                                    IA · {activeProviderBadge}
                                </span>
                                <span className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-400">
                                    Sync · {trustedActiveCount}
                                </span>
                            </div>
                        </div>

                        <div className="settings-dialog-body">
                            <aside className="settings-sidebar border-r border-white/[0.08] bg-black/20 p-3">
                                <div className="mb-3 border-b border-white/[0.06] px-2 pb-3">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Secção</p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <ActiveTabIcon className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-white">{activeTab.label}</p>
                                            <p className="truncate text-xs text-slate-500">{tabBadges[activeTab.id]}</p>
                                        </div>
                                    </div>
                                </div>
                                <nav className="flex flex-1 flex-col gap-0.5" aria-label="Secções das definições">
                                    {visibleTabs.map((tab, index) => {
                                        const Icon = tab.icon;
                                        const active = activeSection === tab.id;
                                        const originalIndex = tabs.findIndex((t) => t.id === tab.id);
                                        return (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                aria-current={active ? 'page' : undefined}
                                                onClick={() => selectSection(tab.id)}
                                                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                                                    active
                                                        ? 'bg-white/[0.08] text-white'
                                                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                                                }`}
                                            >
                                                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-medium">{tab.label}</span>
                                                    <span className="block truncate text-[11px] text-slate-500">{tab.description}</span>
                                                </span>
                                                <span className="shrink-0 font-mono text-[10px] text-slate-600">
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

                            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                                <div className="shrink-0 border-b border-white/[0.08] px-3 py-2 lg:hidden">
                                    <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide" aria-label="Secções das definições">
                                        {visibleTabs.map((tab) => {
                                            const Icon = tab.icon;
                                            const active = activeSection === tab.id;
                                            return (
                                                <button
                                                    key={tab.id}
                                                    type="button"
                                                    aria-current={active ? 'page' : undefined}
                                                    onClick={() => selectSection(tab.id)}
                                                    className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                                                        active
                                                            ? 'border-white/20 bg-white/[0.08] text-white'
                                                            : 'border-white/8 bg-transparent text-slate-400'
                                                    }`}
                                                >
                                                    <Icon className="h-3.5 w-3.5" aria-hidden />
                                                    {tab.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div
                                    ref={contentScrollRef}
                                    className="settings-content flex-1 p-5 sm:p-6"
                                >
                                    {activeSection === 'identity' && (
                            <section className="space-y-5">
                                <SectionHeader
                                    icon={Key}
                                    title={t('settingsIdentityTitle')}
                                    description={t('settingsIdentityDesc')}
                                />
                                
                                <div className="space-y-3">
                                    <div className={cardClass}>
                                        <div className="flex items-start gap-3">
                                            <Key className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                                            <div>
                                                <p className="text-sm font-medium text-white">Chave ativa</p>
                                                <p className="mt-0.5 text-xs text-slate-400">Encriptação local AES-GCM</p>
                                                <p className={`mt-1 text-xs ${aesKeyReady ? 'text-emerald-300' : 'text-amber-300'}`}>
                                                    {aesKeyReady
                                                        ? 'Chave AES derivada da mnemónica'
                                                        : 'A aguardar mnemónica…'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className={`${cardClass} flex items-center justify-between gap-4`}>
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-white">UID do utilizador</p>
                                            <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{auth.currentUser?.uid || 'UID indisponível'}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const uid = auth.currentUser?.uid;
                                                if (uid) navigator.clipboard.writeText(uid);
                                            }}
                                            className={btnSecondary}
                                        >
                                            Copiar UID
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowMnemonic(!showMnemonic)}
                                            className={btnSecondary}
                                        >
                                            {showMnemonic ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            {showMnemonic ? 'Ocultar palavras' : 'Ver 12 palavras'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleResetIdentity(false)}
                                            disabled={identityResetBusy}
                                            className={btnDanger}
                                        >
                                            <RotateCcw className="h-4 w-4" />
                                            Reiniciar chave local
                                        </button>
                                    </div>

                                    <button type="button" onClick={() => void handleResetIdentity(true)}
                                        disabled={identityResetBusy || !PERSONAL_REVISION_WRITES_ENABLED} className={btnDanger}>
                                        Remover memórias pessoais e reiniciar
                                    </button>
                                    <p className="text-xs text-zinc-400" role="status" aria-live="polite">
                                        {identityResetBusy && identityResetProgress
                                            ? `${identityResetProgress.removed} de ${identityResetProgress.total} remoções confirmadas pelo servidor.`
                                            : !PERSONAL_REVISION_WRITES_ENABLED
                                                ? 'A remoção de memórias está em validação antes do lançamento. O reinício local conserva os dados antigos.'
                                                : 'A remoção conserva histórico cifrado e ficheiros. Guarda as palavras atuais para os dados antigos.'}
                                    </p>

                                    <CommsIdentityBackupPanel mnemonic={mnemonic} active={isOpen&&activeSection==='identity'} />

                                    {showMnemonic && mnemonic && (
                                        <motion.div
                                            ref={mnemonicPanelRef}
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.08] bg-black/30 p-3"
                                        >
                                            {mnemonic.map((word, i) => (
                                                <div key={i} className="rounded-md bg-white/[0.04] px-2 py-1.5 text-center font-mono text-xs text-slate-200">
                                                    <span className="mr-1.5 text-[10px] text-slate-500">{i + 1}</span>
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
                                    title={t('settingsMobileTitle')}
                                    description={t('settingsMobileDesc')}
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
                                            type="button"
                                            onClick={() => openExternalDownload(MOBILE_APP_DOWNLOAD_URL)}
                                            className={btnPrimary}
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
                                                type="button"
                                                onClick={handleCancelMobilePairing}
                                                className={btnDanger}
                                            >
                                                <X className="w-4 h-4" />
                                                Cancelar
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={handleCreateMobilePairing}
                                                disabled={isCreatingPairing || !aesKeyReady}
                                                className={btnPrimary}
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

                                    {pairingRecord && ['accepted','trusted'].includes(pairingRecord.status) && (
                                        <div className="rounded-xl border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-200">
                                            Resposta recebida. O dispositivo só fica confiável após confirmar o handshake e a transação no servidor.
                                            <button type="button" onClick={()=>void confirmPairing(pairingRecord)} className="mt-2 min-h-11 rounded-lg border border-white/20 px-3">Retomar confirmação</button>
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
                                                    O QR contém apenas o convite, a chave pública efémera e o identificador da conta. A chave privada e o pedido ficam cifrados pelo cofre neste dispositivo para retoma após falha ou reload.
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

                                        {trustedDeviceView.uid!==auth.currentUser?.uid||trustedDeviceView.status==='loading' ? <p className="text-xs text-slate-400">A confirmar os dispositivos no servidor...</p> : trustedDeviceView.status==='unavailable' ? <p role="alert" className="text-xs text-amber-200">A lista está indisponível. Não foi confirmado que esteja vazia; volta a abrir este painel para repetir a leitura.</p> : trustedDevices.length === 0 ? (
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
                                                            {auth.currentUser?.uid === device.ownerUid && (
                                                                <SyncRecoveryActions uid={device.ownerUid} deviceId={device.deviceId} outgoing="desktop-to-mobile" />
                                                            )}
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

                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {universeThemes.map((theme) => {
                                        const selected = universeType === theme.id;
                                        return (
                                            <button
                                                key={theme.id}
                                                type="button"
                                                onClick={() => setGlobalUniverseType(theme.id)}
                                                className={`group relative overflow-hidden rounded-2xl border p-0 text-left transition ${
                                                    selected
                                                        ? 'border-white/35 bg-white/[0.06] ring-1 ring-white/20'
                                                        : 'border-white/8 bg-black/25 hover:border-white/20 hover:bg-white/[0.04]'
                                                }`}
                                            >
                                                <div
                                                    className="relative h-20 w-full overflow-hidden"
                                                    style={{ background: theme.preview.sky }}
                                                    aria-hidden
                                                >
                                                    <div
                                                        className="absolute inset-0 opacity-80"
                                                        style={{
                                                            background: `radial-gradient(ellipse 80% 60% at 50% 55%, ${theme.preview.mid} 0%, transparent 70%)`,
                                                        }}
                                                    />
                                                    <div
                                                        className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-90"
                                                        style={{
                                                            background: `radial-gradient(circle, ${theme.preview.glow} 0%, ${theme.preview.accent} 35%, transparent 70%)`,
                                                            boxShadow: `0 0 28px ${theme.preview.accent}66`,
                                                        }}
                                                    />
                                                    {theme.backdrop.showAccretionDisk && (
                                                        <div
                                                            className="absolute left-1/2 top-1/2 h-3 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70"
                                                            style={{
                                                                background: `linear-gradient(90deg, transparent, ${theme.preview.accent}, transparent)`,
                                                                transform: 'translate(-50%, -50%) rotate(-12deg)',
                                                            }}
                                                        />
                                                    )}
                                                    <div
                                                        className="absolute right-[18%] top-[28%] h-1 w-1 rounded-full"
                                                        style={{ background: theme.preview.glow, boxShadow: `0 0 6px ${theme.preview.glow}` }}
                                                    />
                                                    <div
                                                        className="absolute bottom-[30%] left-[22%] h-0.5 w-0.5 rounded-full"
                                                        style={{ background: theme.preview.accent }}
                                                    />
                                                    <div
                                                        className="absolute right-[30%] bottom-[24%] h-0.5 w-0.5 rounded-full opacity-70"
                                                        style={{ background: theme.preview.glow }}
                                                    />
                                                </div>
                                                <div className="space-y-1 px-3.5 py-3">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-xs font-semibold text-[#f1f5f9]">
                                                            {langIsEn ? theme.labelEn : theme.labelPt}
                                                        </span>
                                                        {selected && (
                                                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: theme.preview.accent }} />
                                                        )}
                                                    </div>
                                                    <p className="text-[11px] leading-relaxed text-[#94a3b8]">
                                                        {langIsEn ? theme.blurbEn : theme.blurbPt}
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
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
                                            <button
                                                onClick={() => setLanguage('fr')}
                                                className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                                                    language === 'fr'
                                                        ? 'border-purple-500/50 bg-purple-500/10 text-purple-100'
                                                        : 'border-white/5 bg-black/20 text-[#94a3b8] hover:border-white/20'
                                                }`}
                                            >
                                                <span className="text-xs font-semibold">{t('languageFrench')}</span>
                                                {language === 'fr' && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
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
                                    title={t('settingsAiTitle')}
                                    description={t('settingsAiDesc')}
                                />

                                <EmbeddingReindexPanel key={auth.currentUser?.uid ?? 'signed-out'}
                                    uid={auth.currentUser?.uid ?? null} sessions={sessions} />
                                <EmbeddingPublicationPanel key={`publication:${auth.currentUser?.uid ?? 'signed-out'}`}
                                    uid={auth.currentUser?.uid ?? null} sessions={sessions} />

                                <div className="space-y-4">
                                    <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <Cpu className="w-4 h-4 text-purple-400" />
                                                <span className="text-sm font-medium text-[#e2e8f0]">{t('settingsAiProvider')}</span>
                                            </div>
                                        </div>

                                        <AiModelPicker
                                            selectedProvider={selectedProvider}
                                            providers={localAiConfig.providers}
                                            onSelectProvider={selectPrimaryProvider}
                                            onSelectModel={(provider, model) => persistProviderConfig(provider, { model, enabled: true })}
                                        />

                                        {!isAiProviderEnabled(selectedProvider) && (
                                            <p role="status" className="text-xs text-amber-200">{t('settingsAiProviderUnavailableHint')}</p>
                                        )}
                                        {activeProvider.kind === 'local' && <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <label className="space-y-1">
                                                <span className="text-[10px] text-[#94a3b8] uppercase tracking-widest">
                                                    Endpoint
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
                                        </div>}

                                        {(activeProvider.needsSecret || activeProviderConfig.hasSecret) && (
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
                                                {!activeProvider.needsSecret && <p className="text-[10px] text-[#94a3b8]">{t('settingsAiLegacySecretUnused')}</p>}
                                                {activeProvider.needsSecret && <div className="flex gap-2">
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
                                                </div>}
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
                                    title={t('settingsIntegrationsTitle')}
                                    description={t('settingsIntegrationsDesc')}
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
                                                    type="button"
                                                    onClick={triggerFolderImport}
                                                    disabled={isImportingFolder}
                                                    className={btnPrimary}
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

                                    {activeSection === 'capture' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={Crosshair}
                                    title={t('settingsCaptureTitle')}
                                    description={t('settingsCaptureDesc')}
                                />
                                <div className="space-y-4">
                                    <div className={`${cardClass} space-y-3`}>
                                        <div className="flex items-start gap-3">
                                            <Keyboard className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-white">Atalho desktop</p>
                                                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                                                    {isTauriRuntime()
                                                        ? 'Mesmo com a janela minimizada, o atalho restaura o Mnemosyne e foca a captura no Universo.'
                                                        : 'Na app desktop Tauri este atalho é global (funciona com a janela minimizada). No browser só funciona com o separador focado.'}
                                                </p>
                                            </div>
                                            <kbd className="shrink-0 rounded-md border border-white/12 bg-black/40 px-2 py-1 font-mono text-xs text-slate-200">
                                                {formatCaptureHotkeyLabel()}
                                            </kbd>
                                        </div>
                                    </div>

                                    <div className={`${cardClass} space-y-3`}>
                                        <div className="flex items-start gap-3">
                                            <Globe className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-white">Clipper Chrome / Edge</p>
                                                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                                                    Envia título, URL e seleção para a web app. A extensão não cifra — a mnemónica nunca sai do vault. Query limitada a ~1.5 KB.
                                                </p>
                                                <a
                                                    href="/clipper-install.html"
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="mt-3 inline-flex items-center text-sm font-medium text-slate-200 underline-offset-2 hover:underline"
                                                >
                                                    Como instalar o clipper
                                                </a>
                                            </div>
                                        </div>
                                    </div>

                                    <ApiKeysPanel askConfirm={askConfirm} />
                                </div>
                            </section>
                                    )}

                                    {activeSection === 'privacy' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={Shield}
                                    title={t('settingsPrivacyTitle')}
                                    description={t('settingsPrivacyDesc')}
                                />
                                <LocalMemoryActivityPanel uid={auth.currentUser?.uid ?? ''} />

                                <div className="space-y-3">
                                    <div className={cardClass}>
                                        <div className="flex items-start gap-3">
                                            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                                            <div>
                                                <p className="text-sm font-medium text-white">Cifra das memórias</p>
                                                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                                                    O texto e o título das novas memórias pessoais são cifrados no dispositivo (AES-GCM).
                                                    Memórias antigas podem continuar em claro até serem migradas abaixo. A frase de 12 palavras não é enviada ao servidor;
                                                    embeddings, tags e outros metadados continuam em claro para pesquisa. Anexos antigos têm proteção distinta.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className={`${cardClass} space-y-3`}>
                                        <div className="flex items-start gap-3">
                                            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-white">Cifrar memórias antigas</p>
                                                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                                                    Memórias novas já saem cifradas. Este lote converte texto e título de memórias pessoais legadas e das suas versões históricas para o envelope AES-GCM.
                                                    Podes interromper e retomar neste dispositivo; o contador mostra apenas a execução atual.
                                                </p>
                                                <p className="mt-2 text-xs leading-relaxed text-amber-200/90">
                                                    Guarda e verifica uma cópia antes de continuar. O export local não inclui versões históricas nem bytes dos anexos e não substitui um export Firestore recuperável.
                                                </p>
                                                {encMigration && (
                                                    <p className="mt-2 text-xs text-slate-400">
                                                        {encMigrating ? 'A cifrar… ' : encMigrationOutcome === 'stopped'
                                                            ? 'Interrompido: ' : encMigrationOutcome === 'failed'
                                                                ? 'Falhou: ' : 'Concluído: '}
                                                        {encMigration.migrated}/{encMigration.total} registos cifrados
                                                        {encMigration.skipped ? ` · ${encMigration.skipped} ignorados ou alterados entretanto` : ''}
                                                        {encMigration.failed ? ` · ${encMigration.failed} falha(s)` : ''}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {onOpenExport && (
                                                <button type="button" disabled={encMigrating} onClick={onOpenExport} className={btnSecondary}>
                                                    Exportar cópia local
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                disabled={!personalMigrationWritesEnabled() || encMigrating || !mnemonic}
                                                onClick={() => void handleMigrateLegacyMemories()}
                                                className={btnPrimary}
                                            >
                                                {encMigrating ? 'A cifrar…' : 'Cifrar memórias antigas'}
                                            </button>
                                            {encMigrating && (
                                                <button type="button" onClick={() => migrationAbortRef.current?.abort()} className={btnSecondary}>
                                                    Parar migração
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className={`${cardClass} space-y-3`}>
                                        <div>
                                            <p className="text-sm font-medium text-white">PIN local opcional</p>
                                            <p className="mt-1 text-sm leading-relaxed text-slate-400">
                                                Após idle lock, reabre a sessão com um PIN em vez das 12 palavras.
                                                O PIN fica só neste dispositivo; a mnemónica é cifrada com AES-GCM.
                                            </p>
                                            <p className="mt-2 text-xs text-slate-500">
                                                Estado: {pinEnabled ? 'ativo neste dispositivo' : 'desligado'}
                                            </p>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <label className="block">
                                                <span className={fieldLabelClass}>{pinEnabled ? 'PIN atual' : 'Novo PIN (6–12 alfanumérico)'}</span>
                                                <input
                                                    type="password"
                                                    inputMode="text"
                                                    autoComplete="off"
                                                    value={pinInput}
                                                    onChange={(e) => setPinInput(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))}
                                                    className={inputClass}
                                                />
                                            </label>
                                            {!pinEnabled && (
                                                <label className="block">
                                                    <span className={fieldLabelClass}>Confirmar PIN</span>
                                                    <input
                                                        type="password"
                                                        inputMode="text"
                                                        autoComplete="off"
                                                        value={pinConfirm}
                                                        onChange={(e) => setPinConfirm(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))}
                                                        className={inputClass}
                                                    />
                                                </label>
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
                                                    className={btnPrimary}
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
                                                    className={btnDanger}
                                                >
                                                    {pinBusy ? 'A desativar…' : 'Desativar PIN'}
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className={`${cardClass} space-y-3`}>
                                        <div>
                                            <p className="text-sm font-medium text-white">WebAuthn / Windows Hello</p>
                                            <p className="mt-1 text-sm leading-relaxed text-slate-400">
                                                Opcional: exige biometria ou PIN do sistema antes de desbloquear o vault local.
                                            </p>
                                            <p className="mt-2 text-xs text-slate-500">
                                                Estado:{' '}
                                                {!isWebAuthnAvailable()
                                                    ? 'indisponível neste browser'
                                                    : webauthnEnabled
                                                      ? 'ativo neste dispositivo'
                                                      : 'desligado'}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {!webauthnEnabled ? (
                                                <button
                                                    type="button"
                                                    disabled={!isWebAuthnAvailable() || !auth.currentUser}
                                                    onClick={async () => {
                                                        try {
                                                            const uid = auth.currentUser?.uid;
                                                            if (!uid) {
                                                                toast.error('Inicia sessão primeiro.');
                                                                return;
                                                            }
                                                            await registerWebAuthnGate(uid, auth.currentUser?.displayName || 'Mnemosyne');
                                                            setWebauthnEnabled(true);
                                                            toast.success('WebAuthn ativado neste dispositivo.');
                                                        } catch (error) {
                                                            toast.error(getErrorMessage(error, 'Não foi possível ativar WebAuthn.'));
                                                        }
                                                    }}
                                                    className={btnPrimary}
                                                >
                                                    Ativar WebAuthn
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        clearWebAuthnCredential();
                                                        setWebauthnEnabled(false);
                                                        toast.success('WebAuthn desativado.');
                                                    }}
                                                    className={btnDanger}
                                                >
                                                    Desativar WebAuthn
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className={`${cardClass} flex items-center justify-between gap-4`}>
                                        <div>
                                            <p className="text-sm font-medium text-white">Partilha entre utilizadores</p>
                                            <p className="mt-0.5 text-xs text-slate-500">Permite enviar cápsulas a contactos aceites.</p>
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={shareEnabled}
                                            aria-label="Partilha entre utilizadores"
                                            onClick={() => setShareEnabled(!shareEnabled)}
                                            className={`relative h-5 w-10 rounded-full transition-colors ${shareEnabled ? 'bg-white' : 'bg-white/15'}`}
                                        >
                                            <motion.div
                                                className={`absolute top-0.5 h-4 w-4 rounded-full ${shareEnabled ? 'bg-slate-900' : 'bg-white'}`}
                                                animate={{ left: shareEnabled ? '22px' : '2px' }}
                                                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                            />
                                        </button>
                                    </div>

                                    <div className={cardClass}>
                                        <div className="flex items-start gap-3">
                                            <Compass className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-white">Tour guiado</p>
                                                <p className="mt-1 text-sm leading-relaxed text-slate-400">
                                                    Volta a ver o onboarding de ~30s (captura no Universo, grafo, Ctrl+K, Comms).
                                                </p>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        resetOnboarding();
                                                        onReplayOnboarding?.();
                                                        onClose();
                                                    }}
                                                    className={`mt-3 ${btnSecondary}`}
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

                                    {activeSection === 'teams' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={Users}
                                    title={t('settingsTeamsTitle')}
                                    description={t('settingsTeamsDesc')}
                                />
                                <TeamSettings mnemonic={mnemonic} askConfirm={askConfirm} />
                            </section>
                                    )}

                                    {activeSection === 'account' && (
                            <section className="space-y-6">
                                <SectionHeader
                                    icon={AlertTriangle}
                                    title={t('settingsAccountTitle')}
                                    description={t('settingsAccountDesc')}
                                />
                                <EmailVerificationPanel user={auth.currentUser} active={()=>accountEmailOpen.current}/>
                                
                                <div className={cardClass}>
                                    <p className="text-sm font-medium text-white">Zona crítica</p>
                                    <p className="mt-1 text-sm leading-relaxed text-slate-400">
                                        Eliminar a conta é permanente. Confirma com calma.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleDeleteAccount}
                                        disabled={!ACCOUNT_DELETION_ENABLED}
                                        className={`mt-3 ${btnDanger}`}
                                    >
                                        Eliminar conta permanentemente
                                    </button>
                                    {!ACCOUNT_DELETION_ENABLED && <p className="mt-2 text-sm text-slate-400">A eliminação automática está em validação. Podes pedir a eliminação ao suporte na página abaixo.</p>}
                                    <a href="/account-deletion" className="mt-3 block text-sm text-indigo-300 underline">Consultar ou retomar um pedido de eliminação</a>
                                </div>
                            </section>
                                    )}

                                </div>
                            </div>
                        </div>
                    </motion.div>
                    
                    <PlansModal isOpen={planosOpen} onClose={() => setPlanosOpen(false)} />

                    {confirmDialog && (
                        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                            <button
                                type="button"
                                className="absolute inset-0 bg-black/60"
                                aria-label="Cancelar"
                                onClick={() => closeConfirm(false)}
                            />
                            <div
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="settings-confirm-title"
                                className="relative w-full max-w-md rounded-2xl border border-white/15 bg-[#0b1224] p-5 shadow-2xl"
                            >
                                <h3 id="settings-confirm-title" className="text-base font-semibold text-white">
                                    {confirmDialog.title}
                                </h3>
                                <p className="mt-2 text-sm leading-relaxed text-slate-300">{confirmDialog.message}</p>
                                {confirmDialog.requirePhrase && (
                                    <label className="mt-4 block">
                                        <span className="mb-1.5 block text-xs font-medium text-slate-400">
                                            Escreve “{confirmDialog.requirePhrase}” para confirmar
                                        </span>
                                        <input
                                            type="text"
                                            value={confirmPhrase}
                                            onChange={(e) => setConfirmPhrase(e.target.value)}
                                            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-rose-400/40"
                                        />
                                    </label>
                                )}
                                <div className="mt-5 flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => closeConfirm(false)}
                                        className={btnSecondary}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => closeConfirm(true)}
                                        className={confirmDialog.danger ? btnDanger : btnPrimary}
                                    >
                                        {confirmDialog.confirmLabel || 'Confirmar'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </AnimatePresence>
    );
};
