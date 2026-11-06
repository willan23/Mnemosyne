const assert = require('node:assert/strict'); const test = require('node:test');
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-mnemosyne-test';
const {parseSyncImportBatch, parseSyncImportStatusInput, canonicalSyncState, normalizedSyncMetadata, SYNC_MEMORY_METADATA_FIELDS} = require('../lib/mobileSyncImportContract');
const {executeSyncImportBatch, executeSyncImportStatus, executeSyncImportPreparation, applyMobileSyncImportBatch, getMobileSyncImportStatus, prepareMobileSyncImportBatch, syncStateHash, syncDocumentStateHash, syncConflictId} = require('../lib/mobileSyncImport');
const admin=require('firebase-admin');
const updateTime=admin.firestore.Timestamp.fromMillis(1);
const docHash=data=>syncDocumentStateHash({exists:true,updateTime,data:()=>data});
const enc = {v: 1, iv: 'A'.repeat(16), ct: 'B'.repeat(32)};
const payload = {iv: 'A'.repeat(16), data: 'B'.repeat(32)};
const identity = {envelopeId: 'envelope', deviceId: 'phone', direction: 'desktop-to-mobile', payloadDigest: syncStateHash(payload)};
const input = {...identity, cursor: 0, changes: [{sessionId: 'new', expectedStateHash: null, action: 'create', incomingRevision: 20, timestamp: 10, enc, metadata: {tags: ['Synthetic']}}]};
function fake(count=1) {
  const docs = new Map([['users/alice',{}],['trustedDevices/phone',{deviceId:'phone',ownerUid:'alice',status:'active'}],['mobileSyncEnvelopes/envelope',{ownerUid:'alice',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-snapshot',status:'queued',memoryCount:count,encryptedPayload:payload,expiresAt:100000}]]);
  const doc = path => ({path,id:path.split('/').pop(),collection:name=>({doc:id=>doc(`${path}/${name}/${id}`)})});
  let transactions=0;
  const db = {doc,runTransaction:async work=>{
    transactions++; const writes=[];
    const get=async ref=>{assert.equal(writes.length,0,'all reads precede writes'); const value=docs.get(ref.path); return {ref,exists:docs.has(ref.path),updateTime,data:()=>value};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),
      create:(ref,data)=>{assert.equal(docs.has(ref.path),false);writes.push({ref,data,mode:'create'});},
      set:(ref,data)=>writes.push({ref,data,mode:'set'}),update:(ref,data)=>writes.push({ref,data,mode:'update'})});
    for(const write of writes) {
      const saved=write.mode==='update'?{...docs.get(write.ref.path)}:{};
      for(const [key,value] of Object.entries(write.data)){if(value&&typeof value.isEqual==='function'&&value.isEqual(admin.firestore.FieldValue.delete()))delete saved[key];else saved[key]=value;}
      docs.set(write.ref.path,saved);
    }
    return result;
  }};
  return {docs,deps:{firestore:db,now:()=>1000},transactions:()=>transactions};
}
test('encrypted sync accepts bounded ciphertext/metadata and rejects plaintext, authority, malformed plans and unbounded input',()=>{
  assert.deepEqual(parseSyncImportBatch(input),input); assert.deepEqual(parseSyncImportStatusInput(identity),identity);
  const change=input.changes[0];
  for(const value of [null,[],{...input,uid:'alice'},{...input,text:'Synthetic'}, {...input,cursor:-1},{...input,changes:Array(11).fill(change)},
    {...input,changes:[change,change]}, {...input,changes:[{...change,sessionId:'a/b'}]}, {...input,changes:[{...change,teamId:'crew'}]},
    {...input,changes:[{...change,enc:{...enc,v:2}}]}, {...input,changes:[{...change,enc:{...enc,ct:'*'.repeat(32)}}]},
    {...input,changes:[{...change,metadata:{title:'Synthetic'}}]}, {...input,changes:[{...change,metadata:{attachments:[]}}]},
    {...input,changes:[{...change,metadata:{embedding:[Infinity],embeddingModel:'Synthetic'}}]}, {...input,changes:[{...change,metadata:{connections:['a/b']}}]},
    {...input,changes:[{...change,action:'skip'}]}, {...input,changes:[{...change,action:'update'}]}]) assert.throws(()=>parseSyncImportBatch(value));
});
test('canonical state sorts maps, distinguishes SDK values from lookalike maps, and rejects unsupported non-finite data',()=>{
  const admin=require('firebase-admin'); const timestamp=admin.firestore.Timestamp.fromMillis(1234);
  assert.equal(canonicalSyncState({b:2,a:1}),canonicalSyncState({a:1,b:2}));
  assert.notEqual(canonicalSyncState(timestamp),canonicalSyncState({seconds:timestamp.seconds,nanoseconds:timestamp.nanoseconds}));
  assert.equal(canonicalSyncState(timestamp),canonicalSyncState({seconds:timestamp.seconds,nanoseconds:timestamp.nanoseconds,toMillis:()=>1234}));
  assert.notEqual(canonicalSyncState([1,2]),canonicalSyncState({'0':1,'1':2})); assert.throws(()=>canonicalSyncState(NaN));
  const ref=admin.firestore().doc('sessions/reference');assert.notEqual(canonicalSyncState(ref),canonicalSyncState({path:ref.path,id:ref.id,firestore:{}}));
  const {Firestore}=admin.firestore;
  const other=new Firestore({projectId:'demo-other-sync',databaseId:'(default)'}).doc(ref.path);
  const otherDatabase=new Firestore({projectId:ref.firestore.projectId,databaseId:'synthetic-sync'}).doc(ref.path);
  assert.notEqual(canonicalSyncState(ref),canonicalSyncState(other));assert.notEqual(canonicalSyncState(ref),canonicalSyncState(otherDatabase));
  assert.equal(canonicalSyncState(ref),canonicalSyncState({path:ref.path,id:ref.id,firestore:{_databaseId:{projectId:ref.firestore.projectId,database:ref.firestore.databaseId}},withConverter:()=>{}}));
});
test('a new tombstone does not consume memory quota and has a permanent creation receipt',async()=>{
  const f=fake();f.docs.set('config/monetization',{mode:'paid'});f.docs.set('users/alice',{usage:{memoriesThisMonth:30,periodYear:1970,periodMonth:1}});
  const result=await executeSyncImportBatch('alice',{...input,changes:[{...input.changes[0],action:'tombstone'}]},f.deps);
  assert.equal(result.status,'complete');assert.equal(f.docs.get('sessions/new').deletedAt,1000);assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,30);
  assert.equal(f.docs.has('memoryCreationReceipts/new'),true);assert.equal(f.docs.has('memoryUsageReceipts/new'),false);
});
test('document CAS includes the server version stamp even when decoded data is unchanged and refuses missing stamps',()=>{
  const data={uid:'alice',teamId:null,text:'',title:null,enc};
  assert.notEqual(docHash(data),syncDocumentStateHash({exists:true,updateTime:admin.firestore.Timestamp.fromMillis(2),data:()=>data}));
  assert.throws(()=>syncDocumentStateHash({exists:true,data:()=>data}));
});
test('callables fail before rate/database work for missing Auth, invalid data and a closed import gate; no secrets bind',async()=>{
  await assert.rejects(applyMobileSyncImportBatch.run(input,{}),{code:'unauthenticated'});
  await assert.rejects(applyMobileSyncImportBatch.run({...input,text:'Synthetic'},{auth:{uid:'alice'}}),{code:'invalid-argument'});
  await assert.rejects(applyMobileSyncImportBatch.run(input,{auth:{uid:'alice'}}),{code:'failed-precondition'});
  await assert.rejects(getMobileSyncImportStatus.run({...identity,token:'Synthetic'},{auth:{uid:'alice'}}),{code:'invalid-argument'});
  await assert.rejects(prepareMobileSyncImportBatch.run({...identity,cursor:0,sessionIds:['new']},{}),{code:'unauthenticated'});
  for(const handler of [applyMobileSyncImportBatch,getMobileSyncImportStatus,prepareMobileSyncImportBatch]) assert.deepEqual(handler.__endpoint.secretEnvironmentVariables||[],[]);
});
test('preparation projects only owned personal ciphertext and state hashes, including absent targets; scope is checked before any return',async()=>{
  const f=fake();const old={uid:'alice',teamId:null,text:'',title:null,enc,timestamp:1,updatedAt:10,attachments:[{synthetic:true}],tags:['Synthetic private metadata']};
  f.docs.set('sessions/new',old);const request={...identity,cursor:0,sessionIds:['new']};
  const prepared=await executeSyncImportPreparation('alice',request,f.deps);
  assert.deepEqual(Object.keys(prepared.targets[0]).sort(),['deleted','enc','exists','metadataHash','revision','sessionId','stateHash','timestamp']);
  assert.equal(JSON.stringify(prepared).includes('Synthetic'),false);assert.equal(prepared.targets[0].stateHash,docHash(old));
  assert.equal(prepared.targets[0].metadataHash,syncStateHash(normalizedSyncMetadata(old)));
  for(const fields of [{uid:'bob'},{teamId:'crew'},{sharedWithIds:['bob']}]) {f.docs.set('sessions/new',{...old,...fields});await assert.rejects(executeSyncImportPreparation('alice',request,f.deps),{code:'permission-denied'});}
  f.docs.delete('sessions/new');const absent=(await executeSyncImportPreparation('alice',request,f.deps)).targets[0];assert.equal(absent.exists,false);assert.equal(absent.metadataHash,null);
});
test('metadata comparison ignores non-sync authority/content and normalizes optional null/empty values while rejecting malformed metadata',()=>{
  assert.deepEqual(normalizedSyncMetadata({uid:'bob',text:'Synthetic',attachments:[{}]}),{tags:[],connections:[]});
  assert.deepEqual(normalizedSyncMetadata({tags:null,connections:null,embedding:[],embeddingModel:'Orphan',category:null,position:null}),normalizedSyncMetadata({}));
  for(const patch of [{tags:['Changed']},{category:'Changed'},{connections:['peer']},{position:[1,2,3]},{importance:0.5},{celestialType:'Changed'},{semanticClusterId:'Changed'},{embedding:[0.1],embeddingModel:'Synthetic'}])assert.notEqual(syncStateHash(normalizedSyncMetadata(patch)),syncStateHash(normalizedSyncMetadata({})));
  for(const patch of [{tags:7},{connections:['a/b']},{importance:Infinity},{position:[1,2]},{embedding:[0.1]}])assert.throws(()=>normalizedSyncMetadata(patch));
});
test('newer full metadata replacement clears omitted fields, preserves exact history/attachments and does not charge creation quota',async()=>{
  const f=fake();const old={uid:'alice',teamId:null,text:'',title:null,enc,timestamp:1,updatedAt:10,attachments:[{synthetic:true}],tags:['Old'],category:'Old',connections:['peer'],position:[1,2,3],importance:0.5,celestialType:'Old',semanticClusterId:'Old',embedding:[0.1],embeddingModel:'Synthetic'};
  f.docs.set('sessions/old',old);const change={sessionId:'old',expectedStateHash:docHash(old),action:'update',incomingRevision:20,timestamp:1,enc,metadata:{}};
  await executeSyncImportBatch('alice',{...input,changes:[change]},f.deps);const updated=f.docs.get('sessions/old');
  for(const field of SYNC_MEMORY_METADATA_FIELDS)assert.equal(field in updated,false);assert.deepEqual(updated.attachments,old.attachments);assert.equal(updated.uid,'alice');assert.equal(updated.teamId,null);assert.equal(f.docs.get('users/alice').usage,undefined);
  const archived=f.docs.get(`sessions/old/versions/${syncConflictId('envelope',0)}`);for(const field of SYNC_MEMORY_METADATA_FIELDS)assert.deepEqual(archived[field],old[field]);
  await assert.rejects(executeSyncImportBatch('alice',{...input,changes:[{...change,metadata:{tags:['Different']}}]},f.deps),{code:'permission-denied'});
});
test('one batch atomically creates a ciphertext memory, charges once and ACKs; exact repeat confirms without recreating a deleted memory',async()=>{
  const f=fake(); assert.equal((await executeSyncImportStatus('alice',identity,f.deps)).status,'unknown');
  const first=await executeSyncImportBatch('alice',input,f.deps); assert.equal(first.status,'complete');assert.equal(first.imported,1);
  assert.equal(f.docs.get('mobileSyncEnvelopes/envelope').status,'pulled'); assert.equal(f.docs.get('sessions/new').text,'');assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,1);
  assert.equal(f.docs.has('memoryCreationReceipts/new'),true);assert.equal(f.docs.has('memoryUsageReceipts/new'),true);
  f.docs.delete('sessions/new');f.docs.get('trustedDevices/phone').status='revoked';
  assert.deepEqual(await executeSyncImportBatch('alice',input,f.deps),first);assert.equal(f.docs.has('sessions/new'),false); assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,1);
  await assert.rejects(executeSyncImportBatch('alice',{...input,changes:[{...input.changes[0],enc:{...enc,ct:'C'.repeat(32)}}]},f.deps),{code:'permission-denied'});
});
test('partial progress is durable; only the final batch ACKs and recovery observes the cursor',async()=>{
  const f=fake(2);const first=await executeSyncImportBatch('alice',input,f.deps);assert.equal(first.status,'pending');assert.equal(first.cursor,1);assert.equal(f.docs.get('mobileSyncEnvelopes/envelope').status,'queued');
  assert.deepEqual(await executeSyncImportStatus('alice',identity,f.deps),first);
  const second=await executeSyncImportBatch('alice',{...input,cursor:1,changes:[{...input.changes[0],sessionId:'next'}]},f.deps);assert.equal(second.status,'complete');assert.equal(second.imported,2);
  assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,2);
});
test('update archives the exact original cipher/attachments and preserves scope while rejecting stale CAS, teams and sharing',async()=>{
  for(const mode of ['ok','state','team','shared','owner','deleted']) {
    const f=fake();const old={uid:'alice',teamId:null,timestamp:1,updatedAt:10,text:'',title:null,enc,attachments:[{synthetic:true}],tags:['Old']};
    const change={sessionId:'old',expectedStateHash:docHash(old),action:'update',incomingRevision:20,timestamp:1,enc:{...enc,ct:'C'.repeat(32)},metadata:{tags:['New']}};
    f.docs.set('sessions/old',{...old,...(mode==='state'?{tags:['Changed']}:mode==='team'?{teamId:'crew'}:mode==='shared'?{sharedWithIds:['bob']}:mode==='owner'?{uid:'bob'}:mode==='deleted'?{deletedAt:15}:{})});
    if(mode==='ok') {
      await executeSyncImportBatch('alice',{...input,changes:[change]},f.deps);const updated=f.docs.get('sessions/old');assert.equal(updated.uid,'alice');assert.equal(updated.teamId,null);assert.equal(updated.timestamp,1);assert.deepEqual(updated.attachments,old.attachments);
      const version=f.docs.get(`sessions/old/versions/${syncConflictId('envelope',0)}`);assert.deepEqual(version.enc,enc);assert.deepEqual(version.attachments,old.attachments);assert.equal(f.docs.get('users/alice').usage,undefined);
    } else {await assert.rejects(executeSyncImportBatch('alice',{...input,changes:[change]},f.deps));assert.equal(f.docs.has('mobileSyncImports/envelope'),false);}
  }
});
test('account deletion, revoked devices, receipt collisions, expiry and concurrent paid quota deny without progress or ACK',async()=>{
  for(const mode of ['account','revoked','collision','expired','quota','direction']) {
    const f=fake(); if(mode==='account')f.docs.set('accountDeletions/alice',{});if(mode==='revoked')f.docs.get('trustedDevices/phone').status='revoked';
    if(mode==='collision')f.docs.set('memoryCreationReceipts/new',{});if(mode==='expired')f.docs.get('mobileSyncEnvelopes/envelope').expiresAt=999;
    if(mode==='quota'){f.docs.set('config/monetization',{mode:'paid'});f.docs.set('users/alice',{usage:{memoriesThisMonth:30,periodYear:1970,periodMonth:1}});}if(mode==='direction')f.docs.get('mobileSyncEnvelopes/envelope').direction='mobile-to-desktop';
    await assert.rejects(executeSyncImportBatch('alice',input,f.deps));assert.equal(f.docs.has('mobileSyncImports/envelope'),false);assert.equal(f.docs.has('sessions/new'),false);assert.equal(f.docs.get('mobileSyncEnvelopes/envelope').status,'queued');
  }
});
