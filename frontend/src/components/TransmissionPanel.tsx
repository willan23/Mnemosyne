import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Lock, Zap, ShieldAlert, Paperclip, FileText, Radar, Fingerprint, Inbox, Search, CheckCircle2, Radio, PlugZap, Users, UserPlus, Check, XCircle, Loader2 } from 'lucide-react';
import { auth } from '../firebase';
import type {Unsubscribe} from 'firebase/firestore';
import {encryptCommsEnvelope,decryptCommsEnvelope,validateCommsEnvelope,validateCommsSdp,validateCommsIce,validateCommsComposition,COMMS_MAX_ATTACHMENT_BYTES} from '../services/commsTransport';
import { getRtcConfiguration } from '../services/rtcConfig';
import { publishCommsIdentity, resetAndPublishCommsIdentity } from '../services/commsIdentity';
import { useUniverseStore } from '../store/universeStore';
import toast from 'react-hot-toast';
import { useTranslation } from '../utils/translations';
import { personalSemanticCandidates } from '../services/personalSemanticScope';
import {useSyncFeedback} from '../hooks/useSyncFeedback';
import {PersonalMemoryMutationError} from '../services/personalMemoryMutation';
import {ObsidianImportRecoveryPanel} from './ObsidianImportRecoveryPanel';
import {CommsImportRecoveryPanel} from './CommsImportRecoveryPanel';
import {CommsIdentityRolloverPanel} from './CommsIdentityRolloverPanel';
import {hasPendingCommsIdentityRollover,observeCommsIdentityRollovers,loadRetainedCommsIdentities} from '../services/commsIdentityRollover';
import {lookupCommsRecipient,requestCommsContact,respondCommsContact,hasPendingCommsContact} from '../services/commsContacts';
import {removeAcceptedCommsContact,hasPendingCommsContactRemoval} from '../services/commsContactRemoval';
import {CommsContactRecoveryPanel} from './CommsContactRecoveryPanel';
import {CommsDeliveryRecoveryPanel} from './CommsDeliveryRecoveryPanel';
import {CommsP2PRecoveryPanel} from './CommsP2PRecoveryPanel';
import {CommsP2PContentRecoveryPanel} from './CommsP2PContentRecoveryPanel';
import {createCommsP2PContentLink,sendCommsP2PContent,resumeCommsP2PContent,hasPendingCommsP2PContent,observeCommsP2PContent,observeCommsP2PInbox,readCommsP2PInbox,acknowledgeStoredCommsP2P,type CommsP2PContentLink,type CommsP2PReceived} from '../services/commsP2PContent';
import type {CommsP2PInboxCursor} from '../services/commsP2PInboxStore';
import type {CommsP2PContentDescriptor} from '../../../functions/src/commsP2PContentContract';
import {mutateCommsP2PSignal,commsP2PRequestBinding,watchCommsP2PSignal,commsP2PHash,hasPendingCommsP2P,hasStoredCommsP2PSession,observeCommsP2P,reconcileStoredCommsP2PSession,type CommsP2PBinding} from '../services/commsP2PSignaling';
import {parseCommsP2PBinding,commsP2POfferBytes} from '../../../functions/src/commsP2PContract';
import {CommsPageControls} from './CommsPageControls';
import {observeCommsPage,searchAcceptedCommsContact,type CommsListCursor,type CommsListKind,type CommsPageController,type CommsPageProgress,type CommsPageSnapshot} from '../services/commsLists';
import {sendCommsDelivery,acknowledgeCommsTransmission,hasPendingCommsDelivery,observeCommsDeliveries} from '../services/commsDelivery';
import {COMMS_CONTACT_WRITES_ENABLED,COMMS_DELIVERY_WRITES_ENABLED,COMMS_P2P_WRITES_ENABLED} from '../config/releaseGates';
import {fingerprintTeamPublicKey} from '../services/teamVault';
import {projectCommsListRow} from '../../../functions/src/commsListContract';


export interface TransmissionDraft {
    memoryId?: string;
    title?: string;
    text: string;
    /** true se o texto for um pack multi-memória */
    isPack?: boolean;
    packCount?: number;
}

interface TransmissionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    mnemonic: string[] | null;
    initialDraft?: TransmissionDraft | null;
    initialTab?: 'compose' | 'contacts' | 'inbox' | 'sent' | 'identity';
}

interface P2PRoom {
    v?:number;
    callerFingerprint?:string;
    calleeFingerprint?:string;
    offerDigest?:string;
    expiresAt?:number;
    id: string;
    callerId: string;
    calleeId: string;
    callerLabel?: string;
    status: 'offer' | 'active' | 'closed';
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
}

interface TransmissionEnvelope {
    encryptedKey: string;
    encryptedPayload: string;
    payloadIv: string;
    hasAttachment: boolean;
    attachmentName: string | null;
}

interface PublicProfile {
    uid: string;
    displayName?: string;
    emailHash?: string | null;
    publicKeyPem: string;
    fingerprint: string;
}

interface FriendRequest {
    id: string;
    fromUid: string;
    toUid: string;
    fromLabel: string;
    toLabel: string;
    status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
    createdAt: number;
    updatedAt: number;
}

interface ContactProfile {
    uid: string;
    label: string;
    publicKeyPem: string;
    fingerprint: string;
    requestId: string;
    updatedAt:number;
}

type EncryptedTransmissionData = Partial<TransmissionEnvelope> & {
    v?:number;
    deliveryDigest?:string;
    senderFingerprint?:string;
    recipientFingerprint?:string;
    encryptedData?: string;
    senderId?: string;
    recipientId?: string;
    timestamp?: number;
    status?: TransmissionStatus;
    receivedAt?: number;
};

type TransmissionStatus = 'sent' | 'received' | 'failed' | 'p2p';

interface DecryptedAttachment {
    name: string;
    type: string;
    size: number;
    dataUrl: string;
}

type InboxMessage = EncryptedTransmissionData & {
    p2pDescriptor?:CommsP2PContentDescriptor;
    receiptConfirmed?:boolean;
    deliveryUid: string;
    id: string;
    senderId: string;
    timestamp: number;
    status: TransmissionStatus;
    decryptedMessage: string;
    decryptedAttachment?: DecryptedAttachment | null;
};

type OutboxMessage = EncryptedTransmissionData & {
    id: string;
    recipientId: string;
    timestamp: number;
    status: TransmissionStatus;
};

export const TransmissionPanel: React.FC<TransmissionPanelProps> = props => {
    const {epoch}=useSyncFeedback(props.isOpen);
    const uid=auth.currentUser?.uid??null,scope=JSON.stringify([uid,epoch]);
    const [boundDraft,setBoundDraft]=useState({draft:props.initialDraft,scope});
    if(boundDraft.draft!==props.initialDraft){setBoundDraft({draft:props.initialDraft,scope});return null;}
    if(!props.isOpen)return null;
    return <TransmissionPanelView key={scope} {...props} initialDraft={boundDraft.scope===scope?props.initialDraft:null}/>;
};

