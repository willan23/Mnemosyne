import { describe, expect, it } from 'vitest';
import {
  buildFriendRequestPayload,
  buildP2PTransmissionMessage,
  buildRelayTransmissionPayload,
  canTransmitToRecipient,
  isAcceptedContact,
  validateEncryptedEnvelope,
} from './commsService';

describe('comms multi-user', () => {
  it('blocks self-transmission', () => {
    expect(canTransmitToRecipient('alice', 'alice').ok).toBe(false);
    expect(canTransmitToRecipient('alice', 'bob').ok).toBe(true);
  });

  it('requires encrypted envelope fields', () => {
    expect(validateEncryptedEnvelope({ encryptedKey: 'k', encryptedPayload: 'p', payloadIv: 'iv' }).ok).toBe(true);
    expect(validateEncryptedEnvelope({ encryptedKey: '', encryptedPayload: 'p', payloadIv: 'iv' }).ok).toBe(false);
  });

  it('builds Firestore-safe relay payload with status sent only', () => {
    const payload = buildRelayTransmissionPayload({
      senderId: 'alice',
      recipientId: 'bob',
      encryptedKey: 'rsa-wrap',
      encryptedPayload: 'cipher',
      payloadIv: 'iv',
      hasAttachment: false,
    });
    expect(payload.status).toBe('sent');
    expect(payload.senderId).toBe('alice');
    expect(payload.recipientId).toBe('bob');
    expect(() =>
      buildRelayTransmissionPayload({
        senderId: 'alice',
        recipientId: 'alice',
        encryptedKey: 'k',
        encryptedPayload: 'p',
        payloadIv: 'iv',
      }),
    ).toThrow(/próprio/);
  });

  it('builds friend request and detects accepted contacts', () => {
    const req = buildFriendRequestPayload({
      fromUid: 'alice',
      toUid: 'bob',
      fromLabel: 'Alice',
      toLabel: 'Bob',
    });
    expect(req.status).toBe('pending');
    expect(req.fromUid).toBe('alice');

    expect(
      isAcceptedContact(
        [{ fromUid: 'alice', toUid: 'bob', status: 'accepted' }],
        'alice',
        'bob',
      ),
    ).toBe(true);
    expect(
      isAcceptedContact(
        [{ fromUid: 'alice', toUid: 'bob', status: 'pending' }],
        'alice',
        'bob',
      ),
    ).toBe(false);
  });

  it('builds P2P datachannel message separately from relay', () => {
    const msg = buildP2PTransmissionMessage({
      senderId: 'alice',
      recipientId: 'bob',
      encryptedKey: 'k',
      encryptedPayload: 'p',
      payloadIv: 'iv',
    });
    expect(msg.type).toBe('mnemosyne-transmission');
    expect(msg.status).toBe('p2p');
  });
});
