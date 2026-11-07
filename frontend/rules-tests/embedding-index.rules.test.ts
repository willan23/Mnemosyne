import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,type Firestore} from 'firebase/firestore';
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({db:undefined as unknown,uid:'alice'}));
vi.mock('../src/firebase',()=>({default:{},auth:{},get db(){return state.db;}}));
import {embeddingIndexHistoryDependencies,loadEmbeddingIndexHistory} from '../src/services/embeddingIndexManagement';
import {embeddingIndexViewDigest} from '../src/services/embeddingIndexRecovery';
import {buildEncryptedMemoryFields,setMemoryCryptoKeyForTests} from '../src/services/memoryCrypto';
// Separate emulator namespace: the existing Rules suite clears its own project before each case.
const projectId='demo-mnemosyne-index-sdk';
let environment:RulesTestEnvironment,row:Record<string,unknown>,viewDigest:string;
const nonce='11111111-1111-4111-8111-111111111111';
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('embedding index SDK history',()=>{
  beforeAll(async()=>{if(!projectId.startsWith('demo-'))throw Error('Explicit demo project required');const events=new EventTarget();vi.stubGlobal('window',{crypto:globalThis.crypto,btoa:globalThis.btoa,atob:globalThis.atob,dispatchEvent:events.dispatchEvent.bind(events)});environment=await initializeTestEnvironment({projectId,firestore:{rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});});
  beforeEach(async()=>{await environment.clearFirestore();state.uid='alice';setMemoryCryptoKeyForTests(await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']));
    row={uid:'alice',teamId:null,text:'',title:null,timestamp:1,updatedAt:10,...await buildEncryptedMemoryFields('Synthetic SDK history',null)};viewDigest=await embeddingIndexViewDigest(row);
    const contentDigest=await embeddingIndexViewDigest({uid:'alice',teamId:null,enc:row.enc,keyEpoch:null,keyId:null});
    await environment.withSecurityRulesDisabled(async context=>{const db=context.firestore() as unknown as Firestore;await setDoc(doc(db,'users/alice'),{});await setDoc(doc(db,'users/bob'),{});await setDoc(doc(db,'sessions/note'),row);
      for(let n=0;n<25;n++)await setDoc(doc(db,'sessions/note/versions/content-'+n),{...row,createdAt:200+n});
      await setDoc(doc(db,'sessions/note/versions/embedding-index-'+nonce),{...row,createdAt:100,previousUpdatedAt:1,embedding:[1,0],embeddingIndex:{v:1,operationId:nonce,kind:'publish',contentDigest}});
    });state.db=environment.authenticatedContext('alice').firestore();
  });
  afterAll(async()=>{setMemoryCryptoKeyForTests(null);await environment?.cleanup();vi.unstubAllGlobals();});
  const input=()=>({uid:'alice',id:'note',viewDigest,assertCurrent:()=>{}});
  const deps=()=>({...embeddingIndexHistoryDependencies(),mutation:{uid:()=>state.uid,ready:()=>true,subscribe:()=>()=>{}}});
  it('uses actual SDK server reads and snapshot cursors to reach an index archive behind 25 content versions',async()=>{
    const first=await loadEmbeddingIndexHistory(input(),deps());expect(first.entries).toEqual([]);expect(first.next).not.toBeNull();
    const second=await loadEmbeddingIndexHistory({...input(),cursor:first.next},deps());expect(second.entries).toMatchObject([{versionId:'embedding-index-'+nonce,rollbackAllowed:true,dimensions:2}]);expect(second.next).toBeNull();
  });
  it('SDK denies a foreign owner and a parent revoked after a real page query never returns its old history',async()=>{
    state.db=environment.authenticatedContext('bob').firestore();await expect(loadEmbeddingIndexHistory(input(),deps())).rejects.toThrow();state.db=environment.authenticatedContext('alice').firestore();
    const real=deps();const page=real.page;real.page=async(id,tail)=>{const result=await page(id,tail);await environment.withSecurityRulesDisabled(async context=>{await updateDoc(doc(context.firestore() as unknown as Firestore,'sessions/note'),{uid:'bob'});});return result;};
    await expect(loadEmbeddingIndexHistory(input(),real)).rejects.toThrow();
  });
});