const TransmissionPanelView: React.FC<TransmissionPanelProps> = ({ isOpen, onClose, mnemonic, initialDraft, initialTab = 'compose' }) => {
    const { t } = useTranslation();
    const { memories } = useUniverseStore();
    const [importingMsgId, setImportingMsgId] = useState<string | null>(null);
    const {capture:captureImportFeedback,epoch:feedbackEpoch}=useSyncFeedback();const importEpoch=useRef(0);const importVisible=useRef(isOpen);
    useEffect(()=>{const epoch=importEpoch;const visible=importVisible;epoch.current++;visible.current=isOpen;setImportingMsgId(null);return()=>{epoch.current++;visible.current=false;};},[isOpen,feedbackEpoch]);
    const closePanel=()=>{importEpoch.current++;importVisible.current=false;retainedIdentityCache.current=null;onClose();};
    const [viewUid]=useState(()=>auth.currentUser?.uid??null);
    const captureContactOperation=useCallback(()=>{
        if(!viewUid||auth.currentUser?.uid!==viewUid)throw new PersonalMemoryMutationError();
        const current=captureImportFeedback(viewUid),epoch=importEpoch.current;
        const guard=()=>{if(!current()||!importVisible.current||importEpoch.current!==epoch)throw new PersonalMemoryMutationError();};
        guard();return{uid:viewUid,guard,live:()=>{try{guard();return true;}catch{return false;}}};
    },[viewUid,captureImportFeedback]);
    const recipientRevision=useRef(0);
    const deliveryScope=JSON.stringify([auth.currentUser?.uid??null,feedbackEpoch]);
    const [identityRevision,setIdentityRevision]=useState(0);const[,setDeliveryRevision]=useState(0);
    useEffect(()=>observeCommsDeliveries(()=>setDeliveryRevision(value=>value+1)),[]);
    useEffect(()=>observeCommsP2P(()=>setDeliveryRevision(value=>value+1)),[]);
    useEffect(()=>observeCommsP2PContent(()=>setDeliveryRevision(value=>value+1)),[]);
    useEffect(()=>observeCommsIdentityRollovers(()=>setIdentityRevision(value=>value+1)),[]);
    const identityPanelEpoch=importEpoch.current;
    const identityPanelCurrent=()=>importVisible.current&&importEpoch.current===identityPanelEpoch;
    const retainedIdentityCache=useRef<{scope:string;promise:ReturnType<typeof loadRetainedCommsIdentities>}|null>(null);
    useEffect(()=>{retainedIdentityCache.current=null;return()=>{retainedIdentityCache.current=null;};},[deliveryScope,identityRevision,isOpen]);
    const decryptWithHistory=useCallback(async(data:EncryptedTransmissionData,identity:LocalIdentity,actor:string,guard:()=>void)=>{
        guard();validateCommsEnvelope(data);
        try{const result=await decryptCommsEnvelope(data,identity.privateKey,guard);guard();return result;}catch{guard();}
        if(!mnemonic)throw new PersonalMemoryMutationError();const scope=JSON.stringify([deliveryScope,identityRevision]);let cached=retainedIdentityCache.current;
        if(!cached||cached.scope!==scope){const next={scope,promise:loadRetainedCommsIdentities(actor,[...mnemonic],guard)};next.promise=next.promise.catch(error=>{if(retainedIdentityCache.current===next)retainedIdentityCache.current=null;throw error;});retainedIdentityCache.current=next;cached=next;}
        const retained=await cached.promise;guard();
        for(const previous of retained){if(previous.pemPublic===identity.pemPublic)continue;try{const result=await decryptCommsEnvelope(data,previous.privateKey,guard);guard();return result;}catch{guard();}}
        throw new Error('Não foi possível abrir a transmissão cifrada.');
    },[mnemonic,deliveryScope,identityRevision]);

    const parseSharedMemory = (messageText: string) => {
        const lines = messageText.split('\n');
        const headerPrefix = "Memória partilhada: ";
        let title = 'Memória Partilhada';
        let originalId: string | undefined = undefined;
        let textStartLine = 1;
        
        const firstLine = lines[0] || '';
        if (firstLine.startsWith(headerPrefix)) {
            title = firstLine.slice(headerPrefix.length).trim();
        } else if (firstLine.startsWith("Shared memory: ")) {
            title = firstLine.slice("Shared memory: ".length).trim();
        } else {
            return {
                title: messageText.slice(0, 40).trim() || 'Pensamento Transmitido',
                text: messageText,
            };
        }
        
        const secondLine = lines[1] || '';
        if (secondLine.startsWith("ID: ")) {
            originalId = secondLine.slice(4).trim();
            textStartLine = 2;
        }
        
        let textStartIndex = textStartLine;
        while (textStartIndex < lines.length && lines[textStartIndex].trim() === '') {
            textStartIndex++;
        }
        
        const text = lines.slice(textStartIndex).join('\n').trim();
        return {
            title,
            text: text || messageText,
            originalId,
        };
    };

    const handleImportMemory = async (msgId: string, msgText: string, msgAttachment: DecryptedAttachment | null) => {
        const actor=auth.currentUser?.uid;if(!actor||importingMsgId||!importVisible.current)return;
        if(!inboxMsgs.some(msg=>msg.id===msgId&&msg.deliveryUid===actor))return;
        const current=captureImportFeedback(actor);const epoch=importEpoch.current;
        const guard=()=>{if(!current()||!importVisible.current||importEpoch.current!==epoch)throw new PersonalMemoryMutationError();};
        if(!current())return;
        setImportingMsgId(msgId);
        try {
            const parsed = parseSharedMemory(msgText);
            const { isCapsulePackText, decodeCapsulePack } = await import('../services/capsuleService');
            const { importCapsuleAsMemory } = await import('../services/learningService');
            guard();

            // Pack multi-memória via Comms (mesmo formato das cápsulas públicas)
            if (isCapsulePackText(parsed.text)) {
                const pack = decodeCapsulePack(parsed.text);
                if (!pack?.items.length) {
                    throw new Error('Pack vazio ou inválido.');
                }
                const result = await importCapsuleAsMemory(
                    actor,
                    {
                        text: parsed.text,
                        titleHint: parsed.title,
                        shareId: null,
                        ownerUid: null,
                    },
                    [],
                    guard,
                );
                guard();
                // Sync store for immediate Universe feedback
                for (const mid of result.memoryIds) {
                    // memories will refresh via firestore listeners on sessions
                    void mid;
                }
                toast.success(
                    result.importedCount > 1
                        ? t('txImportPackOk', { count: result.importedCount })
                        : t('txImportedOk'),
                );
                return;
            }

            const exists = personalSemanticCandidates(memories,actor).some(m => m.text === parsed.text);
            if (exists) {
                toast.error(t('txAlreadyExists'));
                setImportingMsgId(null);
                return;
            }
            
            const {importCommsMemory}=await import('../services/commsMemoryImport');
            guard();
            await importCommsMemory(actor,{text:parsed.text,title:parsed.title,attachment:msgAttachment},memories,guard);
            guard();
            toast.success(t('txImportedOk'));
        } catch {
            if(current()&&importVisible.current&&importEpoch.current===epoch)toast.error(t('txImportFail'));
        } finally {
            if(current()&&importVisible.current&&importEpoch.current===epoch)setImportingMsgId(null);
        }
    };

    const [activeTab, setActiveTab] = useState<'compose' | 'contacts' | 'inbox' | 'sent' | 'identity'>('compose');
    const activeListTab=useRef(activeTab);useEffect(()=>{activeListTab.current=activeTab;},[activeTab]);
    const pageControllers=useRef<Partial<Record<CommsListKind,CommsPageController>>>({});
    const [pageState,setPageState]=useState<{scope:string;values:Partial<Record<CommsListKind,CommsPageProgress>>}>({scope:deliveryScope,values:{}});
    const pages=pageState.scope===deliveryScope?pageState.values:{};
    const connectPage=useCallback((kind:CommsListKind,uid:string,guard:()=>void,onData:(value:CommsPageSnapshot)=>void)=>{
        const controller=observeCommsPage(uid,kind,guard,onData,value=>setPageState(old=>({scope:deliveryScope,values:{...(old.scope===deliveryScope?old.values:{}),[kind]:value}})),()=>kind==='relay-in'?activeListTab.current==='inbox':kind==='relay-out'?activeListTab.current==='sent':kind==='room-in'?activeListTab.current==='compose':['contacts','compose'].includes(activeListTab.current));
        pageControllers.current[kind]=controller;return()=>{controller.stop();if(pageControllers.current[kind]===controller)delete pageControllers.current[kind];};
    },[deliveryScope]);
    const pageControls=(kind:CommsListKind,label:string)=><CommsPageControls label={label} state={pages[kind]} controller={pageControllers.current[kind]}/>;
    const [inboxState,setInboxState]=useState<{scope:string;messages:InboxMessage[]}>({scope:deliveryScope,messages:[]});
    const [p2pInboxState,setP2pInboxState]=useState<{scope:string;messages:InboxMessage[];unavailable:number}>({scope:deliveryScope,messages:[],unavailable:0});
    const [p2pCursor,setP2pCursor]=useState<CommsP2PInboxCursor|null>(null),[p2pNext,setP2pNext]=useState<CommsP2PInboxCursor|null>(null),[p2pHistory,setP2pHistory]=useState<(CommsP2PInboxCursor|null)[]>([]),[p2pInboxBusy,setP2pInboxBusy]=useState(false),[p2pInboxError,setP2pInboxError]=useState(false),[p2pInboxRevision,setP2pInboxRevision]=useState(0);
    const inboxMsgs=[...(inboxState.scope===deliveryScope?inboxState.messages:[]),...(p2pInboxState.scope===deliveryScope?p2pInboxState.messages:[])].sort((a,b)=>b.timestamp-a.timestamp);
    const p2pMessage=useCallback((value:CommsP2PReceived):InboxMessage=>({...value.packet.envelope,id:`p2p-${value.packet.requestId}`,senderId:value.packet.senderUid,recipientId:value.packet.recipientUid,deliveryUid:value.packet.recipientUid,timestamp:value.createdAt,status:'received',receiptConfirmed:value.acknowledgedAt!==null,receivedAt:value.acknowledgedAt??undefined,p2pDescriptor:value.descriptor,decryptedMessage:value.opened.message,decryptedAttachment:value.opened.attachment}),[]);
    const setInboxMsgs=useCallback((next:React.SetStateAction<InboxMessage[]>)=>setInboxState(old=>({scope:deliveryScope,
        messages:typeof next==='function'?next(old.scope===deliveryScope?old.messages:[]):next})),[deliveryScope]);
    const [outboxMsgs, setOutboxMsgs] = useState<OutboxMessage[]>([]);
    const [recipientId, setRecipientId] = useState('');
    const [recipientKeyPem, setRecipientKeyPem] = useState('');
    const [recipientLookup, setRecipientLookup] = useState('');
    const [resolvedRecipient, setResolvedRecipient] = useState<{ uid: string, label: string, fingerprint: string } | null>(null);
    const [isResolvingRecipient, setIsResolvingRecipient] = useState(false);
    const [isRequestingContact, setIsRequestingContact] = useState(false);
    const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
    const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
    const [contacts, setContacts] = useState<ContactProfile[]>([]);
    const removingContact=useRef(false);
    const [contactRemovalBusy,setContactRemovalBusy]=useState(false);
    const [contactDirectoryRevision,setContactDirectoryRevision]=useState(0);
    const searchRevision=useRef(0);
    const [contactLookup,setContactLookup]=useState('');
    const [contactSearch,setContactSearch]=useState<{scope:string;lookup:string;rows:ContactProfile[];next:CommsListCursor|null;unavailable:number;busy:boolean;error:boolean}|null>(null);
    const currentContactSearch=contactSearch?.scope===deliveryScope&&contactSearch.lookup===contactLookup?contactSearch:null;
    const displayedContacts=currentContactSearch&&!currentContactSearch.busy&&!currentContactSearch.error?currentContactSearch.rows:currentContactSearch?[]:contacts;
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [receiptBusy,setReceiptBusy]=useState<string|null>(null);
    const [attachment, setAttachment] = useState<File | null>(null);
    const [handshakeMode, setHandshakeMode] = useState(false);
    const [incomingRooms, setIncomingRooms] = useState<P2PRoom[]>([]);
    const [p2pStatus, setP2pStatus] = useState<'idle' | 'offering' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
    const [, setP2pRoomId] = useState<string | null>(null);
    
    // Criptografia
    type LocalIdentity={publicKey:CryptoKey;privateKey:CryptoKey;pemPublic:string};
    const [identityState,setIdentityState]=useState<{scope:string;identity:LocalIdentity|null}>({scope:deliveryScope,identity:null});
    const myIdentity=identityState.scope===deliveryScope?identityState.identity:null;
    const setMyIdentity=useCallback((identity:LocalIdentity|null)=>setIdentityState({scope:deliveryScope,identity}),[deliveryScope]);
    useEffect(()=>{if(!viewUid)return;return observeCommsP2PInbox(viewUid,()=>setP2pInboxRevision(value=>value+1));},[viewUid]);
    useEffect(()=>{
        let operation:ReturnType<typeof captureContactOperation>;try{operation=captureContactOperation();}catch{return;}if(!myIdentity)return;const identity=myIdentity;let active=true;const guard=()=>{operation.guard();if(!active)throw new PersonalMemoryMutationError();};
        setP2pInboxBusy(true);setP2pInboxError(false);setP2pInboxState({scope:deliveryScope,messages:[],unavailable:0});
        void readCommsP2PInbox(operation.uid,p2pCursor,(envelope,current)=>decryptWithHistory(envelope,identity,operation.uid,current),guard).then(page=>{guard();setP2pInboxState({scope:deliveryScope,messages:page.rows.map(p2pMessage),unavailable:page.unavailable});setP2pNext(page.next);setP2pInboxBusy(false);}).catch(()=>{if(active&&operation.live()){setP2pInboxError(true);setP2pInboxBusy(false);setP2pNext(null);}});
        return()=>{active=false;};
    },[myIdentity,p2pCursor,p2pInboxRevision,captureContactOperation,deliveryScope,decryptWithHistory,p2pMessage]);
    const [identityError, setIdentityError] = useState<string | null>(null);
    const [isRepairingIdentity, setIsRepairingIdentity] = useState(false);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const dataChannelRef = useRef<RTCDataChannel | null>(null);
    const p2pUnsubscribersRef = useRef<Unsubscribe[]>([]);
    type PanelOperation=ReturnType<typeof captureContactOperation>;
    type PeerBinding={roomId:string;peerUid:string;pc:RTCPeerConnection;operation:PanelOperation;identity:LocalIdentity;candidateIds:Set<string>;candidates:RTCIceCandidateInit[];flushing:boolean;localCandidates:number;signal:CommsP2PBinding|null;admitted:boolean;localIce:ReturnType<typeof validateCommsIce>[];writingIce:boolean;content:CommsP2PContentLink|null};
    const peerBindingRef=useRef<PeerBinding|null>(null);
    const sendingRef=useRef(false);

    const formatMemoryDraft = (draft: TransmissionDraft): string => {
        // Packs já vêm codificados (CAPSULE_PACK_MARKER) — enviar raw para importação completa
        if (draft.isPack || draft.text.trimStart().startsWith('[[MNEMOSYNE_CAPSULE_PACK_V1]]')) {
            const header = draft.title?.trim() || 'Pack de memórias Mnemosyne';
            return [
                `Memória partilhada: ${header}`,
                draft.memoryId ? `ID: ${draft.memoryId}` : null,
                draft.packCount ? `Pack: ${draft.packCount} itens` : null,
                '',
                draft.text,
            ].filter((line): line is string => line !== null).join('\n');
        }
        const title = draft.title?.trim() || 'Memória Mnemosyne';
        return [
            `Memória partilhada: ${title}`,
            draft.memoryId ? `ID: ${draft.memoryId}` : null,
            '',
            draft.text,
        ].filter((line): line is string => line !== null).join('\n');
    };

    const selectRecipient = (profile: PublicProfile | ContactProfile) => {
        const operation=captureContactOperation();operation.guard();recipientRevision.current++;
        const label = 'label' in profile ? profile.label : profile.displayName || profile.uid;
        setRecipientId(profile.uid);
        setRecipientKeyPem(profile.publicKeyPem);
        setRecipientLookup(label);
        setResolvedRecipient({ uid: profile.uid, label, fingerprint:profile.fingerprint });
        setActiveTab('compose');
    };

    const getTransmissionStatusLabel = (status: TransmissionStatus) => {
        if (status === 'p2p') return 'P2P aberto';
        if (status === 'received') return 'Recebida';
        if (status === 'failed') return 'Falhou';
        return 'Enviada';
    };

    const getTransmissionStatusClasses = (status: TransmissionStatus) => {
        if (status === 'p2p') return 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20';
        if (status === 'received') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
        if (status === 'failed') return 'bg-rose-500/10 text-rose-300 border-rose-500/20';
        return 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20';
    };

    const retireP2P=useCallback(()=>{
        const binding=peerBindingRef.current;peerBindingRef.current=null;
        binding?.content?.stop();
        for(const stop of p2pUnsubscribersRef.current)stop();p2pUnsubscribersRef.current=[];
        const channel=dataChannelRef.current,pc=peerConnectionRef.current;dataChannelRef.current=null;peerConnectionRef.current=null;
        if(channel){channel.onmessage=null;channel.onopen=null;channel.onclose=null;channel.onerror=null;channel.close();}
        if(pc){pc.onicecandidate=null;pc.onconnectionstatechange=null;pc.ondatachannel=null;pc.close();}
        return binding;
    },[]);
    useEffect(()=>()=>{retireP2P();},[retireP2P]);
    useEffect(()=>{retireP2P();setP2pStatus('closed');setP2pRoomId(null);},[identityRevision,retireP2P]);
    const closeP2P=useCallback(async(markClosed=true)=>{
        let operation:PanelOperation;try{operation=captureContactOperation();}catch{retireP2P();return;}
        const previous=retireP2P();operation.guard();setP2pStatus('closed');setP2pRoomId(null);
        if(markClosed&&previous?.signal){try{operation.guard();const base=commsP2PRequestBinding(previous.signal);await mutateCommsP2PSignal(operation.uid,{...base,kind:'close',signal:null},operation.guard);operation.guard();}catch{if(operation.live())toast.error('Não foi possível confirmar o fecho do canal. Usa a recuperação P2P.');}}
    },[captureContactOperation,retireP2P]);
    const peerCurrent=(binding:PeerBinding)=>peerBindingRef.current===binding&&binding.operation.live();
    const peerGuard=(binding:PeerBinding)=>{binding.operation.guard();if(peerBindingRef.current!==binding)throw new PersonalMemoryMutationError();};
    const flushCandidates=async(binding:PeerBinding)=>{
        if(binding.flushing||!binding.pc.remoteDescription||!peerCurrent(binding))return;binding.flushing=true;
        try{while(binding.candidates.length){peerGuard(binding);const candidate=binding.candidates.shift()!;await binding.pc.addIceCandidate(candidate);peerGuard(binding);}}catch{if(peerCurrent(binding))setP2pStatus('error');}finally{binding.flushing=false;}
    };
    const flushLocalIce=async(binding:PeerBinding)=>{
        if(binding.writingIce||!binding.admitted||!binding.signal||!peerCurrent(binding)||hasPendingCommsP2P(binding.operation.uid))return;binding.writingIce=true;
        try{while(binding.localIce.length){peerGuard(binding);const base=commsP2PRequestBinding(binding.signal);const result=await mutateCommsP2PSignal(binding.operation.uid,{...base,kind:'candidate',signal:binding.localIce[0]},()=>peerGuard(binding));peerGuard(binding);if(result.status!=='applied'||!['offer','active'].includes(result.roomStatus))throw Error();binding.localIce.shift();}}
        catch{if(peerCurrent(binding)){retireP2P();setP2pStatus('error');}}finally{binding.writingIce=false;}
    };
    const attachSignalListener=(binding:PeerBinding)=>{
        peerGuard(binding);if(!binding.signal)throw Error();const stop=watchCommsP2PSignal(binding.operation.uid,binding.signal,()=>peerGuard(binding),async room=>{
            peerGuard(binding);if(!['offer','active'].includes(room.status)){try{await reconcileStoredCommsP2PSession(binding.operation.uid,()=>peerGuard(binding));}finally{if(peerCurrent(binding))await closeP2P(false);}return;}
            if(room.answer&&!binding.pc.currentRemoteDescription){await binding.pc.setRemoteDescription(validateCommsSdp(room.answer,'answer'));peerGuard(binding);}
            for(const value of room.candidates){if(binding.candidateIds.has(value.id))continue;if(value.uid!==binding.peerUid||binding.candidateIds.size>=64)throw Error();binding.candidates.push(validateCommsIce(value.candidate));binding.candidateIds.add(value.id);}await flushCandidates(binding);peerGuard(binding);
        },()=>{if(peerCurrent(binding)){retireP2P();setP2pStatus('error');}});p2pUnsubscribersRef.current.push(stop);
    };
    const wireDataChannel=(channel:RTCDataChannel,binding:PeerBinding)=>{
        if(!peerCurrent(binding)||channel.label!=='mnemosyne-e2e'||dataChannelRef.current){channel.close();return;}dataChannelRef.current=channel;
        const prepare=()=>{peerGuard(binding);if(!binding.signal)throw new PersonalMemoryMutationError();if(!binding.content)binding.content=createCommsP2PContentLink(binding.operation.uid,binding.signal,channel,()=>binding.pc.sctp?.maxMessageSize??0,()=>peerGuard(binding),(envelope,guard)=>decryptWithHistory(envelope,binding.identity,binding.operation.uid,guard),value=>{peerGuard(binding);const msg=p2pMessage(value);setP2pCursor(null);setP2pHistory([]);setP2pInboxState(old=>({scope:deliveryScope,unavailable:old.scope===deliveryScope?old.unavailable:0,messages:[msg,...(old.scope===deliveryScope?old.messages:[]).filter(row=>row.id!==msg.id)].slice(0,10)}));});return binding.content;};
        channel.onopen=()=>{if(peerCurrent(binding)){try{prepare();setP2pStatus('open');}catch{setP2pStatus('error');}}};channel.onclose=()=>{binding.content?.stop();if(peerCurrent(binding))setP2pStatus('closed');};channel.onerror=()=>{binding.content?.stop();if(peerCurrent(binding))setP2pStatus('error');};
        channel.onmessage=async event=>{if(!peerCurrent(binding))return;try{await prepare().receive(event.data);peerGuard(binding);}catch{if(peerCurrent(binding))setP2pStatus('error');}};
    };
    const createPeerConnection=(roomId:string,peerUid:string,_role:'caller'|'callee',operation:PanelOperation):PeerBinding=>{
        operation.guard();if(!myIdentity||peerUid===operation.uid)throw new PersonalMemoryMutationError();
        const pc=new RTCPeerConnection(getRtcConfiguration()),binding:PeerBinding={roomId,peerUid,pc,operation,identity:myIdentity,candidateIds:new Set(),candidates:[],flushing:false,localCandidates:0,signal:null,admitted:false,localIce:[],writingIce:false,content:null};peerBindingRef.current=binding;peerConnectionRef.current=pc;
        pc.onicecandidate=async event=>{
            if(!event.candidate||event.candidate.candidate===''||!peerCurrent(binding))return;
            try{peerGuard(binding);if(binding.localCandidates>=64)throw Error();const candidate=validateCommsIce(event.candidate.toJSON());binding.localCandidates++;peerGuard(binding);
                binding.localIce.push(candidate);void flushLocalIce(binding);
            }catch{if(peerCurrent(binding))setP2pStatus('error');}
        };
        pc.onconnectionstatechange=()=>{if(!peerCurrent(binding))return;if(pc.connectionState==='failed'||pc.connectionState==='disconnected')setP2pStatus('error');if(pc.connectionState==='closed')setP2pStatus('closed');};return binding;
    };

    useEffect(() => {
        setMyIdentity(null);setInboxMsgs([]);setIsRepairingIdentity(false);
        if (isOpen) {
            const user = auth.currentUser;
            setIdentityError(null);
            setMyIdentity(null);
            if (!user) {
                setIdentityError('Entra na tua conta para ativar Comms.');
                return;
            }

            const current=captureImportFeedback(user.uid);const epoch=importEpoch.current;let active=true;
            const live=()=>active&&current()&&importVisible.current&&importEpoch.current===epoch;
            if(!live())return;
            publishCommsIdentity(user, mnemonic,()=>{if(!live())throw new PersonalMemoryMutationError();}).then((identity) => {
                if(live())setMyIdentity(identity);
            }).catch(() => {
                if(live())setIdentityError(hasPendingCommsIdentityRollover(user.uid)?'Uma troca de identidade aguarda confirmação. Usa a recuperação abaixo.':'Não foi possível desbloquear a identidade local.');
            });
            return()=>{active=false;};
        }
    }, [isOpen, mnemonic,feedbackEpoch,captureImportFeedback,setMyIdentity,setInboxMsgs,identityRevision]);

    const handleRepairIdentity = async () => {
        const user = auth.currentUser;
        if (!user) return;
        const current=captureImportFeedback(user.uid);const epoch=importEpoch.current;
        const live=()=>current()&&importVisible.current&&importEpoch.current===epoch;
        if(!live())return;
        if (!confirm('Regenerar a identidade de Comms neste dispositivo? A nova chave pública será publicada após confirmação; as cifras das identidades anteriores serão conservadas localmente.')) return;
        if(!live())return;

        setIsRepairingIdentity(true);
        setIdentityError(null);
        try {
            const identity = await resetAndPublishCommsIdentity(user, mnemonic,()=>{if(!live())throw new PersonalMemoryMutationError();});
            if(!live())return;
            setMyIdentity(identity);
            setActiveTab('identity');
        } catch {
            if(live())setIdentityError('Não foi possível regenerar a identidade de Comms.');
        } finally {
            if(live())setIsRepairingIdentity(false);
        }
    };

    useEffect(() => {
        if (!isOpen) {
            void closeP2P(true);
            setHandshakeMode(false);
            setRecipientId('');
            setRecipientKeyPem('');
            setRecipientLookup('');
            setResolvedRecipient(null);
            setMessage('');
            setAttachment(null);
            setActiveTab('compose');
        }
    }, [isOpen, closeP2P]);

    useEffect(() => {
        if (!isOpen) return;
        if (initialDraft) {
            setMessage(formatMemoryDraft(initialDraft));
            setAttachment(null);
            setActiveTab('compose');
            return;
        }
        setActiveTab(initialTab);
    }, [isOpen, initialDraft, initialTab]);

    useEffect(() => {
        const actor=auth.currentUser?.uid;
        if (!isOpen || !actor || !myIdentity) return;
        const identity=myIdentity;const current=captureImportFeedback(actor);const epoch=importEpoch.current;let active=true;let revision=0;
        const live=()=>active&&current()&&importVisible.current&&importEpoch.current===epoch;
        if(!live())return;
        const unsubscribe = connectPage('relay-in',actor,()=>{if(!live())throw new PersonalMemoryMutationError();},async (snapshot) => {
            const observed=++revision;if(!live())return;
            const msgs = await Promise.all(snapshot.docs.map(async (transmissionDoc) => {
                const data = transmissionDoc.data() as EncryptedTransmissionData;
                if(!live()||data.recipientId!==actor)return null;
                let decryptedMessage = "Erro a desencriptar. Chave privada inválida?";
                let decryptedAttachment: DecryptedAttachment | null = null;
                let nextStatus: TransmissionStatus = data.status || 'sent';
                let receiptConfirmed=data.status==='received'&&Number.isSafeInteger(data.receivedAt)&&Number(data.receivedAt)>=Number(data.timestamp);
                try {
                    if ((data.encryptedPayload || data.encryptedData) && identity.privateKey) {
                        const decrypted = await decryptWithHistory(data,identity,actor,()=>{if(!live()||observed!==revision)throw new PersonalMemoryMutationError();});
                        if(!live()||observed!==revision)return null;
                        decryptedMessage = decrypted.message;
                        decryptedAttachment = decrypted.attachment;
                        if (data.status === 'sent') {
                            nextStatus = 'received';
                            try{await acknowledgeCommsTransmission(actor,transmissionDoc.id,data,()=>{if(!live()||observed!==revision)throw new PersonalMemoryMutationError();});receiptConfirmed=true;}catch{/* A missing receipt acknowledgement cannot turn successful decryption into failure. */}
                        }
                    }
                } catch {
                    if(!live()||observed!==revision)return null;
                    nextStatus = 'failed';
                    // Missing keys, a local policy limit or a failed decrypt is not a terminal delivery decision.
                }
                return {
                    ...data,
                    id: transmissionDoc.id,
                    deliveryUid:actor,
                    senderId: data.senderId || 'desconhecido',
                    timestamp: data.timestamp || Date.now(),
                    status: nextStatus,
                    decryptedMessage,
                    decryptedAttachment,
                    receiptConfirmed,
                };
            }));
            if(!live()||observed!==revision)return;
            const delivered=msgs.filter((msg):msg is NonNullable<typeof msg>=>msg!==null);
            delivered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setInboxMsgs(delivered);
        });
        return () => {active=false;unsubscribe();};
    }, [isOpen, myIdentity,feedbackEpoch,captureImportFeedback,setInboxMsgs,decryptWithHistory,connectPage]);

    useEffect(() => {
        let operation:PanelOperation;try{operation=captureContactOperation();}catch{return;}let active=true;const live=()=>active&&operation.live();
        const unsubscribe = connectPage('relay-out',operation.uid,operation.guard,(snapshot) => {
            if(!live())return;
            const msgs = snapshot.docs.map((transmissionDoc) => {
                const data = transmissionDoc.data() as EncryptedTransmissionData;
                return {
                    ...data,
                    id: transmissionDoc.id,
                    recipientId: data.recipientId || 'desconhecido',
                    timestamp: data.timestamp || Date.now(),
                    status: data.status || 'sent',
                };
            }).filter(msg=>msg.senderId===operation.uid);
            msgs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setOutboxMsgs(msgs);
        });
        return () => {active=false;unsubscribe();};
    }, [isOpen,captureContactOperation,connectPage]);

    useEffect(() => {
        let operation:PanelOperation;try{operation=captureContactOperation();}catch{return;}let active=true;const live=()=>active&&operation.live();
        const unsubscribe = connectPage('room-in',operation.uid,operation.guard,(snapshot) => {
            if(!live())return;
            const rooms = snapshot.docs
                .map((roomDoc) => ({ ...roomDoc.data(),id: roomDoc.id } as P2PRoom))
                .filter((room) => room.status === 'offer'&&room.v===2&&Number(room.expiresAt)>Date.now()&&room.calleeId===operation.uid&&room.callerId!==operation.uid);
            setIncomingRooms(rooms);
        });
        return () => {active=false;unsubscribe();};
    }, [isOpen,captureContactOperation,connectPage]);

    useEffect(() => {
        let operation:ReturnType<typeof captureContactOperation>;try{operation=captureContactOperation();}catch{return;}
        let active=true;const live=()=>active&&operation.live();const uid=operation.uid;
        const outgoingUnsubscribe = connectPage('contact-out',uid,operation.guard,(snapshot) => {
            if(!live())return;
            setOutgoingRequests(snapshot.docs.map((requestDoc) => ({
                ...requestDoc.data(),
                id: requestDoc.id,
            } as FriendRequest)).filter(request=>request.fromUid===uid&&request.toUid!==uid));
        });

        const incomingUnsubscribe = connectPage('contact-in',uid,operation.guard,(snapshot) => {
            if(!live())return;
            setIncomingRequests(snapshot.docs.map((requestDoc) => ({
                ...requestDoc.data(),
                id: requestDoc.id,
            } as FriendRequest)).filter(request=>request.toUid===uid&&request.fromUid!==uid));
        });

        return () => {
            active=false;
            outgoingUnsubscribe();
            incomingUnsubscribe();
        };
    }, [isOpen,feedbackEpoch,captureContactOperation,connectPage]);

    const directoryProfiles=useCallback((snapshot:CommsPageSnapshot,uid:string)=>{const profiles=new Map<string,ContactProfile>();for(const entry of snapshot.docs){try{const row=projectCommsListRow({uid,kind:'contact-directory',after:null},entry.id,entry.data()).data;if(!profiles.has(String(row.uid)))profiles.set(String(row.uid),{uid:String(row.uid),label:String(row.displayName),publicKeyPem:String(row.publicKeyPem),fingerprint:String(row.fingerprint),requestId:entry.id,updatedAt:Number(row.updatedAt)});}catch{/* Invalid or foreign fixture data never selects a contact. */}}return [...profiles.values()];},[]);
    useEffect(()=>{
        setContacts([]);if(!isOpen)return;let operation:ReturnType<typeof captureContactOperation>;try{operation=captureContactOperation();}catch{return;}
        return connectPage('contact-directory',operation.uid,operation.guard,snapshot=>{operation.guard();setContacts(directoryProfiles(snapshot,operation.uid));});
    },[isOpen,captureContactOperation,connectPage,directoryProfiles,contactDirectoryRevision]);

    const refreshRemovedContacts=()=>{
        searchRevision.current++;setContactSearch(null);setContacts([]);setContactDirectoryRevision(value=>value+1);
        recipientRevision.current++;setResolvedRecipient(null);setRecipientId('');setRecipientKeyPem('');setRecipientLookup('');
        pageControllers.current['contact-in']?.refresh();pageControllers.current['contact-out']?.refresh();
    };
    const removeContact=async(contact:ContactProfile)=>{
        if(removingContact.current||hasPendingCommsContactRemoval(viewUid??'')||!COMMS_CONTACT_WRITES_ENABLED)return;
        let operation:ReturnType<typeof captureContactOperation>;try{operation=captureContactOperation();}catch{return;}
        const selected={peerUid:contact.uid,anchorId:contact.requestId,anchorUpdatedAt:contact.updatedAt};
        if(!window.confirm(`Retirar ${contact.label} (${contact.uid}) dos contactos e cancelar os pedidos pendentes deste par? As mensagens já entregues serão conservadas.`))return;
        try{operation.guard();}catch{return;}removingContact.current=true;setContactRemovalBusy(true);
        try{
            const result=await removeAcceptedCommsContact(operation.uid,selected,operation.guard);operation.guard();refreshRemovedContacts();
            toast.success(result.status==='pending'?'Remoção iniciada. Continua a mesma operação na recuperação abaixo.':result.status==='revoked'?'O contacto já não está disponível.':'Contacto retirado.');
        }catch{if(operation.live())toast.error('Não foi possível confirmar a remoção. Usa a recuperação abaixo.');}
        finally{removingContact.current=false;if(operation.live())setContactRemovalBusy(false);}
    };

    const findAcceptedContact=async(after:CommsListCursor|null=null)=>{
        if(!contactLookup.trim()||currentContactSearch?.busy)return;
        let operation:ReturnType<typeof captureContactOperation>;try{operation=captureContactOperation();}catch{return;}
        const revision=++searchRevision.current,lookup=contactLookup;
        const guard=()=>{operation.guard();if(searchRevision.current!==revision)throw new PersonalMemoryMutationError();};
        setContactSearch({scope:deliveryScope,lookup,rows:[],next:null,unavailable:0,busy:true,error:false});
        try{
            const page=await searchAcceptedCommsContact(operation.uid,lookup,after,guard);guard();
            const rows=directoryProfiles({docs:page.rows.map(row=>({id:row.id,data:()=>row.data}))},operation.uid);
            setContactSearch({scope:deliveryScope,lookup,rows,next:page.next,unavailable:page.unavailable,busy:false,error:false});
        }catch{
            if(operation.live()&&searchRevision.current===revision)setContactSearch({scope:deliveryScope,lookup,rows:[],next:null,unavailable:0,busy:false,error:true});
        }
    };

    const resolveRecipient = async () => {
        const lookup = recipientLookup.trim();
        if (!lookup || isResolvingRecipient) return;
        let operation:ReturnType<typeof captureContactOperation>;try{operation=captureContactOperation();}catch{return;}
        const revision=recipientRevision.current;
        const guard=()=>{operation.guard();if(recipientRevision.current!==revision)throw new PersonalMemoryMutationError();};
        setIsResolvingRecipient(true);
        try {
            const profile=await lookupCommsRecipient(operation.uid,lookup,guard);guard();selectRecipient(profile);
        } catch {
            if(operation.live()&&recipientRevision.current===revision)toast.error(t('txResolveFail'));
        } finally {
            if(operation.live())setIsResolvingRecipient(false);
        }
    };

    const existingRequestForResolvedRecipient = resolvedRecipient
        ? [...contacts,...(currentContactSearch?.rows??[])].some(contact=>contact.uid===resolvedRecipient.uid)?{status:'accepted' as const}:[...incomingRequests, ...outgoingRequests].find((request) =>
            (request.fromUid === viewUid && request.toUid === resolvedRecipient.uid) ||
            (request.toUid === viewUid && request.fromUid === resolvedRecipient.uid)
        )
        : undefined;

    const requestContact = async () => {
        if (!resolvedRecipient || isRequestingContact) return;
        let operation:ReturnType<typeof captureContactOperation>;try{operation=captureContactOperation();}catch{return;}
        if (existingRequestForResolvedRecipient?.status === 'accepted') {toast.error(t('txAlreadyContact'));return;}
        if (existingRequestForResolvedRecipient?.status === 'pending') {toast.error(t('txPendingRequest'));return;}
        const selected={uid:resolvedRecipient.uid,fingerprint:resolvedRecipient.fingerprint},revision=recipientRevision.current;
        const guard=()=>{operation.guard();if(recipientRevision.current!==revision)throw new PersonalMemoryMutationError();};
        setIsRequestingContact(true);
        try {
            const result=await requestCommsContact(operation.uid,selected,guard);guard();
            if(result.status==='revoked')refreshRemovedContacts();
            toast.success(result.status==='revoked'?'O destinatário já não está disponível. O pedido local foi encerrado.':result.status==='cancelled'?'Pedido de contacto cancelado.':'Pedido de contacto confirmado.');
        } catch {
            if(operation.live()&&recipientRevision.current===revision)toast.error('Não foi possível confirmar o pedido. Usa a recuperação abaixo.');
        } finally {
            if(operation.live())setIsRequestingContact(false);
        }
    };

    const respondToContactRequest = async (request: FriendRequest, status: 'accepted' | 'rejected') => {
        let operation:ReturnType<typeof captureContactOperation>;try{operation=captureContactOperation();}catch{return;}
        if(request.toUid!==operation.uid||request.status!=='pending'||!incomingRequests.some(row=>row.id===request.id&&row.toUid===operation.uid))return;
        try {
            await respondCommsContact(operation.uid,request.id,status,operation.guard);operation.guard();
            pageControllers.current['contact-in']?.refresh();pageControllers.current['contact-out']?.refresh();pageControllers.current['contact-directory']?.refresh();
        } catch {
            if(operation.live())toast.error(t('txResolveFail'));
        }
    };
    const startP2PChannel=async()=>{
        if(!COMMS_P2P_WRITES_ENABLED)return;let operation:PanelOperation;try{operation=captureContactOperation();}catch{return;}
        if(!resolvedRecipient||resolvedRecipient.uid!==recipientId||!myIdentity||hasPendingCommsP2P(operation.uid)||hasStoredCommsP2PSession(operation.uid))return;
        const target={uid:resolvedRecipient.uid,fingerprint:resolvedRecipient.fingerprint},revision=recipientRevision.current,identity=myIdentity,original=operation;
        const guard=()=>{original.guard();if(recipientRevision.current!==revision)throw new PersonalMemoryMutationError();};operation={uid:original.uid,guard,live:()=>{try{guard();return true;}catch{return false;}}};let binding:PeerBinding|undefined;
        try{operation.guard();await closeP2P(false);operation.guard();setP2pStatus('offering');const roomId=crypto.randomUUID();binding=createPeerConnection(roomId,target.uid,'caller',operation);const current=binding,pc=current.pc;wireDataChannel(pc.createDataChannel('mnemosyne-e2e',{ordered:true}),current);
            const offer=validateCommsSdp(await pc.createOffer(),'offer');peerGuard(current);const callerFingerprint=await fingerprintTeamPublicKey(identity.pemPublic);peerGuard(current);const offerDigest=await commsP2PHash(commsP2POfferBytes(offer));peerGuard(current);
            current.signal=parseCommsP2PBinding({roomId,actorUid:operation.uid,callerUid:operation.uid,calleeUid:target.uid,callerFingerprint,calleeFingerprint:target.fingerprint,offerDigest});await pc.setLocalDescription(offer);peerGuard(current);
            const base=commsP2PRequestBinding(current.signal),result=await mutateCommsP2PSignal(operation.uid,{...base,kind:'create',signal:offer},()=>peerGuard(current));peerGuard(current);if(result.status!=='applied'||!['offer','active'].includes(result.roomStatus))throw Error();current.operation=original;current.admitted=true;setP2pRoomId(roomId);setP2pStatus('connecting');attachSignalListener(current);void flushLocalIce(current);
        }catch{if(binding&&peerBindingRef.current===binding)retireP2P();if(operation.live()){setP2pStatus('error');toast.error('Não foi possível confirmar a proposta P2P. Usa a recuperação se houver uma operação pendente.');}}
    };
    const acceptP2PChannel=async(room:P2PRoom)=>{
        if(!COMMS_P2P_WRITES_ENABLED)return;let operation:PanelOperation;try{operation=captureContactOperation();}catch{return;}
        if(room.v!==2||room.calleeId!==operation.uid||room.callerId===operation.uid||room.status!=='offer'||!room.offer||!myIdentity||hasPendingCommsP2P(operation.uid)||hasStoredCommsP2PSession(operation.uid)||!incomingRooms.some(value=>value.id===room.id&&value.callerId===room.callerId))return;
        const captured={...room,offer:{...room.offer}};let binding:PeerBinding|undefined;
        try{const offer=validateCommsSdp(captured.offer,'offer'),signal=parseCommsP2PBinding({roomId:captured.id,actorUid:operation.uid,callerUid:captured.callerId,calleeUid:operation.uid,callerFingerprint:captured.callerFingerprint,calleeFingerprint:captured.calleeFingerprint,offerDigest:captured.offerDigest});operation.guard();
            if(await commsP2PHash(commsP2POfferBytes(offer))!==signal.offerDigest)throw Error();operation.guard();await closeP2P(false);operation.guard();setP2pStatus('connecting');binding=createPeerConnection(captured.id,captured.callerId,'callee',operation);const current=binding,pc=current.pc;current.signal=signal;pc.ondatachannel=event=>wireDataChannel(event.channel,current);
            await pc.setRemoteDescription(offer);peerGuard(current);const answer=validateCommsSdp(await pc.createAnswer(),'answer');peerGuard(current);await pc.setLocalDescription(answer);peerGuard(current);const base=commsP2PRequestBinding(signal),result=await mutateCommsP2PSignal(operation.uid,{...base,kind:'answer',signal:answer},()=>peerGuard(current));peerGuard(current);if(result.status!=='applied'||result.roomStatus!=='active')throw Error();current.admitted=true;setP2pRoomId(captured.id);attachSignalListener(current);await flushCandidates(current);peerGuard(current);void flushLocalIce(current);
        }catch{if(binding&&peerBindingRef.current===binding)retireP2P();if(operation.live()){setP2pStatus('error');toast.error('Não foi possível confirmar a aceitação P2P. Usa a recuperação se houver uma operação pendente.');}}
    };
    const handleSend=async()=>{
        let operation:PanelOperation;try{operation=captureContactOperation();}catch{return;}
        if(sendingRef.current||hasPendingCommsP2PContent(operation.uid)||hasPendingCommsP2P(operation.uid)||hasPendingCommsDelivery(operation.uid)||!myIdentity||!resolvedRecipient||resolvedRecipient.uid!==recipientId)return;
        const captured={message,attachment,publicKeyPem:recipientKeyPem,fingerprint:resolvedRecipient.fingerprint},target=resolvedRecipient.uid,revision=recipientRevision.current;
        const guard=()=>{operation.guard();if(recipientRevision.current!==revision)throw new PersonalMemoryMutationError();};
        const binding=peerBindingRef.current,channel=dataChannelRef.current,p2p=p2pStatus==='open';if(p2p?!COMMS_P2P_WRITES_ENABLED:!COMMS_DELIVERY_WRITES_ENABLED)return;
        try{guard();validateCommsComposition(captured);}catch{if(operation.live())toast.error('Resolve novamente o destinatário. Usa texto até 32 KiB e anexos até 256 KiB.');return;}
        sendingRef.current=true;setIsSending(true);setHandshakeMode(true);
        try{const envelope=await encryptCommsEnvelope(captured,guard);guard();
            if(p2p){if(!binding||binding.peerUid!==target||binding.operation.uid!==operation.uid||!peerCurrent(binding)||channel!==dataChannelRef.current||channel?.readyState!=='open')throw new PersonalMemoryMutationError();
                if(!binding.content)throw new PersonalMemoryMutationError();const senderFingerprint=await fingerprintTeamPublicKey(myIdentity.pemPublic);guard();const result=await sendCommsP2PContent(operation.uid,{recipientUid:target,senderFingerprint,recipientFingerprint:captured.fingerprint,envelope},binding.content,guard);guard();if(result.status!=='received')throw Error();toast.success('Receção P2P confirmada pelo destinatário.');
            }else{guard();const senderFingerprint=await fingerprintTeamPublicKey(myIdentity.pemPublic);guard();const confirmed=await sendCommsDelivery(operation.uid,{recipientUid:target,senderFingerprint,recipientFingerprint:captured.fingerprint,envelope},guard);guard();if(!['sent','received'].includes(confirmed.status))throw Error();toast.success(confirmed.status==='received'?'Leitura confirmada pelo destinatário.':'Cápsula cifrada aceite pelo relay. A receção aparece na caixa de enviados.');}
            guard();setMessage('');setAttachment(null);setRecipientId('');setRecipientKeyPem('');setRecipientLookup('');setResolvedRecipient(null);setHandshakeMode(false);
            if(!p2p)window.setTimeout(()=>{try{guard();onClose();}catch{/* A retired view never closes a newer composition. */}},400);
        }catch{if(operation.live()){toast.error(hasPendingCommsP2PContent(operation.uid)?'A cápsula cifrada foi conservada. Usa a recuperação P2P para confirmar, retomar ou cancelar.':hasPendingCommsDelivery(operation.uid)?'O pedido cifrado foi conservado. Usa a recuperação para confirmar ou cancelar o mesmo envio.':'Não foi possível confirmar o envio. Conserva a composição e verifica a caixa de enviados antes de repetir.');setHandshakeMode(false);}}
        finally{sendingRef.current=false;if(operation.live())setIsSending(false);}
    };
    const handleConfirmReceipt=async(msg:InboxMessage)=>{
        let operation:PanelOperation;try{operation=captureContactOperation();}catch{return;}
        if(receiptBusy||msg.deliveryUid!==operation.uid||msg.status!=='received'||msg.receiptConfirmed||!inboxMsgs.some(value=>value.id===msg.id&&value.deliveryUid===operation.uid))return;
        const captured={...msg};setReceiptBusy(msg.id);
        try{const result=captured.p2pDescriptor?await acknowledgeStoredCommsP2P(operation.uid,captured.p2pDescriptor.requestId,(envelope,guard)=>{if(!myIdentity)throw new PersonalMemoryMutationError();return decryptWithHistory(envelope,myIdentity,operation.uid,guard);},operation.guard):await acknowledgeCommsTransmission(operation.uid,captured.id,captured,operation.guard);operation.guard();if(result.updatedAt===null)throw new PersonalMemoryMutationError();const receivedAt=result.updatedAt;if(captured.p2pDescriptor)setP2pInboxState(old=>({scope:deliveryScope,unavailable:old.scope===deliveryScope?old.unavailable:0,messages:(old.scope===deliveryScope?old.messages:[]).map(value=>value.id===captured.id?{...value,receiptConfirmed:true,receivedAt}:value)}));else setInboxMsgs(current=>current.map(value=>value.id===captured.id?{...value,receiptConfirmed:true,receivedAt}:value));}
        catch{if(operation.live())toast.error('Não foi possível confirmar a leitura. Podes repetir o mesmo recibo.');}
        finally{if(operation.live())setReceiptBusy(null);}
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={isSending ? undefined : closePanel}
                        className="absolute inset-0 bg-[#020617]/90 backdrop-blur-xl"
                    />

                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="mnem-comms-panel relative flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-indigo-500/20 bg-[#0b1120]/85 shadow-[0_0_80px_rgba(99,102,241,0.15)] backdrop-blur-md sm:rounded-[2rem]"
                    >
                        <ObsidianImportRecoveryPanel />
                        <CommsImportRecoveryPanel />
                        <CommsIdentityRolloverPanel mnemonic={mnemonic} active={isOpen} isCurrent={identityPanelCurrent}/>
                        <CommsContactRecoveryPanel active={isOpen} isCurrent={identityPanelCurrent} onChanged={refreshRemovedContacts}/>
                        <CommsDeliveryRecoveryPanel active={isOpen} isCurrent={identityPanelCurrent}/>
                        <CommsP2PRecoveryPanel active={isOpen} isCurrent={identityPanelCurrent}/>
                        <CommsP2PContentRecoveryPanel active={isOpen} isCurrent={identityPanelCurrent} resume={p2pStatus==='open'?async()=>{const binding=peerBindingRef.current;if(!binding?.content)throw new PersonalMemoryMutationError();peerGuard(binding);return resumeCommsP2PContent(binding.operation.uid,binding.content,()=>peerGuard(binding));}:undefined}/>
                        {handshakeMode ? (
                            <div className="flex min-h-0 flex-1 flex-col items-center justify-center space-y-6 p-8 sm:p-16">
                                <div className="relative flex items-center justify-center">
                                    <motion.div 
                                        animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                                        transition={{ repeat: Infinity, duration: 2 }}
                                        className="absolute w-32 h-32 rounded-full border border-indigo-500/50"
                                    />
                                    <motion.div 
                                        animate={{ scale: [1, 2, 1], opacity: [0.3, 0, 0.3] }}
                                        transition={{ repeat: Infinity, duration: 2, delay: 0.5 }}
                                        className="absolute w-32 h-32 rounded-full border border-cyan-500/50"
                                    />
                                    <div className="w-16 h-16 rounded-full bg-indigo-500/20 flex items-center justify-center backdrop-blur-md z-10 border border-indigo-500/50">
                                        {isSending ? <Radar className="w-8 h-8 text-indigo-400 animate-spin" /> : <Lock className="w-8 h-8 text-green-400" />}
                                    </div>
                                </div>
                                <div className="text-center space-y-2">
                                    <h3 className="text-xl font-bold text-white tracking-widest uppercase">
                                        {isSending ? "A Cifrar Cápsula E2E" : "Transmissão Concluída"}
                                    </h3>
                                    <p className="text-sm text-indigo-300">
                                        {isSending ? "A preparar envelope AES-GCM e RSA-OAEP..." : "Cápsula encriptada entregue ao relay seguro."}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-white/5 p-3 sm:p-4 lg:p-5">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/20 to-purple-500/20">
                                            <Zap className="w-5 h-5 text-indigo-400" />
                                        </div>
                                        <div className="min-w-0">
                                            <h2 className="truncate text-base font-bold uppercase tracking-widest text-white sm:text-lg">{t('txTitle')}</h2>
                                            <p className="text-[10px] text-indigo-300/60 uppercase tracking-widest flex items-center gap-1 mt-0.5">
                                                <ShieldAlert className="w-3 h-3" /> Cifra ponta a ponta
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <div className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-1 custom-scrollbar">
                                        <button 
                                            onClick={() => setActiveTab('compose')}
                                            className={`flex-none rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors sm:px-4 ${activeTab === 'compose' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            {t('txCompose')}
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('contacts')}
                                            className={`flex flex-none items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors sm:px-4 ${activeTab === 'contacts' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            <Users className="w-3.5 h-3.5" /> {t('txContacts')}
                                            {incomingRequests.filter((request) => request.status === 'pending').length > 0 && (
                                                <span className="bg-cyan-400 text-black px-1.5 py-0.5 rounded-full text-[9px] leading-none">
                                                    {incomingRequests.filter((request) => request.status === 'pending').length}
                                                </span>
                                            )}
                                        </button>
                                        <button 
                                            onClick={() => setActiveTab('inbox')}
                                            className={`flex flex-none items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors sm:px-4 ${activeTab === 'inbox' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            <Inbox className="w-3.5 h-3.5" /> {t('txInbox')}
                                            {inboxMsgs.length > 0 && (
                                                <span className="bg-emerald-500 text-black px-1.5 py-0.5 rounded-full text-[9px] leading-none">{inboxMsgs.length}</span>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('sent')}
                                            className={`flex flex-none items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors sm:px-4 ${activeTab === 'sent' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            <Send className="w-3.5 h-3.5" /> {t('txSent')}
                                            {outboxMsgs.length > 0 && (
                                                <span className="bg-indigo-400 text-black px-1.5 py-0.5 rounded-full text-[9px] leading-none">{outboxMsgs.length}</span>
                                            )}
                                        </button>
                                        <button 
                                            onClick={() => setActiveTab('identity')}
                                            className={`flex flex-none items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors sm:px-4 ${activeTab === 'identity' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            <Lock className="w-3.5 h-3.5" /> {t('txKeys')}
                                        </button>
                                    </div>

                                    <button onClick={closePanel} className="rounded-full p-2 transition-colors hover:bg-white/10">
                                        <X className="w-5 h-5 text-gray-400" />
                                    </button>
                                </div>

                                {identityError && (
                                    <div className="mx-4 mt-4 shrink-0 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100 sm:mx-6">
                                        <div className="mb-2 flex items-center gap-2 font-bold">
                                            <ShieldAlert className="h-4 w-4" />
                                            Identidade local bloqueada
                                        </div>
                                        <p className="text-xs leading-relaxed text-amber-100/80">{identityError}</p>
                                        <button
                                            onClick={handleRepairIdentity}
                                            disabled={isRepairingIdentity || !mnemonic}
                                            className="mt-3 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-amber-50 transition hover:bg-amber-300/20 disabled:opacity-40"
                                        >
                                            {isRepairingIdentity ? 'A reparar...' : 'Regenerar identidade Comms'}
                                        </button>
                                    </div>
                                )}

                                {activeTab === 'compose' && (
                                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                                    <div className="mnem-comms-compose-scroll flex-1 space-y-3 overflow-y-auto p-3 pb-4 custom-scrollbar sm:space-y-4 sm:p-5 lg:p-6">
                                    {pageControls('contact-directory','contactos aceites')}{pageControls('contact-in','pedidos recebidos')}{pageControls('contact-out','pedidos enviados')}{pageControls('room-in','convites P2P')}
                                    <div className="mnem-comms-compact-card space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                                <Users className="w-3 h-3 text-cyan-400" /> Contactos aceites
                                            </label>
                                            <button
                                                onClick={() => setActiveTab('contacts')}
                                                className="text-[10px] font-bold uppercase tracking-widest text-cyan-300 hover:text-cyan-100"
                                            >
                                                Gerir
                                            </button>
                                        </div>
                                        {contacts.length === 0 ? (
                                            <p className="text-xs text-cyan-200/50">
                                                Ainda não há contactos aceites. Resolve um perfil público abaixo e envia um pedido.
                                            </p>
                                        ) : (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {contacts.map((contact) => (
                                                    <button
                                                        key={contact.uid}
                                                        onClick={() => selectRecipient(contact)}
                                                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${recipientId === contact.uid ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100' : 'border-white/10 bg-black/20 text-cyan-100 hover:border-cyan-400/30 hover:bg-cyan-500/10'}`}
                                                    >
                                                        <CheckCircle2 className="w-3.5 h-3.5 flex-none text-emerald-300" />
                                                        <span className="min-w-0 truncate text-xs font-mono">{contact.label}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                            <Fingerprint className="w-3 h-3 text-cyan-400" /> Resolver perfil público
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                value={recipientLookup}
                                                onChange={(e) => {
                                                    recipientRevision.current++;setRecipientLookup(e.target.value);
                                                    setResolvedRecipient(null);
                                                    setRecipientId('');
                                                    setRecipientKeyPem('');
                                                }}
                                                 className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#020617]/50 px-4 py-3 font-mono text-xs tracking-wide text-cyan-100 placeholder-cyan-900 outline-none transition-all focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/50"
                                                placeholder="email ou uid do destinatário"
                                            />
                                            <button
                                                onClick={resolveRecipient}
                                                disabled={isResolvingRecipient || !recipientLookup.trim()}
                                                 className="flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10 transition-colors hover:bg-cyan-500/20 disabled:opacity-40"
                                                title="Resolver destinatário"
                                            >
                                                <Search className={`w-4 h-4 text-cyan-300 ${isResolvingRecipient ? 'animate-pulse' : ''}`} />
                                            </button>
                                        </div>
                                        {resolvedRecipient && (
                                            <div className="flex items-center justify-between gap-3 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <CheckCircle2 className="w-3.5 h-3.5 flex-none" />
                                                    <span className="truncate">Chave pública encontrada para {resolvedRecipient.label}</span>
                                                </div>
                                                {existingRequestForResolvedRecipient?.status === 'accepted' ? (
                                                    <span className="flex-none text-[10px] uppercase tracking-widest text-emerald-200">Contacto</span>
                                                ) : (
                                                    <button
                                                        onClick={requestContact}
                                                        disabled={!COMMS_CONTACT_WRITES_ENABLED || hasPendingCommsContact(viewUid??'') || isRequestingContact || existingRequestForResolvedRecipient?.status === 'pending'}
                                                        className="flex flex-none items-center gap-1.5 rounded-md border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
                                                    >
                                                        <UserPlus className="w-3 h-3" />
                                                        {existingRequestForResolvedRecipient?.status === 'pending' ? 'Pendente' : 'Pedir contacto'}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {(incomingRooms.length > 0 || resolvedRecipient || p2pStatus==='open' || p2pStatus==='connecting' || p2pStatus==='offering') && (
                                        <div className="space-y-3 rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                    <Radio className="w-4 h-4 text-cyan-300" />
                                                    <div>
                                                        <p className="text-xs font-bold uppercase tracking-widest text-cyan-100">Canal P2P WebRTC</p>
                                                        <p className="text-[10px] text-cyan-300/70">
                                                            {p2pStatus === 'open' ? 'Canal direto ativo.' :
                                                                p2pStatus === 'connecting' || p2pStatus === 'offering' ? 'A negociar offer/answer e candidatos ICE.' :
                                                                    p2pStatus === 'error' ? 'Falha no canal direto. Podes usar o relay E2E.' :
                                                                        'Opcional: abrir canal direto antes de transmitir.'}
                                                        </p>
                                                    </div>
                                                </div>

                                                {p2pStatus === 'open' ? (
                                                    <button
                                                        onClick={() => void closeP2P()}
                                                        className="px-3 py-2 rounded-lg bg-red-500/10 text-red-200 border border-red-500/20 text-[10px] font-bold uppercase tracking-widest hover:bg-red-500/20"
                                                    >
                                                        Fechar
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={startP2PChannel}
                                                        disabled={!myIdentity || !COMMS_P2P_WRITES_ENABLED || hasPendingCommsP2P(viewUid??'') || hasStoredCommsP2PSession(viewUid??'') || !resolvedRecipient || p2pStatus === 'connecting' || p2pStatus === 'offering'}
                                                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 text-cyan-100 border border-cyan-500/20 text-[10px] font-bold uppercase tracking-widest hover:bg-cyan-500/20 disabled:opacity-40"
                                                    >
                                                        <PlugZap className="w-3.5 h-3.5" />
                                                        Abrir P2P
                                                    </button>
                                                )}
                                            </div>

                                            {incomingRooms.length > 0 && (
                                                <div className="space-y-2">
                                                    {incomingRooms.map((room) => (
                                                        <div key={room.id} className="flex items-center justify-between gap-3 rounded-lg bg-black/20 border border-white/10 px-3 py-2">
                                                            <span className="min-w-0 truncate text-[11px] text-cyan-100">
                                                                Pedido de {room.callerLabel || room.callerId}
                                                            </span>
                                                            <button
                                                                onClick={() => void acceptP2PChannel(room)}
                                                                disabled={!myIdentity || !COMMS_P2P_WRITES_ENABLED || hasPendingCommsP2P(viewUid??'') || hasStoredCommsP2PSession(viewUid??'')}
                                                                className="px-3 py-1.5 rounded-md bg-emerald-500/10 text-emerald-200 border border-emerald-500/20 text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500/20"
                                                            >
                                                                Aceitar
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                            <Fingerprint className="w-3 h-3 text-indigo-400" /> Chave Pública Resolvida (PEM)
                                        </label>
                                        <textarea
                                            value={recipientKeyPem}
                                            onChange={(e) => {recipientRevision.current++;setResolvedRecipient(null);setRecipientKeyPem(e.target.value);}}
                                            className="mnem-comms-pem h-16 w-full rounded-xl border border-white/10 bg-[#020617]/50 px-4 py-3 font-mono text-[10px] tracking-wide text-indigo-100 placeholder-indigo-900 outline-none transition-all focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/50 custom-scrollbar sm:h-20"
                                            placeholder="resolve o destinatário para preencher a chave pública"
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                            <FileText className="w-3 h-3 text-indigo-400" /> Carga Cognitiva
                                        </label>
                                        <textarea
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            className="mnem-comms-message h-24 w-full resize-none rounded-xl border border-white/10 bg-[#020617]/50 p-4 text-sm font-light leading-relaxed text-indigo-100 placeholder-indigo-900 outline-none transition-all focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/50 custom-scrollbar sm:h-28"
                                            placeholder="Escreva a mensagem ou pensamento a encapsular..."
                                        />
                                    </div>
                                    </div>

                                    <div className="mnem-comms-actionbar shrink-0 space-y-3 border-t border-white/10 bg-[#0b1120]/95 p-3 shadow-[0_-20px_40px_rgba(2,6,23,0.55)] backdrop-blur-xl sm:px-5 lg:px-6">
                                    {attachment && (
                                        <motion.div 
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="flex items-center gap-3 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl"
                                        >
                                            <div className="p-2 bg-indigo-500/20 rounded-lg">
                                                <FileText className="w-4 h-4 text-indigo-400" />
                                            </div>
                                            <span className="text-xs text-indigo-200 truncate flex-1 font-mono">{attachment.name}</span>
                                            <button onClick={() => setAttachment(null)} className="p-1 hover:bg-indigo-500/20 rounded-lg text-indigo-400 transition-colors">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </motion.div>
                                    )}

                                    <div className="flex items-center gap-3">
                                        <label className="group relative flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors hover:bg-white/10">
                                            <input 
                                                type="file" 
                                                className="hidden" 
                                                onChange={(e) => {
                                                    if (e.target.files && e.target.files[0]) {
                                                        const file=e.target.files[0];if(file.size>COMMS_MAX_ATTACHMENT_BYTES){toast.error('Usa um anexo até 256 KiB.');e.target.value='';return;}setAttachment(file);
                                                    }
                                                }}
                                            />
                                            <Paperclip className="w-5 h-5 text-gray-400 group-hover:text-indigo-400 transition-colors" />
                                            {/* Tooltip */}
                                            <span className="absolute -top-8 bg-black/80 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                                                Anexar Ficheiro
                                            </span>
                                        </label>
                                        
                                        <button
                                            onClick={handleSend}
                                            disabled={isSending || hasPendingCommsP2PContent(viewUid??'') || hasPendingCommsP2P(viewUid??'') || hasPendingCommsDelivery(viewUid??'') || (p2pStatus==='open'?!COMMS_P2P_WRITES_ENABLED:!COMMS_DELIVERY_WRITES_ENABLED) || !myIdentity || !resolvedRecipient || resolvedRecipient.uid!==recipientId || (!message.trim() && !attachment) || !recipientId.trim() || !recipientKeyPem.trim()}
                                            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-bold uppercase tracking-widest text-white shadow-[0_0_20px_rgba(79,70,229,0.3)] transition-all hover:bg-indigo-500 disabled:bg-white/5 disabled:text-gray-500 disabled:opacity-40 disabled:shadow-none"
                                        >
                                            <Send className="w-4 h-4" /> {p2pStatus === 'open' ? 'Transmitir P2P' : 'Transmitir Relay E2E'}
                                        </button>
                                    </div>
                                    </div>
                                    </div>
                                )}

                                {activeTab === 'contacts' && (
                                    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 custom-scrollbar sm:p-6">
                                        {pageControls('contact-directory','contactos aceites')}{pageControls('contact-in','pedidos recebidos')}{pageControls('contact-out','pedidos enviados')}
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <Inbox className="w-4 h-4 text-cyan-300" />
                                                <h3 className="text-xs font-bold uppercase tracking-widest text-cyan-100">Pedidos recebidos</h3>
                                            </div>
                                            {incomingRequests.filter((request) => request.status === 'pending').length === 0 ? (
                                                <p className="text-xs text-cyan-200/45 rounded-xl border border-white/10 bg-black/20 p-3">
                                                    Nenhum pedido pendente.
                                                </p>
                                            ) : (
                                                incomingRequests.filter((request) => request.status === 'pending').map((request) => (
                                                    <div key={request.id} className="flex items-center justify-between gap-3 rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3">
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm text-cyan-100">{request.fromLabel}</p>
                                                            <p className="truncate text-[10px] font-mono text-cyan-300/50">{request.fromUid}</p>
                                                        </div>
                                                        <div className="flex flex-none items-center gap-2">
                                                            <button
                                                                disabled={!COMMS_CONTACT_WRITES_ENABLED}
                                                                onClick={() => void respondToContactRequest(request, 'accepted')}
                                                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                                                                title="Aceitar contacto"
                                                            >
                                                                <Check className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                disabled={!COMMS_CONTACT_WRITES_ENABLED}
                                                                onClick={() => void respondToContactRequest(request, 'rejected')}
                                                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-400/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                                                                title="Rejeitar contacto"
                                                            >
                                                                <XCircle className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <Users className="w-4 h-4 text-emerald-300" />
                                                <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-100">Contactos aceites</h3>
                                            </div>
                                            <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();void findAcceptedContact();}}>
                                                <label className="flex flex-1 flex-col gap-1 text-xs text-emerald-100">UID ou email do contacto
                                                    <input value={contactLookup} onChange={event=>{searchRevision.current++;setContactLookup(event.target.value);setContactSearch(null);}} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2" />
                                                </label>
                                                <button type="submit" disabled={!contactLookup.trim()||currentContactSearch?.busy} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">Procurar contacto aceite</button>
                                                <button type="button" disabled={!contactLookup&&!currentContactSearch} onClick={()=>{searchRevision.current++;setContactLookup('');setContactSearch(null);}} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">Ver diretório</button>
                                            </form>
                                            {currentContactSearch?.busy&&<p role="status">A procurar contacto aceite…</p>}
                                            {currentContactSearch?.error&&<p role="alert">Não foi possível procurar o contacto. Tenta novamente.</p>}
                                            {currentContactSearch&&currentContactSearch.unavailable>0&&<p role="status">{currentContactSearch.unavailable} registo(s) aceite(s) desta página estão indisponíveis.</p>}
                                            {currentContactSearch?.next&&<button type="button" onClick={()=>void findAcceptedContact(currentContactSearch.next)} className="rounded-lg border px-3 py-2 text-xs">Continuar procura</button>}
                                            {currentContactSearch?.busy||currentContactSearch?.error?null:displayedContacts.length === 0 ? (
                                                <p className="text-xs text-emerald-200/45 rounded-xl border border-white/10 bg-black/20 p-3">
                                                    {currentContactSearch?'Nenhum contacto aceite disponível nesta página da procura.':'A lista fica disponível depois de um pedido ser aceite.'}
                                                </p>
                                            ) : (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    {displayedContacts.map((contact) => (
                                                        <div key={contact.uid} className="flex items-center gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-3 py-3 text-emerald-100">
                                                        <button type="button" aria-label={contact.label}
                                                            onClick={() => selectRecipient(contact)}
                                                            className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-emerald-200"
                                                        >
                                                            <CheckCircle2 className="w-4 h-4 flex-none text-emerald-300" />
                                                            <span className="min-w-0 text-xs font-mono"><span className="block truncate">{contact.label}</span><span className="block truncate text-[10px] text-emerald-100/50">{contact.uid}</span></span>
                                                        </button>
                                                        <button type="button" aria-label={`Retirar ${contact.label}`} disabled={!COMMS_CONTACT_WRITES_ENABLED||contactRemovalBusy||hasPendingCommsContactRemoval(viewUid??'')} onClick={()=>void removeContact(contact)} className="rounded-lg border border-rose-300/20 px-2 py-2 text-xs text-rose-100 disabled:opacity-40">Retirar</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <UserPlus className="w-4 h-4 text-indigo-300" />
                                                <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-100">Pedidos enviados</h3>
                                            </div>
                                            {outgoingRequests.filter((request) => request.status === 'pending').length === 0 ? (
                                                <p className="text-xs text-indigo-200/45 rounded-xl border border-white/10 bg-black/20 p-3">
                                                    Nenhum pedido enviado em espera.
                                                </p>
                                            ) : (
                                                outgoingRequests.filter((request) => request.status === 'pending').map((request) => (
                                                    <div key={request.id} className="rounded-xl border border-indigo-500/15 bg-indigo-500/5 p-3">
                                                        <p className="truncate text-sm text-indigo-100">{request.toLabel}</p>
                                                        <p className="truncate text-[10px] font-mono text-indigo-300/50">{request.toUid}</p>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'inbox' && (
                                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 custom-scrollbar sm:p-6">
                                        <section aria-label="Páginas P2P locais" className="space-y-2 text-xs text-white/70"><div className="flex flex-wrap items-center gap-2"><span>P2P neste dispositivo · página {p2pHistory.length+1}</span><button type="button" disabled={p2pInboxBusy||!p2pHistory.length} onClick={()=>{const history=[...p2pHistory],previous=history.pop()??null;setP2pHistory(history);setP2pCursor(previous);}} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button><button type="button" disabled={p2pInboxBusy||!p2pNext} onClick={()=>{setP2pHistory(history=>[...history,p2pCursor]);setP2pCursor(p2pNext);}} className="rounded border px-3 py-2 disabled:opacity-40">Seguinte</button><button type="button" disabled={p2pInboxBusy} onClick={()=>setP2pInboxRevision(value=>value+1)} className="rounded border px-3 py-2 disabled:opacity-40">Atualizar</button></div>{p2pInboxState.scope===deliveryScope&&p2pInboxState.unavailable>0&&<p role="status" aria-live="polite">{p2pInboxState.unavailable} cópia(s) P2P desta página estão indisponíveis. As cápsulas cifradas foram conservadas.</p>}{p2pInboxError&&<p role="alert">Não foi possível abrir a página P2P local. As cápsulas cifradas foram conservadas.</p>}</section>
                                        {pageControls('relay-in','cápsulas recebidas')}
                                        {inboxMsgs.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                                                <Radar className="w-12 h-12 text-indigo-400 mb-4 animate-pulse" />
                                                <p className="text-sm font-mono text-indigo-200">A escutar frequências no éter...</p>
                                                <p className="text-[10px] uppercase tracking-widest mt-2 text-indigo-400/50">Nenhuma cápsula detetada</p>
                                            </div>
                                        ) : (
                                            inboxMsgs.map((msg) => (
                                                <motion.div 
                                                    initial={{ opacity: 0, x: -20 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    key={msg.id} 
                                                    className="p-4 rounded-xl bg-[#020617]/50 border border-white/10 hover:border-indigo-500/50 transition-colors relative group"
                                                >
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div className="flex items-center gap-2">
                                                            <Fingerprint className="w-4 h-4 text-emerald-400" />
                                                            <span className="text-[10px] font-mono text-emerald-400/80 uppercase tracking-widest bg-emerald-500/10 px-2 py-0.5 rounded truncate max-w-[150px]">
                                                                De: {msg.senderId.slice(0, 12)}...
                                                            </span>
                                                            <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border ${getTransmissionStatusClasses(msg.status)}`}>
                                                                {getTransmissionStatusLabel(msg.status)}
                                                            </span>
                                                            {msg.status==='received'&&!msg.receiptConfirmed&&<button type="button" disabled={receiptBusy!==null} onClick={()=>void handleConfirmReceipt(msg)} className="rounded border border-amber-300/30 px-2 py-1 text-[10px] text-amber-100 disabled:opacity-40">{receiptBusy===msg.id?'A confirmar leitura…':'Confirmar leitura'}</button>}
                                                        </div>
                                                        <span className="text-[10px] text-gray-500 font-mono">
                                                            {new Date(msg.timestamp).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                    
                                                    <div className="text-sm text-indigo-100 font-mono bg-black/40 p-3 rounded-lg border border-white/5 break-words">
                                                        {msg.decryptedMessage}
                                                    </div>

                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        <button
                                                            onClick={() => handleImportMemory(msg.id, msg.decryptedMessage, msg.decryptedAttachment || null)}
                                                            disabled={importingMsgId === msg.id}
                                                            className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:opacity-50"
                                                        >
                                                            {importingMsgId === msg.id ? (
                                                                <>
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                    <span>A Importar...</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <PlugZap className="w-3.5 h-3.5 text-indigo-400" />
                                                                    <span>
                                                                        {msg.decryptedMessage.includes('[[MNEMOSYNE_CAPSULE_PACK_V1]]')
                                                                            ? 'Importar pack'
                                                                            : 'Importar no Universo'}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </button>

                                                        {msg.decryptedAttachment ? (
                                                            <a
                                                                href={msg.decryptedAttachment.dataUrl}
                                                                download={msg.decryptedAttachment.name}
                                                                className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 transition-colors hover:bg-emerald-500/20"
                                                            >
                                                                <FileText className="w-3.5 h-3.5 text-emerald-300" />
                                                                Descarregar {msg.decryptedAttachment.name}
                                                            </a>
                                                        ) : msg.hasAttachment && (
                                                            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200">
                                                                <FileText className="w-3.5 h-3.5 text-amber-300" />
                                                                Anexo recebido, mas não foi possível decifrar nesta sessão.
                                                            </div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            ))
                                        )}
                                    </div>
                                )}

                                {activeTab === 'sent' && (
                                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 custom-scrollbar sm:p-6">
                                        {pageControls('relay-out','cápsulas enviadas')}
                                        {outboxMsgs.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                                                <Send className="w-12 h-12 text-indigo-400 mb-4" />
                                                <p className="text-sm font-mono text-indigo-200">Nenhuma cápsula enviada ainda.</p>
                                                <p className="text-[10px] uppercase tracking-widest mt-2 text-indigo-400/50">Usa Atualizar para confirmar novos estados.</p>
                                            </div>
                                        ) : (
                                            outboxMsgs.map((msg) => (
                                                <motion.div
                                                    initial={{ opacity: 0, x: 20 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    key={msg.id}
                                                    className="p-4 rounded-xl bg-[#020617]/50 border border-white/10 hover:border-indigo-500/50 transition-colors relative group"
                                                >
                                                    <div className="flex justify-between items-start mb-3">
                                                        <div className="flex items-center gap-2">
                                                            <Fingerprint className="w-4 h-4 text-indigo-400" />
                                                            <span className="text-[10px] font-mono text-indigo-300/80 uppercase tracking-widest bg-indigo-500/10 px-2 py-0.5 rounded truncate max-w-[150px]">
                                                                Para: {msg.recipientId.slice(0, 12)}...
                                                            </span>
                                                            <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border ${getTransmissionStatusClasses(msg.status)}`}>
                                                                {getTransmissionStatusLabel(msg.status)}
                                                            </span>
                                                        </div>
                                                        <span className="text-[10px] text-gray-500 font-mono">
                                                            {new Date(msg.timestamp).toLocaleTimeString()}
                                                        </span>
                                                    </div>

                                                    <div className="text-xs text-gray-400 font-mono bg-black/30 p-3 rounded-lg border border-white/5">
                                                        {msg.status === 'sent' && 'Cápsula guardada no relay E2E; aguarda abertura pelo destinatário.'}
                                                        {msg.status === 'received' && 'Destinatário abriu a inbox e decriptou a cápsula com sucesso.'}
                                                        {msg.status === 'failed' && 'O destinatário tentou abrir, mas a decriptação falhou.'}
                                                        {msg.status === 'p2p' && 'Transmitida por canal P2P aberto, sem persistência no relay.'}
                                                    </div>

                                                    {msg.hasAttachment && (
                                                        <div className="mt-3 flex items-center gap-2 text-xs text-indigo-300 bg-indigo-500/10 p-2 rounded-lg w-max border border-indigo-500/20">
                                                            <FileText className="w-3.5 h-3.5 text-indigo-400" />
                                                            {msg.attachmentName || 'Anexo cifrado'}
                                                        </div>
                                                    )}
                                                </motion.div>
                                            ))
                                        )}
                                    </div>
                                )}

                                {activeTab === 'identity' && (
                                    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 custom-scrollbar sm:p-8">
                                        <div className="text-center space-y-2 mb-6">
                                            <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-indigo-500/30">
                                                <Lock className="w-8 h-8 text-indigo-400" />
                                            </div>
                                            <h3 className="text-lg font-bold text-white tracking-widest uppercase">A Sua Identidade</h3>
                                            <p className="text-xs text-indigo-300">As suas chaves RSA-OAEP são geradas localmente. A chave privada fica apenas em memória nesta sessão; a chave pública é publicada no teu perfil para descoberta segura.</p>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex justify-between items-center">
                                                <span>UID da conta</span>
                                                <button onClick={() => {
                                                    const uid = auth.currentUser?.uid;
                                                    if (uid) navigator.clipboard.writeText(uid);
                                                }} className="text-indigo-400 hover:text-indigo-300 underline">Copiar UID</button>
                                            </label>
                                            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 font-mono text-xs text-cyan-100 break-all">
                                                {auth.currentUser?.uid || 'UID indisponível'}
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex justify-between items-center">
                                                <span>A Sua Chave Pública (Para Partilhar)</span>
                                                <button onClick={() => {
                                                    if(myIdentity) navigator.clipboard.writeText(myIdentity.pemPublic);
                                                    toast.success(t('txCopied'));
                                                }} className="text-indigo-400 hover:text-indigo-300 underline">Copiar</button>
                                            </label>
                                            <textarea
                                                readOnly
                                                value={myIdentity?.pemPublic || "A gerar chaves RSA..."}
                                                className="w-full h-32 bg-black/60 text-emerald-400 border border-emerald-500/20 rounded-xl px-4 py-3 outline-none font-mono text-[9px] custom-scrollbar cursor-text break-all"
                                            />
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
