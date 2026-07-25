import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const projectId = process.env.GCLOUD_PROJECT ?? 'mnemosyne-rules'
const rulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url))
const [emulatorHost = '127.0.0.1', emulatorPort = '8080'] =
  (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')

let testEnv: RulesTestEnvironment

const userDoc = (tier = 'free', status = 'active') => ({
  subscription: { tier, status },
})

const seedFirestore = async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', 'alice'), userDoc('free'))
    await setDoc(doc(db, 'users', 'pro-user'), userDoc('pro'))
    await setDoc(doc(db, 'users', 'bob'), userDoc('free'))
    await setDoc(doc(db, 'trustedDevices', 'alice-device'), {
      deviceId: 'alice-device',
      ownerUid: 'alice',
      name: 'Alice phone',
      status: 'active',
      pairedAt: 1,
      publicKeyJwk: { kty: 'EC' },
      desktopPublicKeyJwk: { kty: 'EC' },
      createdAt: 1,
      updatedAt: 1,
    })
    await setDoc(doc(db, 'trustedDevices', 'revoked-device'), {
      deviceId: 'revoked-device',
      ownerUid: 'alice',
      name: 'Old phone',
      status: 'revoked',
      pairedAt: 1,
      publicKeyJwk: { kty: 'EC' },
      desktopPublicKeyJwk: { kty: 'EC' },
      createdAt: 1,
      updatedAt: 1,
    })
  })
}

const memory = (uid: string, overrides = {}) => ({
  uid,
  title: 'Private memory',
  text: 'Encrypted local thought',
  tags: ['test'],
  category: 'note',
  updatedAt: 1,
  attachments: [],
  ...overrides,
})

const envelope = (overrides = {}) => ({
  ownerUid: 'alice',
  deviceId: 'alice-device',
  direction: 'desktop-to-mobile',
  payloadType: 'memory-delta',
  status: 'queued',
  senderPublicKeyJwk: { kty: 'EC' },
  encryptedPayload: { iv: 'iv', data: 'ciphertext' },
  memoryCount: 1,
  tombstoneIds: ['memory-1'],
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 999999,
  ...overrides,
})

