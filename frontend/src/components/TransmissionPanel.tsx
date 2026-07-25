import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Lock, Zap, ShieldAlert, Paperclip, FileText, Radar, Fingerprint, Inbox, Search, CheckCircle2, Radio, PlugZap, Users, UserPlus, Check, XCircle } from 'lucide-react';
import { db, auth } from '../firebase';
import { collection, addDoc, query, where, onSnapshot, doc, setDoc, serverTimestamp, getDoc, getDocs, limit, updateDoc, type Unsubscribe } from 'firebase/firestore';
import { getOrCreateIdentity, importPublicKey, rsaEncrypt, rsaDecrypt, encryptBytesAesGcm, sha256Hex } from '../utils/crypto';
import { getRtcConfiguration } from '../services/rtcConfig';

export interface TransmissionDraft {
    memoryId?: string;
    title?: string;
    text: string;
}

interface TransmissionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    mnemonic: string[] | null;
    initialDraft?: TransmissionDraft | null;
}

interface P2PRoom {
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
}

interface FriendRequest {
    id: string;
    fromUid: string;
    toUid: string;
    fromLabel: string;
    toLabel: string;
    status: 'pending' | 'accepted' | 'rejected';
    createdAt: number;
    updatedAt: number;
}

interface ContactProfile {
    uid: string;
    label: string;
    publicKeyPem: string;
    requestId: string;
}

type EncryptedTransmissionData = Partial<TransmissionEnvelope> & {
    encryptedData?: string;
    senderId?: string;
    recipientId?: string;
    timestamp?: number;
    status?: TransmissionStatus;
    receivedAt?: number;
};

type TransmissionStatus = 'sent' | 'received' | 'failed' | 'p2p';

type InboxMessage = EncryptedTransmissionData & {
    id: string;
    senderId: string;
    timestamp: number;
    status: TransmissionStatus;
    decryptedMessage: string;
};

type OutboxMessage = EncryptedTransmissionData & {
    id: string;
    recipientId: string;
    timestamp: number;
    status: TransmissionStatus;
};

