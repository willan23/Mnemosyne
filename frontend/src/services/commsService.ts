/**
 * Lógica Comms multi-user — validação e payloads sem UI.
 * Garante que transmissções E2E nunca vão para self e têm schema de relay.
 */

export type TransmissionStatus = 'sent' | 'received' | 'failed' | 'p2p';

export interface TransmissionCreateInput {
  senderId: string;
  recipientId: string;
  encryptedKey: string;
  encryptedPayload: string;
  payloadIv: string;
  hasAttachment?: boolean;
  attachmentName?: string | null;
  timestamp?: number;
  /** P2P usa DataChannel; Firestore relay só aceita 'sent' */
  channel?: 'relay' | 'p2p';
}

export interface TransmissionCreatePayload {
  senderId: string;
  recipientId: string;
  encryptedKey: string;
  encryptedPayload: string;
  payloadIv: string;
  hasAttachment: boolean;
  attachmentName: string | null;
  timestamp: number;
  status: 'sent';
}

export interface FriendRequestCreateInput {
  fromUid: string;
  toUid: string;
  fromLabel: string;
  toLabel: string;
}

export function normalizeUid(value: string): string {
  return value.trim();
}

export function canTransmitToRecipient(senderId: string, recipientId: string): {
  ok: boolean;
  reason?: string;
} {
  const sender = normalizeUid(senderId);
  const recipient = normalizeUid(recipientId);
  if (!sender || !recipient) {
    return { ok: false, reason: 'Remetente ou destinatário em falta.' };
  }
  if (sender === recipient) {
    return { ok: false, reason: 'Não podes transmitir para ti próprio. Escolhe outro utilizador.' };
  }
  return { ok: true };
}

export function validateEncryptedEnvelope(parts: {
  encryptedKey?: string;
  encryptedPayload?: string;
  payloadIv?: string;
}): { ok: boolean; reason?: string } {
  if (!parts.encryptedKey?.trim()) return { ok: false, reason: 'Chave simétrica cifrada em falta.' };
  if (!parts.encryptedPayload?.trim()) return { ok: false, reason: 'Payload cifrado em falta.' };
  if (!parts.payloadIv?.trim()) return { ok: false, reason: 'IV do payload em falta.' };
  return { ok: true };
}

/** Payload aceite pelas regras Firestore de `transmissions` (create). */
export function buildRelayTransmissionPayload(input: TransmissionCreateInput): TransmissionCreatePayload {
  const multi = canTransmitToRecipient(input.senderId, input.recipientId);
  if (!multi.ok) throw new Error(multi.reason);

  const envelope = validateEncryptedEnvelope(input);
  if (!envelope.ok) throw new Error(envelope.reason);

  return {
    senderId: normalizeUid(input.senderId),
    recipientId: normalizeUid(input.recipientId),
    encryptedKey: input.encryptedKey,
    encryptedPayload: input.encryptedPayload,
    payloadIv: input.payloadIv,
    hasAttachment: Boolean(input.hasAttachment),
    attachmentName: input.attachmentName ?? null,
    timestamp: input.timestamp ?? Date.now(),
    status: 'sent',
  };
}

export function buildFriendRequestPayload(input: FriendRequestCreateInput, now = Date.now()) {
  const multi = canTransmitToRecipient(input.fromUid, input.toUid);
  if (!multi.ok) throw new Error(multi.reason);
  return {
    fromUid: normalizeUid(input.fromUid),
    toUid: normalizeUid(input.toUid),
    fromLabel: (input.fromLabel || input.fromUid).slice(0, 120),
    toLabel: (input.toLabel || input.toUid).slice(0, 120),
    status: 'pending' as const,
    createdAt: now,
    updatedAt: now,
  };
}

export function isAcceptedContact(
  requests: Array<{ fromUid: string; toUid: string; status: string }>,
  uid: string,
  otherUid: string,
): boolean {
  return requests.some(
    (r) =>
      r.status === 'accepted' &&
      ((r.fromUid === uid && r.toUid === otherUid) || (r.toUid === uid && r.fromUid === otherUid)),
  );
}

/** Mensagem P2P no DataChannel (não passa pelas rules de create do Firestore). */
export function buildP2PTransmissionMessage(input: TransmissionCreateInput & { status?: string }) {
  const multi = canTransmitToRecipient(input.senderId, input.recipientId);
  if (!multi.ok) throw new Error(multi.reason);
  const envelope = validateEncryptedEnvelope(input);
  if (!envelope.ok) throw new Error(envelope.reason);

  return {
    type: 'mnemosyne-transmission' as const,
    senderId: normalizeUid(input.senderId),
    recipientId: normalizeUid(input.recipientId),
    encryptedKey: input.encryptedKey,
    encryptedPayload: input.encryptedPayload,
    payloadIv: input.payloadIv,
    hasAttachment: Boolean(input.hasAttachment),
    attachmentName: input.attachmentName ?? null,
    timestamp: input.timestamp ?? Date.now(),
    status: 'p2p' as const,
  };
}
