'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),admin=require('firebase-admin');
const service=require('../lib/embeddingIndexRevisions'),contract=require('../lib/embeddingIndexContract'),{syncStateHash}=require('../lib/mobileSyncImport');
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const vector=()=>[1,...Array(383).fill(0)],cipher=()=>({v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)});
function fixture(index={embedding:[1,0]}){
  const docs=new Map([['users/alice',{}],['users/bob',{}],['sessions/note',{uid:'alice',teamId:null,text:'',title:null,enc:cipher(),timestamp:1,updatedAt:10,
    ...index,keyEpoch:1,keyId:'historic-personal-key',nodes:[{retained:true}],links:[{source:'one',target:'two'}],connections:['peer'],learning:{revisedAt:4},
    attachments:[{retained:true}],generatedImagePrompt:{retained:true},custom:{opaque:'preserve'},semanticClusterId:'cluster'}]]),stamps=new Map();let stamp=1;
  const ref=path=>({path,id:path.split('/').pop(),collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})}),copy=structuredClone;
  const db={doc:ref,runTransaction:async work=>{const writes=[],get=async ref=>{assert.equal(writes.length,0,'All reads must precede writes');return{ref,id:ref.id,exists:docs.has(ref.path),data:()=>copy(docs.get(ref.path)),updateTime:admin.firestore.Timestamp.fromMillis(stamps.get(ref.path)||1)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(ref,data)=>{assert(!docs.has(ref.path));writes.push({ref,data});},set:(ref,data)=>writes.push({ref,data}),update:(ref,data)=>writes.push({ref,data,merge:true})});
    for(const {ref,data,merge}of writes){const next=merge?{...docs.get(ref.path)}:{};for(const [key,value]of Object.entries(data)){if(admin.firestore.FieldValue.delete().isEqual(value))delete next[key];else next[key]=copy(value);}docs.set(ref.path,next);stamps.set(ref.path,++stamp);}return result;}};
  const deps={firestore:db,now:()=>1000},prepare=async()=>{
    let viewDigest;try{viewDigest=syncStateHash(docs.get('sessions/note'));}catch{viewDigest='0'.repeat(64);}
    return service.executeEmbeddingIndexPreparation('alice',{sessionId:'note',viewDigest},deps);
  };
  return{docs,deps,prepare,touch:()=>stamps.set('sessions/note',++stamp),request:async(change={kind:'publish',space:contract.EMBEDDING_INDEX_TARGET_SPACE,vector:vector()},operationId=first)=>({operationId,baseline:await prepare(),change})};
}
test('index contract admits only the exact reviewed multilingual profile and bounded finite normalized vectors',()=>{
  const profile=require('../../frontend/src/services/embeddingProfiles.json').multilingualCandidate;
  assert.equal(contract.EMBEDDING_INDEX_TARGET_SPACE,`${profile.modelId}@${profile.revision}:${profile.dtype}:${profile.pooling}:norm`);
  for(const value of [[],[1],Array(384).fill(0),Array(384).fill(1),[Infinity,...Array(383).fill(0)],['1',...Array(383).fill(0)]])assert.throws(()=>contract.parseEmbeddingIndexChange({kind:'publish',space:contract.EMBEDDING_INDEX_TARGET_SPACE,vector:value}));
  for(const change of [{kind:'publish',space:profile.modelId,vector:vector()},{kind:'publish',space:contract.EMBEDDING_INDEX_TARGET_SPACE,vector:vector(),text:'untrusted'},
    {kind:'rollback',versionId:'../foreign'},{kind:'rollback',versionId:'embedding-index-'+first,vector:vector()}])assert.throws(()=>contract.parseEmbeddingIndexChange(change));
  assert.equal(contract.parseEmbeddingIndexChange({kind:'rollback',versionId:'embedding-index-'+first}).kind,'rollback');
});
test('index publication archives exact cipher and metadata, preserves graph and attachments, and charges only once on replay',async()=>{
  const f=fixture(),input=await f.request(),before=structuredClone(f.docs.get('sessions/note')),result=await service.executeEmbeddingIndexRevision('alice',input,'apply',f.deps),after=f.docs.get('sessions/note');
  assert.equal(result.status,'committed');assert.deepEqual(after.embedding,vector());assert.equal(after.embeddingModel,contract.EMBEDDING_INDEX_TARGET_SPACE);
  for(const key of Object.keys(before).filter(k=>!['embedding','embeddingModel','updatedAt','lastVersionId'].includes(k)))assert.deepEqual(after[key],before[key],key);
  const archive=f.docs.get('sessions/note/versions/'+result.versionId);for(const key of Object.keys(before))assert.deepEqual(archive[key],before[key],key);
  assert.equal(Object.hasOwn(archive,'embeddingModel'),false);const receipt=f.docs.get('embeddingIndexRevisions/'+first);
  assert.deepEqual(Object.keys(receipt).sort(),['v','uid','operationId','sessionId','digest','status','revision','versionId','createdAt'].sort());
  const stable=JSON.stringify([...f.docs]);for(const mode of ['apply','status','cancel'])assert.deepEqual(await service.executeEmbeddingIndexRevision('alice',input,mode,f.deps),result);assert.equal(JSON.stringify([...f.docs]),stable);
  const quota=[...f.docs.entries()].find(([p])=>p.startsWith('embeddingIndexBudgets/'))[1];assert.equal(quota.operations,1);assert(quota.vectorBytes>0&&quota.archiveBytes>0);
});
test('index rollback restores missing and null markers exactly without restoring any unrelated metadata',async()=>{
  for(const index of [{},{embedding:null,embeddingModel:null},{embedding:[.5,.5]},{embedding:[1,0],embeddingModel:'older-unknown-space'}]){
    const f=fixture(index),firstResult=await service.executeEmbeddingIndexRevision('alice',await f.request(),'apply',f.deps);
    f.docs.get('sessions/note').connections=['new-peer'];f.touch();
    const input=await f.request({kind:'rollback',versionId:firstResult.versionId},second),result=await service.executeEmbeddingIndexRevision('alice',input,'apply',f.deps),after=f.docs.get('sessions/note');
    assert.equal(result.status,'committed');for(const field of ['embedding','embeddingModel']){assert.equal(Object.hasOwn(after,field),Object.hasOwn(index,field));assert.deepEqual(after[field],index[field]);}
    assert.deepEqual(after.connections,['new-peer']);assert.deepEqual(after.enc,cipher());
  }
});
test('index rollback refuses a content/key change or a foreign/missing history before touching any document',async()=>{
  for(const change of ['cipher','key','missing','foreign']){const f=fixture(),done=await service.executeEmbeddingIndexRevision('alice',await f.request(),'apply',f.deps);
    if(change==='cipher')f.docs.get('sessions/note').enc={...cipher(),ct:'C'.repeat(32)};
    if(change==='key')f.docs.get('sessions/note').keyId='new-key';
    if(change==='missing')f.docs.delete('sessions/note/versions/'+done.versionId);
    if(change==='foreign')f.docs.get('sessions/note/versions/'+done.versionId).uid='bob';
    const request=await f.request({kind:'rollback',versionId:done.versionId},second),before=JSON.stringify([...f.docs]);await assert.rejects(service.executeEmbeddingIndexRevision('alice',request,'apply',f.deps),{code:'aborted'});assert.equal(JSON.stringify([...f.docs]),before);
  }
});
test('index CAS rejects changed bytes, same-content ABA, forged baseline digests and stale view preparation without partial history',async()=>{
  for(const change of ['bytes','aba','contentDigest','revision']){const f=fixture(),input=await f.request();if(change==='bytes')f.docs.get('sessions/note').custom.changed=true;if(change==='aba')f.touch();if(change==='contentDigest')input.baseline.contentDigest='a'.repeat(64);if(change==='revision')input.baseline.revision++;
    const before=JSON.stringify([...f.docs]);await assert.rejects(service.executeEmbeddingIndexRevision('alice',input,'apply',f.deps),{code:'aborted'});assert.equal(JSON.stringify([...f.docs]),before);}
  const f=fixture();await assert.rejects(service.executeEmbeddingIndexPreparation('alice',{sessionId:'note',viewDigest:'a'.repeat(64)},f.deps),{code:'aborted'});
});
test('index admission excludes foreign, team, shared, deleted, ambiguous, plaintext and malformed historic vectors',async()=>{
  for(const patch of [{uid:'bob'},{teamId:'team'},{teamId:undefined},{sharedWithIds:['bob']},{teamScopeAmbiguous:true},{deletedAt:2},{enc:null},{text:'plaintext'},{title:'plaintext'},{embedding:[NaN]},{embeddingModel:9}]){
    const f=fixture(),input=await f.request();Object.assign(f.docs.get('sessions/note'),patch);const before=JSON.stringify([...f.docs]);
    await assert.rejects(f.prepare());await assert.rejects(service.executeEmbeddingIndexRevision('alice',input,'apply',f.deps));assert.equal((await service.executeEmbeddingIndexRevision('alice',input,'status',f.deps)).status,'revoked');assert.equal(JSON.stringify([...f.docs]),before);
  }
});
test('index cancellation seals a changed source and refuses a delayed apply without charging terminal retries',async()=>{
  const f=fixture(),input=await f.request();f.docs.get('sessions/note').enc={...cipher(),ct:'C'.repeat(32)};const result=await service.executeEmbeddingIndexRevision('alice',input,'cancel',f.deps),before=JSON.stringify([...f.docs]);
  assert.equal(result.status,'cancelled');await assert.rejects(service.executeEmbeddingIndexRevision('alice',input,'apply',f.deps));assert.deepEqual(await service.executeEmbeddingIndexRevision('alice',input,'cancel',f.deps),result);assert.equal(JSON.stringify([...f.docs]),before);assert(![...f.docs.keys()].some(p=>p.includes('/versions/')));
});
test('index receipt owner, request digest and captured actor are bound before database access or terminal recovery',async()=>{
  const f=fixture(),input=await f.request();await service.executeEmbeddingIndexRevision('alice',input,'apply',f.deps);
  const changed=structuredClone(input);changed.change.vector=[0,1,...Array(382).fill(0)];await assert.rejects(service.executeEmbeddingIndexRevision('alice',changed,'status',f.deps),{code:'permission-denied'});
  const deps={firestore:{doc:()=>{throw Error('Unexpected database access');}},now:()=>1};await assert.rejects(service.executeEmbeddingIndexRevision('bob',input,'apply',deps),{code:'permission-denied'});
  await assert.rejects(service.executeEmbeddingIndexCall('bob','apply',{actorUid:'alice',request:input},deps),{code:'permission-denied'});
  await assert.rejects(service.executeEmbeddingIndexCall('','apply',{actorUid:'alice',request:input},deps),{code:'unauthenticated'});
});
test('index late ACK recovery never recreates a missing parent; account deletion blocks all modes and preparation',async()=>{
  const f=fixture(),input=await f.request(),done=await service.executeEmbeddingIndexRevision('alice',input,'apply',f.deps);f.docs.delete('sessions/note');assert.deepEqual(await service.executeEmbeddingIndexRevision('alice',input,'apply',f.deps),done);assert(!f.docs.has('sessions/note'));
  f.docs.set('accountDeletions/alice',{status:'complete'});for(const mode of ['apply','status','cancel'])await assert.rejects(service.executeEmbeddingIndexRevision('alice',input,mode,f.deps),{code:'permission-denied'});
  await assert.rejects(service.executeEmbeddingIndexPreparation('alice',{sessionId:'note',viewDigest:input.baseline.stateDigest},f.deps),{code:'permission-denied'});
});
test('index operation, vector and archive limits or damaged quota create no partial session/history/receipt',async()=>{
  for(const field of ['operations','vectorBytes','archiveBytes','damaged']){const f=fixture(),input=await f.request(),path='embeddingIndexBudgets/'+require('node:crypto').createHash('sha256').update('alice').digest('hex')+'_1970-01-01',quota={v:1,uid:'alice',day:'1970-01-01',operations:0,vectorBytes:0,archiveBytes:0};
    if(field==='damaged')quota.operations=-1;else quota[field]=service.EMBEDDING_INDEX_DAILY_LIMITS[field];f.docs.set(path,quota);const before=JSON.stringify([...f.docs]);await assert.rejects(service.executeEmbeddingIndexRevision('alice',input,'apply',f.deps));assert.equal(JSON.stringify([...f.docs]),before);}
});
test('index callables require Auth, App Check and the closed personal revision gate before any mutation',async()=>{
  const f=fixture(),request=await f.request(),command={actorUid:'alice',request};
  await assert.rejects(service.applyEmbeddingIndexRevision.run(command,{}),{code:'unauthenticated'});
  await assert.rejects(service.applyEmbeddingIndexRevision.run(command,{auth:{uid:'alice'}}),{code:'failed-precondition'});
  await assert.rejects(service.applyEmbeddingIndexRevision.run(command,{auth:{uid:'alice'},app:{appId:'synthetic'}}),{code:'failed-precondition'});
});