export const TransmissionPanel: React.FC<TransmissionPanelProps> = ({ isOpen, onClose, mnemonic, initialDraft }) => {
    const [activeTab, setActiveTab] = useState<'compose' | 'contacts' | 'inbox' | 'sent' | 'identity'>('compose');
    const [inboxMsgs, setInboxMsgs] = useState<InboxMessage[]>([]);
    const [outboxMsgs, setOutboxMsgs] = useState<OutboxMessage[]>([]);
    const [recipientId, setRecipientId] = useState('');
    const [recipientKeyPem, setRecipientKeyPem] = useState('');
    const [recipientLookup, setRecipientLookup] = useState('');
    const [resolvedRecipient, setResolvedRecipient] = useState<{ uid: string, label: string } | null>(null);
    const [isResolvingRecipient, setIsResolvingRecipient] = useState(false);
    const [isRequestingContact, setIsRequestingContact] = useState(false);
    const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
    const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
    const [contacts, setContacts] = useState<ContactProfile[]>([]);
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [attachment, setAttachment] = useState<File | null>(null);
    const [handshakeMode, setHandshakeMode] = useState(false);
    const [incomingRooms, setIncomingRooms] = useState<P2PRoom[]>([]);
    const [p2pStatus, setP2pStatus] = useState<'idle' | 'offering' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
    const [p2pRoomId, setP2pRoomId] = useState<string | null>(null);
    
    // Criptografia
    const [myIdentity, setMyIdentity] = useState<{ publicKey: CryptoKey, privateKey: CryptoKey, pemPublic: string } | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const dataChannelRef = useRef<RTCDataChannel | null>(null);
    const p2pUnsubscribersRef = useRef<Unsubscribe[]>([]);

    const formatMemoryDraft = (draft: TransmissionDraft): string => {
        const title = draft.title?.trim() || 'Memória Mnemosyne';
        return [
            `Memória partilhada: ${title}`,
            draft.memoryId ? `ID: ${draft.memoryId}` : null,
            '',
            draft.text,
        ].filter((line): line is string => line !== null).join('\n');
    };

    const selectRecipient = (profile: PublicProfile | ContactProfile) => {
        const label = 'label' in profile ? profile.label : profile.displayName || profile.uid;
        setRecipientId(profile.uid);
        setRecipientKeyPem(profile.publicKeyPem);
        setRecipientLookup(label);
        setResolvedRecipient({ uid: profile.uid, label });
        setActiveTab('compose');
    };

    const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return window.btoa(binary);
    };

    const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
        const binary = window.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    };

    const importAesKeyFromBase64 = async (base64Key: string): Promise<CryptoKey> => (
        window.crypto.subtle.importKey(
            'raw',
            base64ToArrayBuffer(base64Key),
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        )
    );

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

    const decryptEnvelope = async (data: EncryptedTransmissionData, privateKey: CryptoKey): Promise<string> => {
        if (data.encryptedKey && data.encryptedPayload && data.payloadIv) {
            const rawAesKeyBase64 = await rsaDecrypt(data.encryptedKey, privateKey);
            const aesKey = await importAesKeyFromBase64(rawAesKeyBase64);
            const plaintextBytes = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(data.payloadIv)) },
                aesKey,
                base64ToArrayBuffer(data.encryptedPayload)
            );
            const payload = JSON.parse(new TextDecoder().decode(plaintextBytes));
            return payload.message || '[Transmissão sem texto]';
        }

        if (data.encryptedData) {
            return rsaDecrypt(data.encryptedData, privateKey);
        }

        return 'Formato de transmissão desconhecido.';
    };

    const clearP2PSubscriptions = () => {
        p2pUnsubscribersRef.current.forEach((unsubscribe) => unsubscribe());
        p2pUnsubscribersRef.current = [];
    };

    const closeP2P = async (markClosed = true) => {
        clearP2PSubscriptions();
        dataChannelRef.current?.close();
        peerConnectionRef.current?.close();
        dataChannelRef.current = null;
        peerConnectionRef.current = null;
        setP2pStatus('closed');

        if (markClosed && p2pRoomId) {
            try {
                await updateDoc(doc(db, 'p2pRooms', p2pRoomId), {
                    status: 'closed',
                    updatedAt: Date.now(),
                });
            } catch (error) {
                console.warn('Unable to mark P2P room as closed', error);
            }
        }

        setP2pRoomId(null);
    };

    const buildEncryptedEnvelope = async (): Promise<TransmissionEnvelope> => {
        const recipientPubKey = await importPublicKey(recipientKeyPem.trim());
        const envelopeKey = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
        const rawEnvelopeKey = await window.crypto.subtle.exportKey('raw', envelopeKey);
        const encryptedKey = await rsaEncrypt(arrayBufferToBase64(rawEnvelopeKey), recipientPubKey);

        let encryptedAttachment: Record<string, string | number> | null = null;
        if (attachment) {
            const encrypted = await encryptBytesAesGcm(await attachment.arrayBuffer(), envelopeKey);
            encryptedAttachment = {
                name: attachment.name,
                type: attachment.type || 'application/octet-stream',
                size: attachment.size,
                iv: encrypted.iv,
                data: arrayBufferToBase64(encrypted.cipherBytes),
            };
        }

        const payloadBytes = new TextEncoder().encode(JSON.stringify({
            message,
            attachment: encryptedAttachment,
        }));
        const payloadBuffer = payloadBytes.buffer.slice(payloadBytes.byteOffset, payloadBytes.byteOffset + payloadBytes.byteLength) as ArrayBuffer;
        const encryptedPayload = await encryptBytesAesGcm(payloadBuffer, envelopeKey);

        return {
            encryptedKey,
            encryptedPayload: arrayBufferToBase64(encryptedPayload.cipherBytes),
            payloadIv: encryptedPayload.iv,
            hasAttachment: !!attachment,
            attachmentName: attachment ? attachment.name : null,
        };
    };

    const attachCandidateListener = (roomId: string, collectionName: 'callerCandidates' | 'calleeCandidates') => {
        const unsubscribe = onSnapshot(collection(db, 'p2pRooms', roomId, collectionName), (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type !== 'added') return;
                const candidate = change.doc.data().candidate as RTCIceCandidateInit | undefined;
                if (candidate && peerConnectionRef.current?.remoteDescription) {
                    peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
                        console.warn('ICE candidate rejected', error);
                    });
                }
            });
        });
        p2pUnsubscribersRef.current.push(unsubscribe);
    };

    const wireDataChannel = (channel: RTCDataChannel) => {
        dataChannelRef.current = channel;
        channel.onopen = () => setP2pStatus('open');
        channel.onclose = () => setP2pStatus('closed');
        channel.onerror = () => setP2pStatus('error');
        channel.onmessage = async (event) => {
            if (!myIdentity?.privateKey) return;
            try {
                const payload = JSON.parse(event.data) as EncryptedTransmissionData & { type?: string };
                if (payload.type !== 'mnemosyne-transmission') return;
                const decryptedMessage = await decryptEnvelope(payload, myIdentity.privateKey);
                setInboxMsgs((current) => [{
                    id: `p2p-${Date.now()}`,
                    ...payload,
                    timestamp: payload.timestamp || Date.now(),
                    senderId: payload.senderId || 'desconhecido',
                    status: 'p2p',
                    decryptedMessage,
                }, ...current]);
            } catch (error) {
                console.error('P2P message decrypt failed', error);
            }
        };
    };

    const createPeerConnection = (roomId: string, role: 'caller' | 'callee'): RTCPeerConnection => {
        const pc = new RTCPeerConnection(getRtcConfiguration());
        peerConnectionRef.current = pc;

        pc.onicecandidate = async (event) => {
            if (!event.candidate || !auth.currentUser) return;
            await addDoc(collection(db, 'p2pRooms', roomId, role === 'caller' ? 'callerCandidates' : 'calleeCandidates'), {
                uid: auth.currentUser.uid,
                candidate: event.candidate.toJSON(),
                createdAt: Date.now(),
            });
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'connected') setP2pStatus('open');
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setP2pStatus('error');
            if (pc.connectionState === 'closed') setP2pStatus('closed');
        };

        return pc;
    };

    useEffect(() => {
        if (isOpen) {
            getOrCreateIdentity(auth.currentUser?.uid ?? 'session', mnemonic).then(async identity => {
                setMyIdentity(identity);
                const user = auth.currentUser;
                if (user) {
                    const emailHash = user.email ? await sha256Hex(user.email) : null;
                    await setDoc(doc(db, 'users', user.uid), {
                        publicKeyPem: identity.pemPublic,
                        publicKeyUpdatedAt: serverTimestamp(),
                    }, { merge: true });
                    await setDoc(doc(db, 'publicProfiles', user.uid), {
                        uid: user.uid,
                        displayName: user.displayName || user.email?.split('@')[0] || 'Mnemosyne User',
                        emailHash,
                        publicKeyPem: identity.pemPublic,
                        publicKeyUpdatedAt: serverTimestamp(),
                    }, { merge: true });
                }
            }).catch((error) => {
                console.error('Identity unlock failed', error);
                alert(error instanceof Error ? error.message : 'Não foi possível desbloquear a identidade local.');
                onClose();
            });
        }
    }, [isOpen, mnemonic, onClose]);

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
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !initialDraft) return;
        setMessage(formatMemoryDraft(initialDraft));
        setAttachment(null);
        setActiveTab('compose');
    }, [isOpen, initialDraft]);

    useEffect(() => {
        if (!isOpen || !auth.currentUser || !myIdentity) return;
        const q = query(collection(db, 'transmissions'), where('recipientId', '==', auth.currentUser.uid));
        const unsubscribe = onSnapshot(q, async (snapshot) => {
            const msgs = await Promise.all(snapshot.docs.map(async (transmissionDoc) => {
                const data = transmissionDoc.data() as EncryptedTransmissionData;
                let decrypted = "Erro a desencriptar. Chave privada inválida?";
                let nextStatus: TransmissionStatus = data.status || 'sent';
                try {
                    if ((data.encryptedPayload || data.encryptedData) && myIdentity.privateKey) {
                        decrypted = await decryptEnvelope(data, myIdentity.privateKey);
                        if (data.status === 'sent') {
                            nextStatus = 'received';
                            await updateDoc(doc(db, 'transmissions', transmissionDoc.id), {
                                status: 'received',
                                receivedAt: Date.now(),
                            });
                        }
                    }
                } catch (error) {
                    console.error("Failed to decrypt msg", error);
                    nextStatus = 'failed';
                    if (data.status === 'sent') {
                        await updateDoc(doc(db, 'transmissions', transmissionDoc.id), {
                            status: 'failed',
                            receivedAt: Date.now(),
                        }).catch((updateError) => {
                            console.warn('Unable to mark transmission as failed', updateError);
                        });
                    }
                }
                return {
                    id: transmissionDoc.id,
                    ...data,
                    senderId: data.senderId || 'desconhecido',
                    timestamp: data.timestamp || Date.now(),
                    status: nextStatus,
                    decryptedMessage: decrypted,
                };
            }));
            msgs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setInboxMsgs(msgs);
        });
        return () => unsubscribe();
    }, [isOpen, myIdentity]);

    useEffect(() => {
        if (!isOpen || !auth.currentUser) return;
        const q = query(collection(db, 'transmissions'), where('senderId', '==', auth.currentUser.uid));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map((transmissionDoc) => {
                const data = transmissionDoc.data() as EncryptedTransmissionData;
                return {
                    id: transmissionDoc.id,
                    ...data,
                    recipientId: data.recipientId || 'desconhecido',
                    timestamp: data.timestamp || Date.now(),
                    status: data.status || 'sent',
                };
            });
            msgs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            setOutboxMsgs(msgs);
        });
        return () => unsubscribe();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !auth.currentUser) return;
        const q = query(collection(db, 'p2pRooms'), where('calleeId', '==', auth.currentUser.uid));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const rooms = snapshot.docs
                .map((roomDoc) => ({ id: roomDoc.id, ...roomDoc.data() } as P2PRoom))
                .filter((room) => room.status === 'offer');
            setIncomingRooms(rooms);
        });
        return () => unsubscribe();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !auth.currentUser) return;
        const uid = auth.currentUser.uid;
        const outgoingQuery = query(collection(db, 'friendRequests'), where('fromUid', '==', uid));
        const incomingQuery = query(collection(db, 'friendRequests'), where('toUid', '==', uid));

        const outgoingUnsubscribe = onSnapshot(outgoingQuery, (snapshot) => {
            setOutgoingRequests(snapshot.docs.map((requestDoc) => ({
                id: requestDoc.id,
                ...requestDoc.data(),
            } as FriendRequest)));
        });

        const incomingUnsubscribe = onSnapshot(incomingQuery, (snapshot) => {
            setIncomingRequests(snapshot.docs.map((requestDoc) => ({
                id: requestDoc.id,
                ...requestDoc.data(),
            } as FriendRequest)));
        });

        return () => {
            outgoingUnsubscribe();
            incomingUnsubscribe();
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !auth.currentUser) {
            setContacts([]);
            return;
        }

        let cancelled = false;
        const uid = auth.currentUser.uid;
        const acceptedRequests = [...incomingRequests, ...outgoingRequests]
            .filter((request) => request.status === 'accepted');

        const loadContacts = async () => {
            const unique = new Map<string, FriendRequest>();
            acceptedRequests.forEach((request) => {
                const contactUid = request.fromUid === uid ? request.toUid : request.fromUid;
                if (!unique.has(contactUid)) unique.set(contactUid, request);
            });

            const nextContacts = await Promise.all(Array.from(unique.entries()).map(async ([contactUid, request]) => {
                const profileSnapshot = await getDoc(doc(db, 'publicProfiles', contactUid));
                if (!profileSnapshot.exists()) return null;
                const profile = profileSnapshot.data() as PublicProfile;
                if (!profile.publicKeyPem) return null;
                return {
                    uid: contactUid,
                    label: profile.displayName || (request.fromUid === uid ? request.toLabel : request.fromLabel) || contactUid,
                    publicKeyPem: profile.publicKeyPem,
                    requestId: request.id,
                } as ContactProfile;
            }));

            if (!cancelled) {
                setContacts(nextContacts.filter((contact): contact is ContactProfile => contact !== null));
            }
        };

        loadContacts().catch((error) => {
            console.error('Unable to load contacts:', error);
            if (!cancelled) setContacts([]);
        });

        return () => { cancelled = true; };
    }, [isOpen, incomingRequests, outgoingRequests]);

    const resolveRecipient = async () => {
        const lookup = recipientLookup.trim();
        if (!lookup) return;

        setIsResolvingRecipient(true);
        try {
            let profile: PublicProfile | null = null;

            if (lookup.includes('@')) {
                const emailHash = await sha256Hex(lookup);
                const q = query(collection(db, 'publicProfiles'), where('emailHash', '==', emailHash), limit(1));
                const snapshot = await getDocs(q);
                profile = snapshot.empty ? null : snapshot.docs[0].data() as PublicProfile;
            } else {
                const snapshot = await getDoc(doc(db, 'publicProfiles', lookup));
                profile = snapshot.exists() ? snapshot.data() as PublicProfile : null;
            }

            if (!profile?.uid || !profile?.publicKeyPem) {
                alert('Não encontrei um perfil público com chave E2E para esse destinatário.');
                setResolvedRecipient(null);
                setRecipientId('');
                setRecipientKeyPem('');
                return;
            }

            if (profile.uid === auth.currentUser?.uid) {
                alert('Escolhe outro utilizador como destinatário.');
                return;
            }

            selectRecipient(profile);
        } catch (error) {
            console.error('Recipient lookup failed:', error);
            alert('Não foi possível resolver o destinatário.');
        } finally {
            setIsResolvingRecipient(false);
        }
    };

    const existingRequestForResolvedRecipient = resolvedRecipient
        ? [...incomingRequests, ...outgoingRequests].find((request) =>
            (request.fromUid === auth.currentUser?.uid && request.toUid === resolvedRecipient.uid) ||
            (request.toUid === auth.currentUser?.uid && request.fromUid === resolvedRecipient.uid)
        )
        : undefined;

    const requestContact = async () => {
        if (!auth.currentUser || !resolvedRecipient || isRequestingContact) return;
        if (existingRequestForResolvedRecipient?.status === 'accepted') {
            alert('Este perfil já está na tua lista de contactos.');
            return;
        }
        if (existingRequestForResolvedRecipient?.status === 'pending') {
            alert('Já existe um pedido pendente entre vocês.');
            return;
        }

        setIsRequestingContact(true);
        try {
            const now = Date.now();
            await addDoc(collection(db, 'friendRequests'), {
                fromUid: auth.currentUser.uid,
                toUid: resolvedRecipient.uid,
                fromLabel: auth.currentUser.displayName || auth.currentUser.email || auth.currentUser.uid,
                toLabel: resolvedRecipient.label,
                status: 'pending',
                createdAt: now,
                updatedAt: now,
            });
            alert('Pedido de contacto enviado.');
        } catch (error) {
            console.error('Contact request failed:', error);
            alert('Não foi possível enviar o pedido de contacto.');
        } finally {
            setIsRequestingContact(false);
        }
    };

    const respondToContactRequest = async (request: FriendRequest, status: 'accepted' | 'rejected') => {
        try {
            await updateDoc(doc(db, 'friendRequests', request.id), {
                status,
                updatedAt: Date.now(),
            });
        } catch (error) {
            console.error('Contact response failed:', error);
            alert('Não foi possível atualizar o pedido.');
        }
    };

    const startP2PChannel = async () => {
        if (!auth.currentUser || !recipientId || !resolvedRecipient) return;
        await closeP2P(false);
        setP2pStatus('offering');

        try {
            const roomRef = doc(collection(db, 'p2pRooms'));
            const pc = createPeerConnection(roomRef.id, 'caller');
            const channel = pc.createDataChannel('mnemosyne-e2e', { ordered: true });
            wireDataChannel(channel);

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            await setDoc(roomRef, {
                callerId: auth.currentUser.uid,
                calleeId: recipientId,
                callerLabel: auth.currentUser.displayName || auth.currentUser.email || auth.currentUser.uid,
                status: 'offer',
                offer: { type: offer.type, sdp: offer.sdp },
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });

            setP2pRoomId(roomRef.id);
            setP2pStatus('connecting');

            const roomUnsubscribe = onSnapshot(roomRef, async (snapshot) => {
                const room = snapshot.data() as P2PRoom | undefined;
                if (!room || !peerConnectionRef.current) return;
                if (room.answer && !peerConnectionRef.current.currentRemoteDescription) {
                    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(room.answer));
                }
                if (room.status === 'closed') {
                    await closeP2P(false);
                }
            });
            p2pUnsubscribersRef.current.push(roomUnsubscribe);
            attachCandidateListener(roomRef.id, 'calleeCandidates');
        } catch (error) {
            console.error('P2P offer failed:', error);
            setP2pStatus('error');
            alert('Não foi possível iniciar o canal P2P.');
        }
    };

    const acceptP2PChannel = async (room: P2PRoom) => {
        if (!auth.currentUser || !room.offer) return;
        await closeP2P(false);
        setP2pStatus('connecting');

        try {
            const pc = createPeerConnection(room.id, 'callee');
            pc.ondatachannel = (event) => wireDataChannel(event.channel);
            await pc.setRemoteDescription(new RTCSessionDescription(room.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await updateDoc(doc(db, 'p2pRooms', room.id), {
                answer: { type: answer.type, sdp: answer.sdp },
                status: 'active',
                updatedAt: Date.now(),
            });

            setP2pRoomId(room.id);
            attachCandidateListener(room.id, 'callerCandidates');
            const roomUnsubscribe = onSnapshot(doc(db, 'p2pRooms', room.id), async (snapshot) => {
                const current = snapshot.data() as P2PRoom | undefined;
                if (current?.status === 'closed') {
                    await closeP2P(false);
                }
            });
            p2pUnsubscribersRef.current.push(roomUnsubscribe);
        } catch (error) {
            console.error('P2P accept failed:', error);
            setP2pStatus('error');
            alert('Não foi possível aceitar o canal P2P.');
        }
    };

    const handleSend = async () => {
        if (!auth.currentUser || (!message.trim() && !attachment) || !recipientId.trim() || !recipientKeyPem.trim() || !myIdentity) return;
        if (recipientId.trim() === auth.currentUser.uid) {
            alert('Escolhe outro utilizador como destinatário. A transmissão para ti próprio foi removida.');
            return;
        }
        if (attachment && attachment.size > 750 * 1024) {
            alert('Anexo demasiado grande para transmissão Firestore direta. Usa um ficheiro até 750KB nesta versão.');
            return;
        }
        
        setIsSending(true);
        setHandshakeMode(true);
        
        try {
            const encryptedEnvelope = await buildEncryptedEnvelope();
            const payload = {
                senderId: auth.currentUser.uid,
                recipientId: recipientId.trim(),
                ...encryptedEnvelope,
                timestamp: Date.now(),
                status: p2pStatus === 'open' ? 'p2p' : 'sent'
            };

            if (p2pStatus === 'open' && dataChannelRef.current?.readyState === 'open') {
                dataChannelRef.current.send(JSON.stringify({
                    type: 'mnemosyne-transmission',
                    ...payload,
                }));
            } else {
                await addDoc(collection(db, 'transmissions'), payload);
            }
            
            setMessage('');
            setAttachment(null);
            setRecipientId('');
            setRecipientKeyPem('');
            setRecipientLookup('');
            setResolvedRecipient(null);
            
            setTimeout(() => {
                setHandshakeMode(false);
                if (p2pStatus !== 'open') {
                    onClose();
                }
            }, p2pStatus === 'open' ? 600 : 1500);

        } catch (error) {
            console.error('Transmission error:', error);
            alert('Erro ao transmitir. Verifica o destinatário e a chave pública publicada.');
            setHandshakeMode(false);
        } finally {
            setIsSending(false);
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
                        onClick={isSending ? undefined : onClose}
                        className="absolute inset-0 bg-[#020617]/90 backdrop-blur-xl"
                    />

                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="relative w-full max-w-2xl glass-card overflow-hidden bg-[#0b1120]/80 border border-indigo-500/20 shadow-[0_0_80px_rgba(99,102,241,0.15)] rounded-[2rem]"
                    >
                        {handshakeMode ? (
                            <div className="p-16 flex flex-col items-center justify-center space-y-6">
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
                                <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-indigo-500/30">
                                            <Zap className="w-5 h-5 text-indigo-400" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-white tracking-widest uppercase">Transmissão Cósmica</h2>
                                            <p className="text-[10px] text-indigo-300/60 uppercase tracking-widest flex items-center gap-1 mt-0.5">
                                                <ShieldAlert className="w-3 h-3" /> E2E Zero-Knowledge
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 bg-black/40 p-1 rounded-xl border border-white/10">
                                        <button 
                                            onClick={() => setActiveTab('compose')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'compose' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            Compor
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('contacts')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${activeTab === 'contacts' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            <Users className="w-3.5 h-3.5" /> Contactos
                                            {incomingRequests.filter((request) => request.status === 'pending').length > 0 && (
                                                <span className="bg-cyan-400 text-black px-1.5 py-0.5 rounded-full text-[9px] leading-none">
                                                    {incomingRequests.filter((request) => request.status === 'pending').length}
                                                </span>
                                            )}
                                        </button>
                                        <button 
                                            onClick={() => setActiveTab('inbox')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${activeTab === 'inbox' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            <Inbox className="w-3.5 h-3.5" /> Inbox
                                            {inboxMsgs.length > 0 && (
                                                <span className="bg-emerald-500 text-black px-1.5 py-0.5 rounded-full text-[9px] leading-none">{inboxMsgs.length}</span>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('sent')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${activeTab === 'sent' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            <Send className="w-3.5 h-3.5" /> Envios
                                            {outboxMsgs.length > 0 && (
                                                <span className="bg-indigo-400 text-black px-1.5 py-0.5 rounded-full text-[9px] leading-none">{outboxMsgs.length}</span>
                                            )}
                                        </button>
                                        <button 
                                            onClick={() => setActiveTab('identity')}
                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 ${activeTab === 'identity' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                        >
                                            <Lock className="w-3.5 h-3.5" /> Chaves
                                        </button>
                                    </div>

                                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                                        <X className="w-5 h-5 text-gray-400" />
                                    </button>
                                </div>

                                {activeTab === 'compose' && (
                                    <div className="p-8 space-y-6">
                                    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
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
                                                    setRecipientLookup(e.target.value);
                                                    setResolvedRecipient(null);
                                                    setRecipientId('');
                                                    setRecipientKeyPem('');
                                                }}
                                                className="flex-1 bg-[#020617]/50 text-cyan-100 placeholder-cyan-900 border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all outline-none font-mono text-xs tracking-wide"
                                                placeholder="email ou uid do destinatário"
                                            />
                                            <button
                                                onClick={resolveRecipient}
                                                disabled={isResolvingRecipient || !recipientLookup.trim()}
                                                className="w-12 h-12 flex items-center justify-center rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 disabled:opacity-40 transition-colors"
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
                                                        disabled={isRequestingContact || existingRequestForResolvedRecipient?.status === 'pending'}
                                                        className="flex flex-none items-center gap-1.5 rounded-md border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-50"
                                                    >
                                                        <UserPlus className="w-3 h-3" />
                                                        {existingRequestForResolvedRecipient?.status === 'pending' ? 'Pendente' : 'Pedir contacto'}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {(incomingRooms.length > 0 || resolvedRecipient) && (
                                        <div className="space-y-3 rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                    <Radio className="w-4 h-4 text-cyan-300" />
                                                    <div>
                                                        <p className="text-xs font-bold uppercase tracking-widest text-cyan-100">Canal P2P WebRTC</p>
                                                        <p className="text-[10px] text-cyan-300/70">
                                                            {p2pStatus === 'open' ? 'Canal direto ativo. O relay fica como fallback.' :
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
                                                        disabled={!resolvedRecipient || p2pStatus === 'connecting' || p2pStatus === 'offering'}
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
                                            onChange={(e) => setRecipientKeyPem(e.target.value)}
                                            className="w-full h-24 bg-[#020617]/50 text-indigo-100 placeholder-indigo-900 border border-white/10 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all outline-none font-mono text-[10px] tracking-wide custom-scrollbar"
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
                                            className="w-full h-32 bg-[#020617]/50 text-indigo-100 placeholder-indigo-900 border border-white/10 rounded-xl p-4 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all outline-none resize-none text-sm font-light leading-relaxed custom-scrollbar"
                                            placeholder="Escreva a mensagem ou pensamento a encapsular..."
                                        />
                                    </div>

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

                                    <div className="pt-2 flex items-center gap-3">
                                        <label className="flex items-center justify-center w-12 h-12 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl cursor-pointer transition-colors group relative">
                                            <input 
                                                type="file" 
                                                className="hidden" 
                                                onChange={(e) => {
                                                    if (e.target.files && e.target.files[0]) {
                                                        setAttachment(e.target.files[0]);
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
                                            disabled={isSending || (!message.trim() && !attachment) || !recipientId.trim() || !recipientKeyPem.trim()}
                                            className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:bg-white/5 disabled:text-gray-500 transition-all text-sm font-bold uppercase tracking-widest text-white shadow-[0_0_20px_rgba(79,70,229,0.3)] disabled:shadow-none"
                                        >
                                            <Send className="w-4 h-4" /> {p2pStatus === 'open' ? 'Transmitir P2P' : 'Transmitir Relay E2E'}
                                        </button>
                                    </div>
                                    </div>
                                )}

                                {activeTab === 'contacts' && (
                                    <div className="p-6 h-[440px] overflow-y-auto custom-scrollbar space-y-6">
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
                                                                onClick={() => void respondToContactRequest(request, 'accepted')}
                                                                className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                                                                title="Aceitar contacto"
                                                            >
                                                                <Check className="w-4 h-4" />
                                                            </button>
                                                            <button
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
                                            {contacts.length === 0 ? (
                                                <p className="text-xs text-emerald-200/45 rounded-xl border border-white/10 bg-black/20 p-3">
                                                    A lista fica disponível depois de um pedido ser aceite.
                                                </p>
                                            ) : (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    {contacts.map((contact) => (
                                                        <button
                                                            key={contact.uid}
                                                            onClick={() => selectRecipient(contact)}
                                                            className="flex items-center gap-2 rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-3 py-3 text-left text-emerald-100 hover:border-emerald-400/30 hover:bg-emerald-500/10"
                                                        >
                                                            <CheckCircle2 className="w-4 h-4 flex-none text-emerald-300" />
                                                            <span className="min-w-0 truncate text-xs font-mono">{contact.label}</span>
                                                        </button>
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
                                    <div className="p-6 h-[400px] overflow-y-auto custom-scrollbar space-y-4">
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
                                                        </div>
                                                        <span className="text-[10px] text-gray-500 font-mono">
                                                            {new Date(msg.timestamp).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                    
                                                    <div className="text-sm text-indigo-100 font-mono bg-black/40 p-3 rounded-lg border border-white/5 break-words">
                                                        {msg.decryptedMessage}
                                                    </div>

                                                    {msg.hasAttachment && (
                                                        <div className="mt-3 flex items-center gap-2 text-xs text-indigo-300 bg-indigo-500/10 p-2 rounded-lg w-max border border-indigo-500/20">
                                                            <FileText className="w-3.5 h-3.5 text-indigo-400" />
                                                            Carga anexa bloqueada (Requer chave privada)
                                                        </div>
                                                    )}
                                                </motion.div>
                                            ))
                                        )}
                                    </div>
                                )}

                                {activeTab === 'sent' && (
                                    <div className="p-6 h-[400px] overflow-y-auto custom-scrollbar space-y-4">
                                        {outboxMsgs.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                                                <Send className="w-12 h-12 text-indigo-400 mb-4" />
                                                <p className="text-sm font-mono text-indigo-200">Nenhuma cápsula enviada ainda.</p>
                                                <p className="text-[10px] uppercase tracking-widest mt-2 text-indigo-400/50">Os estados aparecem aqui em tempo real</p>
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
                                    <div className="p-8 space-y-6 h-[400px]">
                                        <div className="text-center space-y-2 mb-6">
                                            <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-indigo-500/30">
                                                <Lock className="w-8 h-8 text-indigo-400" />
                                            </div>
                                            <h3 className="text-lg font-bold text-white tracking-widest uppercase">A Sua Identidade</h3>
                                            <p className="text-xs text-indigo-300">As suas chaves RSA-OAEP são geradas localmente. A chave privada fica apenas em memória nesta sessão; a chave pública é publicada no teu perfil para descoberta segura.</p>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex justify-between items-center">
                                                <span>A Sua Chave Pública (Para Partilhar)</span>
                                                <button onClick={() => {
                                                    if(myIdentity) navigator.clipboard.writeText(myIdentity.pemPublic);
                                                    alert("Copiado para a área de transferência!");
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