describe('firestore security rules', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: {
        host: emulatorHost,
        port: Number(emulatorPort),
        rules: readFileSync(rulesPath, 'utf8'),
      },
    })
  })

  beforeEach(async () => {
    await testEnv.clearFirestore()
    await seedFirestore()
  })

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup()
    }
  })

  it('isolates private memories by owner and explicit sharing', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()
    const anonDb = testEnv.unauthenticatedContext().firestore()

    await assertSucceeds(setDoc(doc(aliceDb, 'sessions', 'memory-1'), memory('alice')))
    await assertSucceeds(getDoc(doc(aliceDb, 'sessions', 'memory-1')))
    await assertFails(getDoc(doc(bobDb, 'sessions', 'memory-1')))
    await assertFails(getDoc(doc(anonDb, 'sessions', 'memory-1')))

    await assertSucceeds(updateDoc(doc(aliceDb, 'sessions', 'memory-1'), {
      sharedWithIds: ['bob'],
    }))
    await assertSucceeds(getDoc(doc(bobDb, 'sessions', 'memory-1')))
  })

  it('allows attachments during Free-first while paid entitlement rules stay seeded', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const proDb = testEnv.authenticatedContext('pro-user').firestore()

    await assertSucceeds(setDoc(doc(aliceDb, 'sessions', 'free-attachment'), memory('alice', {
      attachments: [{ name: 'voice.wav', size: 123 }],
    })))
    await assertSucceeds(setDoc(doc(proDb, 'sessions', 'pro-attachment'), memory('pro-user', {
      attachments: [{ name: 'voice.wav', size: 123 }],
    })))
  })

  it('limits shared editor updates to memory content fields', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()

    await assertSucceeds(setDoc(doc(aliceDb, 'sessions', 'shared-memory'), memory('alice', {
      sharedWithIds: ['bob'],
    })))
    await assertSucceeds(updateDoc(doc(bobDb, 'sessions', 'shared-memory'), {
      text: 'Bob edit',
      updatedAt: 2,
    }))
    await assertFails(updateDoc(doc(bobDb, 'sessions', 'shared-memory'), {
      uid: 'bob',
      updatedAt: 3,
    }))
  })

  it('requires owned active trusted devices for mobile sync envelopes', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()

    await assertSucceeds(setDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-1'), envelope()))
    await assertFails(setDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-2'), envelope({
      deviceId: 'revoked-device',
    })))
    await assertFails(setDoc(doc(bobDb, 'mobileSyncEnvelopes', 'env-3'), envelope()))
  })

  it('allows envelope status transitions without payload mutation', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()

    await assertSucceeds(setDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-4'), envelope()))
    await assertSucceeds(updateDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-4'), {
      status: 'pulled',
      pulledAt: 2,
      updatedAt: 2,
    }))
    await assertFails(updateDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-4'), {
      encryptedPayload: { iv: 'changed', data: 'changed' },
      updatedAt: 3,
    }))
  })

  it('allows only owners to delete trusted devices and sessions', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()

    await assertSucceeds(setDoc(doc(aliceDb, 'sessions', 'owned-delete'), memory('alice')))
    await assertFails(deleteDoc(doc(bobDb, 'sessions', 'owned-delete')))
    await assertSucceeds(deleteDoc(doc(aliceDb, 'sessions', 'owned-delete')))

    await assertFails(deleteDoc(doc(bobDb, 'trustedDevices', 'alice-device')))
    await assertSucceeds(deleteDoc(doc(aliceDb, 'trustedDevices', 'alice-device')))
  })

  it('accepts encrypted capsule shares and rejects plaintext payloads', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()
    const anonDb = testEnv.unauthenticatedContext().firestore()

    const encryptedShare = {
      sessionId: 'memory-1',
      encrypted: true,
      ciphertext: 'base64-ciphertext-payload-long-enough',
      titleHint: 'Memória',
      pack: false,
      itemCount: 1,
      createdAt: 1,
      expiresAt: 999999,
      views: 0,
      importCount: 0,
      uid: 'alice',
    }

    await assertSucceeds(setDoc(doc(aliceDb, 'shares', 'cap-1'), encryptedShare))
    await assertSucceeds(getDoc(doc(anonDb, 'shares', 'cap-1')))

    await assertFails(setDoc(doc(aliceDb, 'shares', 'cap-plain'), {
      ...encryptedShare,
      encrypted: false,
      text: 'should not be allowed',
    }))

    await assertFails(setDoc(doc(aliceDb, 'shares', 'cap-missing-cipher'), {
      sessionId: 'memory-1',
      encrypted: true,
      views: 0,
      importCount: 0,
      uid: 'alice',
    }))

    await assertFails(setDoc(doc(bobDb, 'shares', 'cap-spoof'), {
      ...encryptedShare,
      uid: 'alice',
    }))

    await assertSucceeds(updateDoc(doc(anonDb, 'shares', 'cap-1'), { views: 1 }))
    await assertSucceeds(updateDoc(doc(bobDb, 'shares', 'cap-1'), {
      importCount: 1,
      lastImportedAt: 2,
    }))
    await assertFails(updateDoc(doc(bobDb, 'shares', 'cap-1'), {
      ciphertext: 'tampered',
    }))
    await assertFails(deleteDoc(doc(bobDb, 'shares', 'cap-1')))
    await assertSucceeds(deleteDoc(doc(aliceDb, 'shares', 'cap-1')))
  })

  it('allows friend requests between distinct users only', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()

    const request = {
      fromUid: 'alice',
      toUid: 'bob',
      fromLabel: 'Alice',
      toLabel: 'Bob',
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
    }

    await assertSucceeds(setDoc(doc(aliceDb, 'friendRequests', 'fr-1'), request))
    await assertFails(setDoc(doc(aliceDb, 'friendRequests', 'fr-self'), {
      ...request,
      toUid: 'alice',
    }))
    await assertSucceeds(updateDoc(doc(bobDb, 'friendRequests', 'fr-1'), {
      status: 'accepted',
      updatedAt: 2,
    }))
  })

  it('enforces E2E transmission relay fields and recipient status transitions', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()

    const capsule = {
      senderId: 'alice',
      recipientId: 'bob',
      encryptedKey: 'rsa-wrapped-key',
      encryptedPayload: 'aes-ciphertext',
      payloadIv: 'iv-base64',
      hasAttachment: false,
      attachmentName: null,
      status: 'sent',
      timestamp: 1,
    }

    await assertSucceeds(setDoc(doc(aliceDb, 'transmissions', 'tx-1'), capsule))
    await assertFails(setDoc(doc(aliceDb, 'transmissions', 'tx-self'), {
      ...capsule,
      recipientId: 'alice',
    }))
    await assertFails(setDoc(doc(aliceDb, 'transmissions', 'tx-extra'), {
      ...capsule,
      channel: 'relay',
    }))

    await assertSucceeds(updateDoc(doc(bobDb, 'transmissions', 'tx-1'), {
      status: 'received',
      receivedAt: 2,
    }))
    // Sender cannot mutate status after delivery
    await assertFails(updateDoc(doc(aliceDb, 'transmissions', 'tx-1'), {
      status: 'failed',
      receivedAt: 3,
    }))
  })
})
