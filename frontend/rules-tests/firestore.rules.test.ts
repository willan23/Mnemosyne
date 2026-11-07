import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  type Firestore,
  Timestamp,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { getApps, initializeApp } from 'firebase/app'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTeamHistoryPage, rewriteTeamHistoryEntry, runTeamHistoryReencryption, type TeamHistoryDeps } from '../src/services/teamHistoryReencryption'
import { buildEncryptedMemoryFields, decryptMemoryEnvelope, encryptMemoryFields, setMemoryCryptoKeyForTests } from '../src/services/memoryCrypto'
import { decryptTeamMemoryEnvelope, encryptTeamMemoryFields, decryptTeamMemoryPayload, recipherTeamMemoryEnvelope, encryptLegacyTeamMemoryFields, generateTeamKey } from '../src/services/teamVault'
import { encryptTextAesGcm } from '../src/utils/crypto'
import { revisePersonalLearnedMemory, capturePersonalRevisionBaseline, type PersonalRevisionDeps, type PersonalRevisionContent } from '../src/services/personalLearnedRevision'
vi.mock('../src/firebase', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../src/config/releaseGates', () => ({ TEAM_WRITES_ENABLED: true, TEAM_HISTORY_REENCRYPTION_ENABLED: true }))

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
  teamId: null,
  title: null,
  text: '',
  enc: { v: 1, iv: 'synthetic-iv', ct: 'synthetic-ciphertext' },
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

  it("isolates stored private memories and keeps legacy sharing read-only", async () => {

    const aliceDb=testEnv.authenticatedContext('alice').firestore(),bobDb=testEnv.authenticatedContext('bob').firestore(),anonDb=testEnv.unauthenticatedContext().firestore()
    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await setDoc(doc(db,'sessions','memory-1'),memory('alice'))})
    await assertSucceeds(getDoc(doc(aliceDb,'sessions','memory-1')));await assertFails(getDoc(doc(bobDb,'sessions','memory-1')));await assertFails(getDoc(doc(anonDb,'sessions','memory-1')))
    await assertFails(updateDoc(doc(aliceDb,'sessions','memory-1'),{sharedWithIds:['bob']}))
    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await updateDoc(doc(db,'sessions','memory-1'),{sharedWithIds:['bob']})})
    await assertSucceeds(getDoc(doc(bobDb,'sessions','memory-1')))
    for(const db of[aliceDb,bobDb,anonDb])await assertFails(setDoc(doc(db,'sessions','direct-create'),memory('alice')))

  })

  it("keeps manual links through server admission while every direct SDK append is refused", async () => {

    const aliceDb=testEnv.authenticatedContext('alice').firestore(),ref=doc(aliceDb,'sessions','semantic-links')
    const cipher={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)}
    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await setDoc(doc(db,'sessions','semantic-links'),memory('alice',{enc:cipher,timestamp:1,connections:['manual-old','manual-new']}));await setDoc(doc(db,'sessions','semantic'),memory('alice',{enc:cipher,timestamp:1,connections:[]}))})
    await assertFails(updateDoc(ref,{connections:arrayUnion('unadmitted')}))
    const require=createRequire(import.meta.url),server=require('../../functions/lib/personalConnections'),admin=require('../../functions/node_modules/firebase-admin'),deps={firestore:admin.firestore(),now:()=>50}
    const baseline=await server.executePersonalConnectionPreparation('alice',{sourceId:ref.id,targetId:'semantic'},deps)
    const command={operationId:crypto.randomUUID(),operation:'link',sourceId:ref.id,targetId:'semantic',expectedSourceHash:baseline.sourceHash,expectedTargetHash:baseline.targetHash}
    await server.executePersonalConnection('alice',command,'apply',deps)
    expect((await getDoc(ref)).data()!.connections).toEqual(['manual-old','manual-new','semantic'])

  })

  it('runs the durable revision client against real server transactions with ciphertext, independent journals and stale draft refusal', async () => {
    const events = new EventTarget()
    vi.stubGlobal('window', {crypto: globalThis.crypto, btoa: globalThis.btoa, atob: globalThis.atob, dispatchEvent: events.dispatchEvent.bind(events),
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events)})
    setMemoryCryptoKeyForTests(await generateTeamKey())
    try {
      const require=createRequire(import.meta.url)
      const server=require('../../functions/lib/personalRevisions.js')
      const admin=require('../../functions/node_modules/firebase-admin')
      const serverDeps={firestore:admin.firestore(),now:()=>Date.now()}
      const db = testEnv.authenticatedContext('alice').firestore()
      const ref = doc(db, 'sessions', 'learned-revision')
      const initial = await encryptMemoryFields({text: 'Synthetic original learned note', title: 'Synthetic title'})
      await testEnv.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),ref.path),memory('alice',{enc:initial,timestamp:1,updatedAt:10,connections:['peer'],learning:{schemaVersion:1,source:'text-generation',learnedAt:1}})))
      const content: PersonalRevisionContent = {text: 'Synthetic revised learned note', title: 'Synthetic new title',
        embedding: [1,0], embeddingModel: 'synthetic-local', semanticClusterId: null, position: [1,2,3],
        importance: 0.6, processingMethod: 'learned:revision+local-embedding'}
      const makeDeps=():PersonalRevisionDeps=>{
        const journal=new Map<string,string>()
        return{enabled:()=>true,storage:{getItem:k=>journal.get(k)??null,setItem:(k,v)=>{journal.set(k,v)},removeItem:k=>{journal.delete(k)}},
          id:()=>crypto.randomUUID(),exclusive:async(_name,work)=>work(),read:async id=>(await getDocFromServer(doc(db,'sessions',id))).data(),
          encryptJournal:encryptMemoryFields,decryptJournal:decryptMemoryEnvelope,encryptContent:buildEncryptedMemoryFields,
          call:async(mode,input)=>mode==='prepare'?server.executePersonalRevisionPreparation('alice',input,serverDeps):server.executePersonalRevision('alice',input,mode,serverDeps),
          mutation:{uid:()=> 'alice',ready:()=>true,subscribe:()=>()=>undefined}}
      }
      const first=makeDeps(),second=makeDeps()
      const baseline=await capturePersonalRevisionBaseline({uid:'alice',id:ref.id},first)
      let arrivals = 0; let release = () => undefined as void
      const barrier = new Promise<void>(resolve => {release = resolve})
      const prepare = async () => {if (++arrivals === 2) release(); await barrier; return content}
      const results = await Promise.allSettled([revisePersonalLearnedMemory({uid:'alice',id:ref.id,baseline,prepare},first),
        revisePersonalLearnedMemory({uid:'alice',id:ref.id,baseline,prepare},second)])
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
      const saved = (await getDoc(ref)).data()!
      expect((await decryptMemoryEnvelope(saved.enc)).text).toBe(content.text)
      expect(saved.connections).toEqual(['peer']);expect(saved.learning.source).toBe('text-generation')
      const versions = await getDocs(collection(ref,'versions'));expect(versions.size).toBe(1)
      expect((await decryptMemoryEnvelope(versions.docs[0].data().enc)).text).toBe('Synthetic original learned note')
      await assertFails(getDoc(doc(testEnv.authenticatedContext('bob').firestore(),ref.path)))
      const third=makeDeps(),fresh=await capturePersonalRevisionBaseline({uid:'alice',id:ref.id},third)
      await expect(revisePersonalLearnedMemory({uid:'alice',id:ref.id,baseline:fresh,prepare:async()=>{
        await testEnv.withSecurityRulesDisabled(async ctx=>updateDoc(doc(ctx.firestore(),ref.path),{connections:['peer','new-peer']}));return content
      }},third)).rejects.toBeTruthy()
      expect((await getDocs(collection(ref,'versions'))).size).toBe(1)
      expect((await getDoc(ref)).data()!.connections).toEqual(['peer','new-peer'])
      await testEnv.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'accountDeletions','alice'),{status:'pending'}))
      await expect(capturePersonalRevisionBaseline({uid:'alice',id:ref.id},makeDeps())).rejects.toBeTruthy()
      await testEnv.withSecurityRulesDisabled(async ctx=>{
        expect((await getDocs(collection(ctx.firestore(),'sessions',ref.id,'versions'))).size).toBe(1)
      })
    }finally{setMemoryCryptoKeyForTests(null);vi.unstubAllGlobals()}
  })

  it("keeps stored proposals private and denies SDK proposal publication or review", async () => {

    const proposal={targetId:'target',score:0.9,embeddingModel:'synthetic',algorithmVersion:'cosine-v1',evidence:'whole-memory-vector',proposedAt:1,sourceUpdatedAt:1,targetUpdatedAt:1,status:'suggested'}
    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await setDoc(doc(db,'sessions','source'),memory('alice'));await setDoc(doc(db,'sessions','target'),memory('alice'));await setDoc(doc(db,'sessions','source','relationSuggestions','target'),proposal)})
    const db=testEnv.authenticatedContext('alice').firestore(),ref=doc(db,'sessions','source','relationSuggestions','target')
    await assertSucceeds(getDoc(ref));await assertSucceeds(getDocs(collection(db,'sessions','source','relationSuggestions')))
    for(const client of[db,testEnv.authenticatedContext('bob').firestore(),testEnv.unauthenticatedContext().firestore()]){
      await assertFails(setDoc(doc(client,ref.path),proposal));await assertFails(updateDoc(doc(client,ref.path),{status:'accepted',reviewedAt:2}));await assertFails(deleteDoc(doc(client,ref.path)))
    }
    await assertFails(getDoc(doc(testEnv.authenticatedContext('bob').firestore(),ref.path)))
    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await updateDoc(doc(db,'sessions','source'),{sharedWithIds:['bob']})})
    await assertFails(getDoc(ref));await assertFails(getDoc(doc(testEnv.authenticatedContext('bob').firestore(),ref.path)))

  })

  it("denies SDK reciprocal proposal acceptance even when the complete pair is otherwise valid", async () => {

    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();for(const id of['source','target'])await setDoc(doc(db,'sessions',id),memory('alice',{connections:[]}));for(const [a,b]of[['source','target'],['target','source']])await setDoc(doc(db,'sessions',a,'relationSuggestions',b),{targetId:b,score:0.9,embeddingModel:'synthetic',algorithmVersion:'cosine-v1',evidence:'whole-memory-vector',proposedAt:1,sourceUpdatedAt:1,targetUpdatedAt:1,status:'suggested'})})
    const db=testEnv.authenticatedContext('alice').firestore()
    await assertFails(runTransaction(db,async tx=>{for(const[a,b]of[['source','target'],['target','source']]){tx.update(doc(db,'sessions',a),{connections:[b]});tx.update(doc(db,'sessions',a,'relationSuggestions',b),{status:'accepted',reviewedAt:2})}}))
    for(const[a,b]of[['source','target'],['target','source']]){expect((await getDoc(doc(db,'sessions',a))).data()!.connections).toEqual([]);expect((await getDoc(doc(db,'sessions',a,'relationSuggestions',b))).data()!.status).toBe('suggested')}

  })

  it("denies SDK one-way proposal acceptance without changing either parent", async () => {

    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();for(const id of['source','target'])await setDoc(doc(db,'sessions',id),memory('alice',{connections:[]}));await setDoc(doc(db,'sessions','source','relationSuggestions','target'),{targetId:'target',score:0.9,status:'suggested',sourceUpdatedAt:1,targetUpdatedAt:1})})
    const db=testEnv.authenticatedContext('alice').firestore(),batch=writeBatch(db)
    batch.update(doc(db,'sessions','source'),{connections:['target']});batch.update(doc(db,'sessions','target'),{connections:['source']});batch.update(doc(db,'sessions','source','relationSuggestions','target'),{status:'accepted',reviewedAt:2})
    await assertFails(batch.commit());for(const id of['source','target'])expect((await getDoc(doc(db,'sessions',id))).data()!.connections).toEqual([])

  })

  it("cannot bypass server recalculation by rewriting SDK proposal revisions", async () => {

    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await setDoc(doc(db,'sessions','source'),memory('alice',{updatedAt:2}));await setDoc(doc(db,'sessions','target'),memory('alice'));await setDoc(doc(db,'sessions','source','relationSuggestions','target'),{targetId:'target',score:0.9,status:'suggested',sourceUpdatedAt:1,targetUpdatedAt:1})})
    const db=testEnv.authenticatedContext('alice').firestore(),ref=doc(db,'sessions','source','relationSuggestions','target')
    await assertFails(updateDoc(ref,{status:'accepted',reviewedAt:3}));await assertFails(updateDoc(ref,{sourceUpdatedAt:2,proposedAt:3}));expect((await getDoc(ref)).data()!.sourceUpdatedAt).toBe(1)

  })

  it("reserves nested legacy encryption and purge for the server even for the owner", async () => {

    const original={uid:'alice',text:'Synthetic historic text',title:'Synthetic title',updatedAt:1}
    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await setDoc(doc(db,'users','alice','memories','legacy'),original)})
    for(const uid of['alice','bob']){const db=testEnv.authenticatedContext(uid).firestore(),ref=doc(db,'users','alice','memories','legacy');await assertFails(updateDoc(ref,{text:'',title:null,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)}}));await assertFails(deleteDoc(ref))}
    const db=testEnv.authenticatedContext('alice').firestore();expect((await getDoc(doc(db,'users','alice','memories','legacy'))).data()).toEqual(original)

  })

  it("reserves historical plaintext conversion for server migration and leaves the source intact", async () => {

    const original={text:'Synthetic historical text',title:'Synthetic historical title',editorUid:'alice',createdAt:2,previousUpdatedAt:1}
    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await setDoc(doc(db,'sessions','legacy-parent'),memory('alice'));await setDoc(doc(db,'sessions','legacy-parent','versions','old'),original)})
    const db=testEnv.authenticatedContext('alice').firestore(),ref=doc(db,'sessions','legacy-parent','versions','old')
    await assertFails(updateDoc(ref,{text:'',title:null,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)}}));await assertFails(deleteDoc(ref));expect((await getDoc(ref)).data()).toEqual(original)

  })

  it('migrates personal session, nested memory and history with the owner key', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore()
      await setDoc(doc(adminDb, 'sessions', 'plain-session'), {
        uid: 'alice', teamId: null, text: 'synthetic session', title: 'session title',
        timestamp: 1, updatedAt: 1, attachments: [],
      })
      await setDoc(doc(adminDb, 'sessions', 'clean-session'), memory('alice'))
      await setDoc(doc(adminDb, 'sessions', 'other-owner'), {
        uid: 'bob', teamId: null, text: 'other private data', title: 'other title',
        timestamp: 1, updatedAt: 1,
      })
      await setDoc(doc(adminDb, 'users', 'alice', 'memories', 'plain-nested'), {
        uid: 'alice', text: 'synthetic nested', title: 'nested title',
        timestamp: 1, updatedAt: 1,
      })
      await setDoc(doc(adminDb, 'users', 'alice', 'memories', 'clean-nested'), {
        uid: 'alice', text: '', title: null,
        enc: { v: 1, iv: 'synthetic-iv', ct: 'synthetic-ciphertext' },
        timestamp: 1, updatedAt: 1,
      })
      await setDoc(doc(adminDb, 'sessions', 'plain-session', 'versions', 'v1'), {
        editorUid: 'alice', text: 'synthetic history', title: 'history title',
        createdAt: 1, previousUpdatedAt: 1, attachments: [],
      })
    })
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    if (!getApps().some((app) => app.name === '[DEFAULT]')) {
      initializeApp({ apiKey: 'synthetic-test-key', projectId })
    }
    const migrationEvents=new EventTarget()
    vi.stubGlobal('window', {
      crypto: globalThis.crypto,
      btoa: globalThis.btoa,
      atob: globalThis.atob,
      dispatchEvent: migrationEvents.dispatchEvent.bind(migrationEvents),
      addEventListener:migrationEvents.addEventListener.bind(migrationEvents),
      removeEventListener:migrationEvents.removeEventListener.bind(migrationEvents),
    })
    vi.stubEnv('VITE_FIREBASE_APPCHECK_SITE_KEY', '')
    const cryptoModule = await import('../src/services/memoryCrypto')
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    cryptoModule.setMemoryCryptoKeyForTests(key)
    const {migratePersonalRecord}=await import('../src/services/personalMigrationRecovery')
    const require=createRequire(import.meta.url),server=require('../../functions/lib/personalMigration.js'),admin=require('../../functions/node_modules/firebase-admin'),serverDeps={firestore:admin.firestore(),now:()=>Date.now()}
    const pending=new Map<string,import('../src/services/personalMigrationStore').StoredPersonalMigrationRequest>()
    const mutation={uid:()=> 'alice',ready:cryptoModule.isMemoryCryptoReady,subscribe:cryptoModule.onMemoryCryptoChanged}
    const clientDeps:import('../src/services/personalMigrationRecovery').PersonalMigrationClientDeps={enabled:()=>true,mutation,id:()=>crypto.randomUUID(),exclusive:async(_key,work)=>work(),encrypt:cryptoModule.encryptMemoryFields,decrypt:cryptoModule.decryptMemoryEnvelope,store:{get:async uid=>pending.get(uid),compareExchange:async(uid,expected,next,guard)=>{guard();expect(pending.has(uid)?JSON.stringify(pending.get(uid)):null).toBe(expected);if(next)pending.set(uid,next);else pending.delete(uid);}},call:async(mode,command)=>mode==='archive'?server.executePersonalMigrationArchive(command.actorUid,command,serverDeps):server.executePersonalMigrationCall(command.actorUid,mode,command,serverDeps)}
    const migrationDeps:import('../src/services/memoryCrypto').MemoryMigrationDeps={enabled:()=>true,mutation,migrateRecord:(uid,source,guard)=>migratePersonalRecord(uid,source,guard,clientDeps)}
    try {
      const result = await cryptoModule.migrateLegacyMemoriesToEncrypted('alice', undefined, { pageSize: 1 }, aliceDb,migrationDeps)
      expect(result).toMatchObject({ total: 3, migrated: 3, skipped: 2, failed: 0 })
      for (const path of [
        ['sessions', 'plain-session'],
        ['users', 'alice', 'memories', 'plain-nested'],
        ['sessions', 'plain-session', 'versions', 'v1'],
      ]) {
        const snapshot = await getDoc(doc(aliceDb, ...path))
        const data = snapshot.data()
        expect(data?.text).toBe('')
        expect(data?.title).toBeNull()
        expect(data?.enc?.v).toBe(1)
        const opened = await cryptoModule.decryptMemoryEnvelope(data?.enc)
        expect(opened.text).toMatch(/^synthetic /)
      }
      const repeat = await cryptoModule.migrateLegacyMemoriesToEncrypted('alice', undefined, { pageSize: 1 }, aliceDb,migrationDeps)
      expect(repeat).toMatchObject({ total: 0, migrated: 0, skipped: 5, failed: 0 })
      const other = await getDoc(doc(testEnv.authenticatedContext('bob').firestore(), 'sessions', 'other-owner'))
      expect(other.data()?.text).toBe('other private data')

      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'sessions', 'cancel-a'), {
          uid: 'alice', teamId: null, text: 'synthetic a', title: 'A', timestamp: 1, updatedAt: 1,
        })
        await setDoc(doc(context.firestore(), 'sessions', 'cancel-b'), {
          uid: 'alice', teamId: null, text: 'synthetic b', title: 'B', timestamp: 1, updatedAt: 1,
        })
        await setDoc(doc(context.firestore(), 'sessions', 'cancel-c'), {
          uid: 'alice', teamId: null, text: 'synthetic c', title: 'C', timestamp: 1, updatedAt: 1,
        })
      })
      const checkpointValues = new Map<string, string>()
      const checkpointStore = {
        getItem: (key: string) => checkpointValues.get(key) ?? null,
        setItem: (key: string, value: string) => { checkpointValues.set(key, value) },
        removeItem: (key: string) => { checkpointValues.delete(key) },
      }
      const checkpointKey = 'mnemosyne.memory-migration.v1.alice'
      const controller = new AbortController()
      await expect(cryptoModule.migrateLegacyMemoriesToEncrypted('alice', (progress) => {
        if (progress.migrated === 2) controller.abort()
      }, { pageSize: 1, signal: controller.signal, checkpointStore }, aliceDb,migrationDeps))
        .rejects.toBeInstanceOf(cryptoModule.MemoryMigrationCancelledError)
      expect(JSON.parse(checkpointValues.get(checkpointKey) ?? '{}'))
        .toMatchObject({ v: 1, phase: 'sessions', after: 'cancel-a' })
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'sessions', 'aaa-late'), {
          uid: 'alice', teamId: null, text: 'synthetic late', title: 'Late', timestamp: 1, updatedAt: 1,
        })
      })
      const resumed = await cryptoModule.migrateLegacyMemoriesToEncrypted('alice', undefined,
        { pageSize: 1, checkpointStore }, aliceDb,migrationDeps)
      expect(resumed).toMatchObject({ total: 2, migrated: 2, failed: 0 })
      expect(checkpointValues.has(checkpointKey)).toBe(false)
      const late = await getDoc(doc(aliceDb, 'sessions', 'aaa-late'))
      expect(late.data()?.enc?.v).toBe(1)
    } finally {
      cryptoModule.setMemoryCryptoKeyForTests(null)
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })

  it('keeps historical team memories readable while freezing new team writes', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore()
      await setDoc(doc(adminDb, 'teams', 'crew'), {
        ownerUid: 'alice', memberUids: ['alice', 'bob'],
      })
      await setDoc(doc(adminDb, 'sessions', 'team-old'), memory('alice', {
        teamId: 'crew', text: '', title: null,
        enc: { v: 1, iv: 'synthetic-iv', ct: 'synthetic-ciphertext' },
      }))
    })

    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()
    await assertSucceeds(getDoc(doc(aliceDb, 'sessions', 'team-old')))
    await assertSucceeds(getDoc(doc(bobDb, 'sessions', 'team-old')))
    await assertFails(setDoc(doc(aliceDb, 'sessions', 'team-new'), memory('alice', {
      teamId: 'crew', text: '', title: null,
      enc: { v: 1, iv: 'synthetic-iv', ct: 'synthetic-ciphertext' },
    })))
    await assertFails(updateDoc(doc(aliceDb, 'sessions', 'team-old'), { updatedAt: 2 }))
    await assertFails(updateDoc(doc(bobDb, 'sessions', 'team-old'), { updatedAt: 2 }))
    await assertFails(setDoc(doc(aliceDb, 'sessions', 'team-old', 'versions', 'v2'), {
      uid: 'alice', editorUid: 'alice', text: '', candidate: {},
    }))
    await assertFails(setDoc(doc(aliceDb, 'sessions', 'personal-new'), memory('alice')))
  })

  it('freezes new attachment metadata regardless of entitlement and preserves old references', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const proDb = testEnv.authenticatedContext('pro-user').firestore()

    await assertFails(setDoc(doc(aliceDb, 'sessions', 'free-attachment'), memory('alice', {
      attachments: [{ name: 'voice.wav', size: 123 }],
    })))
    await assertFails(setDoc(doc(proDb, 'sessions', 'pro-attachment'), memory('pro-user', {
      attachments: [{ name: 'voice.wav', size: 123 }],
    })))
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'sessions', 'old-attachment'), memory('alice', {
        attachments: [{ name: 'voice.wav', size: 123 }],
      }))
    })
    await assertFails(updateDoc(doc(aliceDb, 'sessions', 'old-attachment'), { updatedAt: 2 }))
    await assertFails(updateDoc(doc(aliceDb, 'sessions', 'old-attachment'), {
      attachments: [{ url: 'data:text/plain,plaintext' }],
    }))
    await assertFails(updateDoc(doc(aliceDb, 'sessions', 'old-attachment'), { attachments: [] }))
  })

  it('keeps legacy shared reads while every shared editor mutation requires a server protocol', async () => {
    const bobDb = testEnv.authenticatedContext('bob').firestore()

    await testEnv.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(), 'sessions', 'shared-memory'), memory('alice', {
      sharedWithIds: ['bob'],
    })))
    await assertSucceeds(getDoc(doc(bobDb,'sessions','shared-memory')))
    await assertFails(updateDoc(doc(bobDb, 'sessions', 'shared-memory'), {
      enc: { v: 1, iv: 'synthetic-iv-2', ct: 'synthetic-ciphertext-2' },
      updatedAt: 2,
    }))
    await assertFails(updateDoc(doc(bobDb, 'sessions', 'shared-memory'), {
      text: 'plaintext leak',
      updatedAt: 3,
    }))
    await assertFails(updateDoc(doc(bobDb, 'sessions', 'shared-memory'), {
      uid: 'bob',
      updatedAt: 3,
    }))
  })

  it('reserves mobile sync publication for server admission even with an owned active device', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()

    await assertFails(setDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-1'), envelope()))
    await testEnv.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'mobileSyncEnvelopes', 'env-1'), envelope()))
    await assertSucceeds(getDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-1')))
    await assertFails(getDoc(doc(bobDb, 'mobileSyncEnvelopes', 'env-1')))
    await assertFails(setDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-2'), envelope({
      deviceId: 'revoked-device',
    })))
    await assertFails(setDoc(doc(bobDb, 'mobileSyncEnvelopes', 'env-3'), envelope()))
  })

  it('reserves ACK and cleanup for the server while allowing only terminal expiry without payload mutation', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()

    await assertFails(setDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-4'), envelope()))
    await testEnv.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), 'mobileSyncEnvelopes', 'env-4'), envelope()))
    await assertFails(updateDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-4'), {
      status: 'pulled',
      pulledAt: 2,
      updatedAt: 2,
    }))
    await assertFails(updateDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-4'), {
      encryptedPayload: { iv: 'changed', data: 'changed' },
      updatedAt: 3,
    }))
    await assertFails(deleteDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-4')))
    await testEnv.withSecurityRulesDisabled(async context => updateDoc(doc(context.firestore(), 'mobileSyncEnvelopes', 'env-4'), {expiresAt: 1}))
    await assertFails(updateDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-4'), {status: 'failed', error: 'expired', updatedAt: 3}))
    await assertFails(updateDoc(doc(aliceDb, 'mobileSyncEnvelopes', 'env-4'), {status: 'queued', updatedAt: 4}))
  })

  it("reserves owned memory deletion for server tombstones and keeps revoked device IDs immutable", async () => {

    await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await setDoc(doc(db,'sessions','owned-delete'),memory('alice'))})
    const db=testEnv.authenticatedContext('alice').firestore(),ref=doc(db,'sessions','owned-delete')
    await assertFails(deleteDoc(ref));await assertFails(updateDoc(ref,{deletedAt:2,updatedAt:2}));await assertSucceeds(getDoc(ref))
    await assertFails(deleteDoc(doc(db,'trustedDevices','revoked-device')));await assertFails(updateDoc(doc(db,'trustedDevices','revoked-device'),{status:'active'}))

  })

  it('denies direct capsule SDK reads and writes, including owned encrypted documents', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()
    const bobDb = testEnv.authenticatedContext('bob').firestore()
    const anonDb = testEnv.unauthenticatedContext().firestore()

    const encryptedShare = {
      sessionId: 'memory-1',
      encrypted: true,
      ciphertext: {
        v: 1,
        alg: 'AES-GCM-PBKDF2',
        salt: 'c2FsdC1sb25nLWVub3VnaA==',
        iv: 'aXYtbG9uZy1lbm91Z2g=',
        data: 'Y2lwaGVydGV4dC1sb25nLWVub3VnaC1mb3ItcnVsZXM=',
      },
      titleHint: 'Memória',
      pack: false,
      itemCount: 1,
      createdAt: 1,
      expiresAt: 999999,
      views: 0,
      importCount: 0,
      uid: 'alice',
    }

    await assertFails(setDoc(doc(aliceDb, 'shares', 'cap-1'), encryptedShare))
    await testEnv.withSecurityRulesDisabled(async context=>{await setDoc(doc(context.firestore(), 'shares', 'cap-1'), encryptedShare)})
    await assertFails(getDoc(doc(anonDb, 'shares', 'cap-1')))
    await assertFails(getDoc(doc(aliceDb, 'shares', 'cap-1')))

    await assertFails(setDoc(doc(aliceDb, 'shares', 'cap-plain'), {
      ...encryptedShare,
      encrypted: false,
      text: 'should not be allowed',
    }))

    await assertFails(setDoc(doc(aliceDb, 'shares', 'cap-string-cipher'), {
      ...encryptedShare,
      ciphertext: 'legacy-string-ciphertext-not-allowed-anymore',
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

    await assertFails(updateDoc(doc(anonDb, 'shares', 'cap-1'), { views: 1 }))
    await assertFails(updateDoc(doc(bobDb, 'shares', 'cap-1'), {
      importCount: 1,
      lastImportedAt: 2,
    }))
    await assertFails(updateDoc(doc(bobDb, 'shares', 'cap-1'), {
      ciphertext: { ...encryptedShare.ciphertext, data: 'tampered' },
    }))
    await assertFails(deleteDoc(doc(bobDb, 'shares', 'cap-1')))
    await assertFails(deleteDoc(doc(aliceDb, 'shares', 'cap-1')))
  })

  it('reserves profile, identity, subscription and billing writes for server admission', async () => {
    const aliceDb = testEnv.authenticatedContext('alice').firestore()

    await assertFails(updateDoc(doc(aliceDb, 'users', 'alice'), { publicKeyPem: 'pem' }))
    const publication = writeBatch(aliceDb)
    publication.update(doc(aliceDb, 'users', 'alice'), { uid: 'alice', publicKeyPem: 'pem' })
    publication.set(doc(aliceDb, 'publicProfiles', 'alice'), { uid: 'alice', publicKeyPem: 'pem' })
    await assertFails(publication.commit())

    await assertFails(setDoc(doc(aliceDb, 'users', 'alice-paid'), {
      uid: 'alice',
      subscription: { tier: 'sovereign', status: 'active' },
    }))

    await assertFails(updateDoc(doc(aliceDb, 'users', 'alice'), {
      subscription: { tier: 'pro', status: 'active' },
    }))

    await assertFails(updateDoc(doc(aliceDb, 'users', 'alice'), {
      usage: { memoriesThisMonth: 0 },
    }))

    await assertFails(updateDoc(doc(aliceDb, 'users', 'alice'), {
      stripeCustomerId: 'cus_forged',
    }))

    await assertFails(updateDoc(doc(aliceDb, 'users', 'alice'), {
      displayName: 'Alice',
    }))

    await assertFails(setDoc(doc(aliceDb, 'entitlements', 'alice'), {
      tier: 'pro',
    }))
  })

  it('allows participant reads but contact mutation belongs to the idempotent server protocol', async () => {
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

    await assertFails(setDoc(doc(aliceDb, 'friendRequests', 'fr-1'), request))
    await assertFails(setDoc(doc(aliceDb, 'friendRequests', 'fr-self'), {
      ...request,
      toUid: 'alice',
    }))
    await testEnv.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'friendRequests', 'fr-1'), request)
    })
    await assertSucceeds(getDoc(doc(aliceDb, 'friendRequests', 'fr-1')))
    await assertSucceeds(getDoc(doc(bobDb, 'friendRequests', 'fr-1')))
    await assertFails(getDoc(doc(testEnv.authenticatedContext('carol').firestore(), 'friendRequests', 'fr-1')))
    await assertFails(updateDoc(doc(bobDb, 'friendRequests', 'fr-1'), {
      status: 'accepted',
      updatedAt: 2,
    }))
  })

  it("executes the server team editor with immutable authorship, history, CAS and owner-only tombstones", async () => {

    const events=new EventTarget();vi.stubGlobal('window',{crypto:globalThis.crypto,btoa:globalThis.btoa,atob:globalThis.atob,dispatchEvent:events.dispatchEvent.bind(events)})
    try{
      const oldKey=await generateTeamKey(),activeKey=await generateTeamKey(),keyId='22222222-2222-4222-8222-222222222222',wrap={v:1,ct:'synthetic-wrap'}
      const previous=await encryptLegacyTeamMemoryFields(oldKey,{text:'Synthetic prior team text',title:'Synthetic prior title'})
      const next=await encryptTeamMemoryFields(activeKey,{text:'Synthetic current team text',title:'Synthetic current title'},{teamId:'crew',keyEpoch:2,keyId})
      await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await setDoc(doc(db,'config','teamSecurity'),{writesEnabled:true});await setDoc(doc(db,'teams','crew'),{ownerUid:'alice',memberUids:['alice','bob'],roles:{alice:'owner',bob:'member'},wrappedKeys:{alice:wrap,bob:wrap},activeKeyEpoch:2,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null});await setDoc(doc(db,'teams','crew','keyEpochs','2'),{epoch:2,keyId,status:'active',memberUids:['alice','bob'],wrappedKeys:{alice:wrap,bob:wrap}});await setDoc(doc(db,'sessions','team-client'),{uid:'alice',teamId:'crew',timestamp:1,updatedAt:10,text:'',title:null,enc:previous})})
      const db=testEnv.authenticatedContext('bob').firestore(),require=createRequire(import.meta.url),server=require('../../functions/lib/memoryEdits'),admin=require('../../functions/node_modules/firebase-admin'),deps={firestore:admin.firestore(),now:()=>50}
      const prepare=async(uid:string,id='team-client',operation='edit')=>({operationId:crypto.randomUUID(),operation,baseline:await server.executeMemoryEditPreparation(uid,{sessionId:id,teamId:'crew'},deps),priorEnc:(await deps.firestore.doc('sessions/'+id).get()).data().enc,enc:operation==='delete'?null:next,metadata:operation==='delete'?{}:{tags:['synthetic']}})
      await server.executeMemoryEdit('bob',await prepare('bob'),'apply',deps)
      let saved=(await getDoc(doc(db,'sessions','team-client'))).data()!;expect(saved.uid).toBe('alice');expect(saved.timestamp).toBe(1);expect(saved.updatedAt).toBe(50)
      expect((await decryptTeamMemoryEnvelope(activeKey,saved.enc,{teamId:'crew',keyEpoch:2,keyId})).text).toBe('Synthetic current team text')
      await expect(decryptTeamMemoryEnvelope(oldKey,saved.enc,{teamId:'crew',keyEpoch:2,keyId})).rejects.toBeTruthy()
      expect((await getDoc(doc(db,'sessions','team-client','versions',saved.lastVersionId))).data()!.enc).toEqual(previous)
      const one=await prepare('bob'),two=await prepare('bob'),competing=await Promise.allSettled([server.executeMemoryEdit('bob',one,'apply',deps),server.executeMemoryEdit('bob',two,'apply',deps)])
      expect(competing.filter(item=>item.status==='fulfilled')).toHaveLength(1);expect((await getDocs(collection(db,'sessions','team-client','versions'))).size).toBe(2)
      const pending=await prepare('bob');await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await updateDoc(doc(db,'teams','crew'),{keyRotationStatus:'rotation_pending'})})
      await expect(server.executeMemoryEdit('bob',pending,'apply',deps)).rejects.toBeTruthy()
      await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await updateDoc(doc(db,'teams','crew'),{keyRotationStatus:'active'});await setDoc(doc(db,'sessions','team-legacy-time'),{uid:'alice',teamId:'crew',timestamp:Timestamp.fromMillis(1),updatedAt:Timestamp.fromMillis(10),text:'',title:null,enc:previous})})
      await server.executeMemoryEdit('bob',await prepare('bob','team-legacy-time'),'apply',deps)
      const historical=(await getDoc(doc(db,'sessions','team-legacy-time'))).data()!;expect(historical.timestamp.toMillis()).toBe(1);expect((await getDoc(doc(db,'sessions','team-legacy-time','versions',historical.lastVersionId))).data()!.previousUpdatedAt.toMillis()).toBe(10)
      await expect(server.executeMemoryEdit('bob',await prepare('bob','team-client','delete'),'apply',deps)).rejects.toBeTruthy()
      await server.executeMemoryEdit('alice',await prepare('alice','team-client','delete'),'apply',deps)
      saved=(await getDoc(doc(db,'sessions','team-client'))).data()!;expect(saved.deletedAt).toBe(52);expect((await getDocs(collection(db,'sessions','team-client','versions'))).size).toBe(3)
      await assertFails(deleteDoc(doc(db,'sessions','team-client')));await assertFails(updateDoc(doc(testEnv.authenticatedContext('alice').firestore(),'sessions','team-client'),{deletedAt:null,updatedAt:53}))
      await expect(prepare('alice')).rejects.toBeTruthy()
    }finally{vi.unstubAllGlobals()}

  })

  it('reciphers stored team history with real crypto, immutable metadata, admin ACL, CAS and separate maintenance gates', async () => {
    const events = new EventTarget()
    vi.stubGlobal('window', { crypto: globalThis.crypto, btoa: globalThis.btoa, atob: globalThis.atob, dispatchEvent: events.dispatchEvent.bind(events),
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) })
    setMemoryCryptoKeyForTests(await generateTeamKey())
    try {
      const oldKey = await generateTeamKey(); const activeKey = await generateTeamKey()
      const keyId = '22222222-2222-4222-8222-222222222222'; const jobId = '33333333-3333-4333-8333-333333333333'
      const wrap = { v: 1, alg: 'RSA-OAEP', ct: 'synthetic-wrap' }
      const oldEnc = await encryptLegacyTeamMemoryFields(oldKey, { text: 'Synthetic historic note', title: 'Synthetic title' })
      const team = { id: 'history-crew', name: 'Synthetic', createdAt: 1, ownerUid: 'alice', memberUids: ['alice', 'bob', 'member'],
        roles: { alice: 'owner' as const, bob: 'admin' as const, member: 'member' as const }, wrappedKeys: { alice: wrap, bob: wrap, member: wrap },
        activeKeyEpoch: 2, activeKeyId: keyId, keyRotationStatus: 'active' as const, pendingRotationId: null }
      const previous = { teamId: team.id, uid: 'alice', timestamp: 1, updatedAt: 10, deletedAt: 20, text: '', title: null, enc: oldEnc, tags: ['synthetic'] }
      const historicalVersion = { createdAt: 10, previousUpdatedAt: Timestamp.fromMillis(9), editorUid: 'alice', text: '', title: null, enc: oldEnc }
      await testEnv.withSecurityRulesDisabled(async ctx => {
        const db = ctx.firestore()
        await setDoc(doc(db, 'users', 'member'), userDoc('free'))
        await setDoc(doc(db, 'config', 'teamSecurity'), { writesEnabled: false, historyReencryptionEnabled: true })
        await setDoc(doc(db, 'teams', team.id), team)
        await setDoc(doc(db, 'teams', team.id, 'keyEpochs', '2'), { epoch: 2, keyId, status: 'active', memberUids: team.memberUids, wrappedKeys: team.wrappedKeys })
        await setDoc(doc(db, 'sessions', 'history-parent'), previous)
        await setDoc(doc(db, 'sessions', 'history-parent', 'versions', 'legacy'), historicalVersion)
        await setDoc(doc(db, 'sessions', 'history-other'), previous)
      })
      const db = testEnv.authenticatedContext('bob').firestore()
      const require = createRequire(import.meta.url), server = require('../../functions/lib/teamHistoryChanges.js'), admin = require('../../functions/node_modules/firebase-admin')
      const serverDeps = {firestore: admin.firestore(), now: () => Date.now()}, pending = new Map<string, import('../src/services/teamHistoryChangeStore').StoredTeamHistoryChange>()
      const local = new Map<string, string>(), storage = {getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => {local.set(key, value)}}
      const changeClient: import('../src/services/teamHistoryChangeRecovery').TeamHistoryChangeClientDeps = {
        enabled: () => true, jobStorage: storage, id: () => crypto.randomUUID(), exclusive: async (_name, work) => work(), generation: () => 0, observe: () => () => {},
        store: {get: async (_uid, teamId) => pending.get(teamId), teams: async () => [...pending.keys()], compareExchange: async (_uid, teamId, expected, next, guard) => {
          guard(); expect(pending.has(teamId) ? JSON.stringify(pending.get(teamId)) : null).toBe(expected); if (next) pending.set(teamId, next); else pending.delete(teamId)
        }}, encrypt: encryptMemoryFields, decrypt: decryptMemoryEnvelope, readTeam: async teamId => (await getDocFromServer(doc(db, 'teams', teamId))).data()!,
        readParent: async sessionId => (await getDocFromServer(doc(db, 'sessions', sessionId))).data()!,
        unlock: async (_team, _uid, _words, options) => options?.epoch === 1 ? oldKey : activeKey,
        recipher: recipherTeamMemoryEnvelope, openPayload: decryptTeamMemoryPayload, mutation: {uid: () => 'bob', ready: () => true, subscribe: () => () => {}},
        call: (mode, command) => server.executeTeamHistoryChangeCall(command.actorUid, mode, command, serverDeps),
      }
      const context = { firestore: db as unknown as Firestore, currentUid: () => 'bob', cryptoReady: () => true, changeClient,
        subscribeCrypto: () => () => undefined, cacheGeneration: () => 0, now: () => 50,
        unlock: async (_team: unknown, _uid: string, _mnemonic: string[] | null, options?: { epoch?: number }) => options?.epoch === 1 ? oldKey : activeKey }
      const words = Array.from({ length: 12 }, () => 'synthetic')
      await expect(rewriteTeamHistoryEntry({ sessionId: 'history-parent', data: previous }, team, 'bob', jobId, words, () => undefined, context)).resolves.toBe('rewritten')
      const saved = (await getDoc(doc(db, 'sessions', 'history-parent'))).data()!
      for (const key of ['uid', 'timestamp', 'updatedAt', 'deletedAt', 'tags']) expect(saved[key]).toEqual(previous[key as keyof typeof previous])
      expect(saved.rekeyRevision).toBe(1); expect(saved.rekeyedByUid).toBe('bob')
      const cipherContext = { teamId: team.id, keyEpoch: 2, keyId }
      expect((await decryptTeamMemoryEnvelope(activeKey, saved.enc, cipherContext)).text === 'Synthetic historic note').toBe(true)
      await expect(decryptTeamMemoryEnvelope(oldKey, saved.enc, cipherContext)).rejects.toBeTruthy()
      await expect(rewriteTeamHistoryEntry({ sessionId: 'history-parent', versionId: 'legacy', data: historicalVersion }, team, 'bob', jobId, words, () => undefined, context)).resolves.toBe('rewritten')
      expect((await getDocs(collection(db, 'sessions', 'history-parent', 'versions'))).size).toBe(1)
      const version = (await getDoc(doc(db, 'sessions', 'history-parent', 'versions', 'legacy'))).data()!
      expect(version.createdAt).toBe(10); expect(version.previousUpdatedAt.toMillis()).toBe(9); expect(version.editorUid).toBe('alice')
      await expect(rewriteTeamHistoryEntry({ sessionId: 'history-parent', data: saved }, team, 'bob', jobId, words, () => undefined, context)).resolves.toBe('rewritten')
      expect((await getDoc(doc(db, 'sessions', 'history-parent'))).data()!.rekeyRevision).toBe(1)
      const patch = { enc: saved.enc, keyEpoch: 2, keyId, rekeyRevision: 1, rekeyJobId: jobId, rekeyedByUid: 'bob' }
      const otherRef = doc(db, 'sessions', 'history-other')
      for (const invalid of [{ ...patch, updatedAt: 11 }, { ...patch, uid: 'bob' }, { ...patch, text: 'Synthetic plaintext' },
        { ...patch, rekeyRevision: 2 }, { ...patch, keyEpoch: 1 }, { ...patch, rekeyedByUid: 'alice' }, { ...patch, teamId: 'different' }]) {
        await assertFails(updateDoc(otherRef, invalid))
      }
      const memberDb = testEnv.authenticatedContext('member').firestore()
      await assertFails(updateDoc(doc(memberDb, 'sessions', 'history-other'), { ...patch, rekeyedByUid: 'member' }))
      await assertFails(updateDoc(doc(memberDb, 'sessions', 'history-parent', 'versions', 'legacy'), { ...patch, rekeyedByUid: 'member', rekeyRevision: 2 }))
      await assertFails(getDoc(doc(testEnv.authenticatedContext('removed').firestore(), 'sessions', 'history-parent')))
      await assertFails(updateDoc(doc(db, 'sessions', 'history-parent', 'versions', 'legacy'), { ...patch, createdAt: 11, rekeyRevision: 2 }))
      await testEnv.withSecurityRulesDisabled(async ctx => updateDoc(doc(ctx.firestore(), 'config', 'teamSecurity'), { historyReencryptionEnabled: false }))
      await assertFails(updateDoc(otherRef, patch))
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await updateDoc(doc(ctx.firestore(), 'config', 'teamSecurity'), { historyReencryptionEnabled: true })
        await updateDoc(doc(ctx.firestore(), 'users', 'bob'), { deletionState: 'deleting' })
      })
      await assertFails(updateDoc(otherRef, patch))
      await testEnv.withSecurityRulesDisabled(async ctx => updateDoc(doc(ctx.firestore(), 'users', 'bob'), { deletionState: null }))
      const changedContext = { ...context, changeClient: {...changeClient, unlock: async (...args: Parameters<typeof context.unlock>) => {
        await testEnv.withSecurityRulesDisabled(async ctx => updateDoc(doc(ctx.firestore(), 'sessions', 'history-other'), { updatedAt: 11 }))
        return context.unlock(...args)
      } } }
      await expect(rewriteTeamHistoryEntry({ sessionId: 'history-other', data: previous }, team, 'bob', jobId, words, () => undefined, changedContext)).rejects.toMatchObject({ code: 'aborted' })
      const {cancelTeamHistoryChange, recoverTeamHistoryChangeWithinJob, cancelTeamHistoryChangeWithinJob} = await import('../src/services/teamHistoryChangeRecovery')
      await cancelTeamHistoryChange('bob', team.id, () => {}, changeClient)
      const incompatible = await encryptTextAesGcm(JSON.stringify({ text: 'Synthetic', extra: 'Do not drop this' }), oldKey)
      await testEnv.withSecurityRulesDisabled(async ctx => updateDoc(doc(ctx.firestore(), 'sessions', 'history-other'), { updatedAt: 10, enc: { v: 1, iv: incompatible.iv, ct: incompatible.data } }))
      const source = (await getDoc(otherRef)).data()!
      await expect(rewriteTeamHistoryEntry({ sessionId: 'history-other', data: source }, team, 'bob', jobId, words, () => undefined, context)).rejects.toBeTruthy()
      expect((await getDoc(otherRef)).data()!.enc === undefined).toBe(false)
      expect((await getDoc(otherRef)).data()!.keyEpoch).toBeUndefined()
      // Drive the production page reader and coordinator against the emulator, including a cursor within >10 versions.
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await setDoc(doc(ctx.firestore(), 'sessions', 'history-other'), previous)
        for (let index = 0; index < 25; index++) await setDoc(doc(ctx.firestore(), 'sessions', 'history-parent', 'versions', `v${String(index).padStart(2, '0')}`), historicalVersion)
      })
      let control: 'run' | 'pause' = 'run'
      const deps: TeamHistoryDeps = { ...context, recoverEntry: recoverTeamHistoryChangeWithinJob, cancelEntry: cancelTeamHistoryChangeWithinJob, storage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => { local.set(key, value) } },
        exclusive: async (_name, work) => work(), encryptCheckpoint: encryptMemoryFields, decryptCheckpoint: decryptMemoryEnvelope,
        loadTeam: async () => team,
        loadSession: async sessionId => ({ sessionId, data: (await getDoc(doc(db, 'sessions', sessionId))).data()! }),
        page: (...args) => readTeamHistoryPage(...args, db as unknown as Firestore),
        rewrite: (entry, team, uid, jobId, words, guard, confirmed) => rewriteTeamHistoryEntry(entry, team, uid, jobId, words, guard, context, confirmed) }
      const input = { uid: 'bob', teamId: team.id, mnemonic: words, confirmed: true as const, control: () => control,
        onProgress: (job: { scanned: number; status: string }) => { if (job.scanned === 5 && job.status === 'running') control = 'pause' } }
      // history-other sorts before history-parent, so its parent consumes the first progress count.
      await expect(runTeamHistoryReencryption(input, deps)).resolves.toMatchObject({ status: 'paused', versionCursor: 'v01', scanned: 5 })
      control = 'run'
      await expect(runTeamHistoryReencryption({ ...input, onProgress: () => undefined }, deps)).resolves.toMatchObject({ status: 'complete', scanned: 28, rewritten: 26, alreadyTarget: 2 })
      const storedVersions = await getDocs(collection(db, 'sessions', 'history-parent', 'versions'))
      expect(storedVersions.size).toBe(26)
      expect(storedVersions.docs.every(item => item.data().keyEpoch === 2 && item.data().rekeyRevision === 1)).toBe(true)
      expect(Object.keys(JSON.parse([...local.values()][0])).sort()).toEqual(['ct', 'iv', 'v'])
      // Verify the cursor ordering assumption against actual document-name queries, including supplementary Unicode.
      await testEnv.withSecurityRulesDisabled(async ctx => {
        await setDoc(doc(ctx.firestore(), 'sessions', 'history-unicode'), previous)
        for (const id of ['\u{10000}', '\uE000']) await setDoc(doc(ctx.firestore(), 'sessions', 'history-unicode', 'versions', id), historicalVersion)
      })
      const unicode = await readTeamHistoryPage(team.id, 'history-unicode', null, 10, db as unknown as Firestore)
      expect(unicode.map(row => row.versionId)).toEqual(['\uE000', '\u{10000}'])
      expect((await readTeamHistoryPage(team.id, 'history-unicode', '\uE000', 10, db as unknown as Firestore)).map(row => row.versionId)).toEqual(['\u{10000}'])
      await expect(readTeamHistoryPage(team.id, null, null, 11, db as unknown as Firestore)).rejects.toMatchObject({ reason: 'invalid' })
      await expect(readTeamHistoryPage(team.id, null, null, 5, testEnv.authenticatedContext('removed').firestore() as unknown as Firestore)).rejects.toBeTruthy()
    } finally { setMemoryCryptoKeyForTests(null); vi.unstubAllGlobals() }
  })

  it("executes reciprocal team connections through the server with real crypto, exact history and concurrent CAS", async () => {

    const events=new EventTarget();vi.stubGlobal('window',{crypto:globalThis.crypto,btoa:globalThis.btoa,atob:globalThis.atob,dispatchEvent:events.dispatchEvent.bind(events)})
    try{
      const oldKey=await generateTeamKey(),activeKey=await generateTeamKey(),keyId='55555555-5555-4555-8555-555555555555',wrap={v:1,ct:'synthetic-wrap'},teamId='link-crew'
      const enc=await encryptLegacyTeamMemoryFields(oldKey,{text:'Synthetic connected note',title:'Synthetic title'})
      const parents=[{uid:'alice',teamId,timestamp:1,updatedAt:10,text:'',title:null,enc,connections:[]},{uid:'bob',teamId,timestamp:Timestamp.fromMillis(2),updatedAt:Timestamp.fromMillis(20),text:'',title:null,enc,connections:[]}]
      await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await setDoc(doc(db,'config','teamSecurity'),{writesEnabled:true});await setDoc(doc(db,'teams',teamId),{ownerUid:'alice',memberUids:['alice','bob'],roles:{alice:'owner',bob:'member'},wrappedKeys:{alice:wrap,bob:wrap},activeKeyEpoch:2,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null});await setDoc(doc(db,'teams',teamId,'keyEpochs','2'),{epoch:2,keyId,status:'active',memberUids:['alice','bob'],wrappedKeys:{alice:wrap,bob:wrap}});for(const[index,id]of['link-a','link-b'].entries())await setDoc(doc(db,'sessions',id),parents[index]);await setDoc(doc(db,'sessions','link-personal'),{...parents[0],teamId:null})})
      const db=testEnv.authenticatedContext('bob').firestore(),require=createRequire(import.meta.url),server=require('../../functions/lib/teamConnections'),admin=require('../../functions/node_modules/firebase-admin'),deps={firestore:admin.firestore(),now:()=>50}
      const target={teamId,sessionIds:['link-a','link-b']},fresh=await server.executeTeamConnectionPreparation('bob',target,deps)
      const encs=await Promise.all(parents.map(()=>encryptTeamMemoryFields(activeKey,{text:'Synthetic connected note',title:'Synthetic title'},{teamId,keyEpoch:2,keyId})))
      await server.executeTeamConnection('bob',{operationId:crypto.randomUUID(),operation:'link',baselines:fresh,priorEncs:[enc,enc],encs},'apply',deps)
      const first=(await getDoc(doc(db,'sessions','link-a'))).data()!,second=(await getDoc(doc(db,'sessions','link-b'))).data()!
      expect(first.connections).toEqual(['link-b']);expect(second.connections).toEqual(['link-a']);expect(first.uid).toBe('alice');expect(second.uid).toBe('bob');expect(second.timestamp.toMillis()).toBe(2);expect(first.connectionChange.id).toBe(second.connectionChange.id)
      for(const[index,id]of['link-a','link-b'].entries()){const parent=index===0?first:second,versions=await getDocs(collection(db,'sessions',id,'versions'));expect(versions.size).toBe(1);expect(versions.docs[0].data().enc).toEqual(enc);expect(versions.docs[0].data().connections).toEqual([]);expect((await decryptTeamMemoryEnvelope(activeKey,parent.enc,{teamId,keyEpoch:2,keyId})).text).toBe('Synthetic connected note');await expect(decryptTeamMemoryEnvelope(oldKey,parent.enc,{teamId,keyEpoch:2,keyId})).rejects.toBeTruthy()}
      const batch=writeBatch(db);batch.update(doc(db,'sessions','link-a'),{connections:[],updatedAt:51});batch.set(doc(db,'sessions','link-a','versions','forged'),{enc:first.enc});await assertFails(batch.commit())
      const bases=await server.executeTeamConnectionPreparation('bob',target,deps),unlinkEncs=await Promise.all(parents.map(()=>encryptTeamMemoryFields(activeKey,{text:'Synthetic connected note',title:'Synthetic title'},{teamId,keyEpoch:2,keyId}))),command={operation:'unlink',baselines:bases,priorEncs:[first.enc,second.enc],encs:unlinkEncs}
      const concurrent=await Promise.allSettled([server.executeTeamConnection('bob',{...command,operationId:crypto.randomUUID()},'apply',deps),server.executeTeamConnection('bob',{...command,operationId:crypto.randomUUID()},'apply',deps)])
      expect(concurrent.filter(result=>result.status==='fulfilled')).toHaveLength(1)
      for(const id of['link-a','link-b']){expect((await getDoc(doc(db,'sessions',id))).data()!.connections).toEqual([]);expect((await getDocs(collection(db,'sessions',id,'versions'))).size).toBe(2)}
      await expect(server.executeTeamConnectionPreparation('bob',{teamId,sessionIds:['link-a','link-personal']},deps)).rejects.toBeTruthy()
      await testEnv.withSecurityRulesDisabled(async ctx => {const db=ctx.firestore();await updateDoc(doc(db,'teams',teamId),{keyRotationStatus:'rotation_pending'})})
      await expect(server.executeTeamConnectionPreparation('bob',target,deps)).rejects.toBeTruthy();await assertFails(getDoc(doc(testEnv.authenticatedContext('removed').firestore(),'sessions','link-a')))
    }finally{vi.unstubAllGlobals()}

  })

  it('allows relay participant reads while idempotent admission and recipient ACK require the server', async () => {
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

    await assertFails(setDoc(doc(aliceDb, 'transmissions', 'tx-1'), capsule))
    await testEnv.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(), 'transmissions', 'tx-1'), capsule))
    await assertSucceeds(getDoc(doc(aliceDb, 'transmissions', 'tx-1')))
    await assertSucceeds(getDoc(doc(bobDb, 'transmissions', 'tx-1')))
    await assertFails(getDoc(doc(testEnv.authenticatedContext('carol').firestore(), 'transmissions', 'tx-1')))
    await assertFails(setDoc(doc(aliceDb, 'transmissions', 'tx-self'), {
      ...capsule,
      recipientId: 'alice',
    }))
    await assertFails(setDoc(doc(aliceDb, 'transmissions', 'tx-extra'), {
      ...capsule,
      channel: 'relay',
    }))

    await assertFails(updateDoc(doc(bobDb, 'transmissions', 'tx-1'), {
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
