const assert=require('node:assert/strict');const test=require('node:test');const {createHash}=require('node:crypto');
process.env.GCLOUD_PROJECT=process.env.GCLOUD_PROJECT||'demo-mnemosyne-test';
const admin=require('firebase-admin');
const {parseDocumentImportPlan,parseDocumentImportBatch,documentPlanBatches}=require('../lib/documentImportContract');
const {executeDocumentImport,documentPlanDigest,beginDocumentImport,applyDocumentImportBatch,getDocumentImportStatus,cancelDocumentImport}=require('../lib/documentImport');
const {encodeAttachmentHeader}=require('../lib/attachmentEnvelope');
const enc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)};
const id=index=>'11111111-1111-4111-8111-'+String(index).padStart(12,'0');const importId=id(9999);
function memory(index,role,parentId,attachmentIds=[]){return{sessionId:id(index),role,enc,attachmentIds,metadata:{tags:['Synthetic'],category:'Synthetic',embedding:[.1,.2],embeddingModel:'local-test',connections:[],parentId,
 learning:{schemaVersion:1,source:role==='hub'?'document-batch':'document-upload',modality:'document',learnedAt:10,batchId:importId,attachmentCount:attachmentIds.length}}};}
function upload(index=5000,uid='alice'){
 const header={v:1,id:id(index),uid,scope:{kind:'personal',uid},category:'document',plainBytes:10,metadataBytes:20,cipherBytes:50,iv:'A'.repeat(16),wrappedKey:{iv:'B'.repeat(16),ct:'C'.repeat(64)}};
 const prefix=encodeAttachmentHeader(header);const bytes=prefix.length+header.cipherBytes;
 return{v:1,uid,header,digest:createHash('sha256').update(prefix).digest('hex'),bytes,bucket:'synthetic-private',quarantinePath:'quarantine/'+uid+'/'+id(index),publishedPath:'encrypted/'+id(index),status:'ready',expiresAt:901000,postExpiresAt:121000,quotaChargeBytes:2*bytes,quotaReserved:false,storageGeneration:'1',referenceSchemaVersion:1,referenceRevision:0};
}
function plan(count=12,record){
 const attachmentIds=record?[record.header.id]:[];
 const memories=[memory(0,'hub',null,attachmentIds),...Array.from({length:count},(_,index)=>memory(index+1,'document',id(0),index===0?attachmentIds:[]))];
 return parseDocumentImportPlan({importId,memories,attachments:record?[{id:record.header.id,headerDigest:record.digest}]:[],edges:memories.slice(1).map(item=>({sourceId:id(0),targetId:item.sessionId}))});
}
function fixture(){
  const docs=new Map([['users/alice',{}],['users/bob',{}]]);let transactions=0;
  const ref=path=>({path,id:path.split('/').pop(),collection:name=>({doc:id=>ref(`${path}/${name}/${id}`)})});
  const db={doc:ref,runTransaction:async work=>{transactions++;const writes=[];
    const get=async ref=>{assert.equal(writes.length,0,'All reads precede writes');return{ref,id:ref.id,exists:docs.has(ref.path),updateTime:admin.firestore.Timestamp.fromMillis(transactions),data:()=>docs.get(ref.path)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(ref,data)=>{assert.equal(docs.has(ref.path),false);writes.push({ref,data});},set:(ref,data)=>writes.push({ref,data}),update:(ref,data)=>writes.push({ref,data,merge:true})});
    assert.ok(writes.length<=500);for(const {ref,data,merge}of writes)docs.set(ref.path,merge?{...docs.get(ref.path),...data}:data);return result;}};
  return{docs,deps:{firestore:db,now:()=>1000},transactions:()=>transactions};
}
const identity=value=>({importId:value.importId,planDigest:documentPlanDigest(value)});
const batches=value=>documentPlanBatches(value).map(batch=>({...identity(value),...batch}));
test('document plan binds hierarchy, original files and local learning; rejects malformed topology, plaintext and unrelated references',()=>{
  const good=plan(2,upload());const changes=[null,{...good,uid:'alice'},{...good,memories:[]},{...good,edges:[]},
    {...good,edges:[good.edges[0],good.edges[0]]},{...good,attachments:[]},{...good,attachments:[...good.attachments,...good.attachments]},
    {...good,memories:[...good.memories,memory(100,'hub',null)]}];
  for(const mutate of [item=>item.sessionId='bad',item=>item.enc.v=2,item=>item.metadata.title='Synthetic',item=>item.metadata.connections=[id(200)],
    item=>item.metadata.learning.batchId=id(200),item=>item.metadata.learning.attachmentCount=20,item=>item.metadata.parentId=item.sessionId]){
    const bad=structuredClone(good);mutate(bad.memories[1]);changes.push(bad);
  }
  const unrelated=structuredClone(good);unrelated.memories[0].attachmentIds=[id(5001)];changes.push(unrelated);
  for(const value of changes)assert.throws(()=>parseDocumentImportPlan(value));
  const first=batches(good)[0];assert.deepEqual(parseDocumentImportBatch(first),first);
  assert.throws(()=>parseDocumentImportBatch({...first,batchIndex:41}));assert.throws(()=>parseDocumentImportBatch({...first,memories:[first.memories[0],first.memories[0]]}));
});
test('document plans accept 20 files and 16 ancestor hubs, reject 21 files, cycles, oversized UTF8 and orphan hubs before DB access',async()=>{
  assert.equal(plan(20).memories.length,21);assert.throws(()=>plan(21));
  const deep=depth=>{const memories=Array.from({length:depth},(_,i)=>memory(i,'hub',i===0?null:id(i-1)));memories.push(memory(depth,'document',id(depth-1)));
    return{importId,memories,attachments:[],edges:memories.slice(1).map(item=>({sourceId:item.metadata.parentId,targetId:item.sessionId}))};};
  assert.equal(parseDocumentImportPlan(deep(16)).memories.length,17);assert.throws(()=>parseDocumentImportPlan(deep(17)));
  const cycle=deep(3);cycle.memories[0].metadata.parentId=id(2);cycle.edges.push({sourceId:id(0),targetId:id(2)});assert.throws(()=>parseDocumentImportPlan(cycle));
  const oversized=plan(5);for(const item of oversized.memories)item.enc={...enc,ct:'A'.repeat(800000)};
  assert.throws(()=>parseDocumentImportPlan(oversized));const f=fixture();await assert.rejects(executeDocumentImport('alice',oversized,'begin',f.deps),{code:'invalid-argument'});assert.equal(f.transactions(),0);
});
test('document import commits quota, original ciphertext, rich local metadata, reciprocal hierarchy and immutable receipts once',async()=>{
  const f=fixture();const value=plan();await executeDocumentImport('alice',value,'begin',f.deps);await executeDocumentImport('alice',value,'begin',f.deps);
  const budget=[...f.docs].find(([key])=>key.startsWith('documentImportBudgets/'))[1];assert.equal(budget.imports,1);
  for(const batch of batches(value)){const result=await executeDocumentImport('alice',batch,'apply',f.deps);assert.deepEqual(await executeDocumentImport('alice',batch,'apply',f.deps),result);}
  assert.equal((await executeDocumentImport('alice',identity(value),'status',f.deps)).status,'complete');assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,13);
  for(const item of value.memories){const saved=f.docs.get('sessions/'+item.sessionId);assert.equal(saved.text,'');assert.equal(saved.title,null);assert.deepEqual(saved.enc,enc);assert.deepEqual(saved.embedding,[.1,.2]);assert.equal(saved.embeddingModel,'local-test');assert.equal(saved.learning.learnedAt,1000);assert.ok(saved.connections.length);}
  assert.equal([...f.docs.keys()].filter(key=>key.includes('/versions/')).length,13);
  f.docs.delete('sessions/'+id(1));f.docs.get('sessions/'+id(0)).connections=[];
  for(const batch of batches(value))assert.equal((await executeDocumentImport('alice',batch,'apply',f.deps)).status,'complete');
  assert.equal(f.docs.has('sessions/'+id(1)),false);assert.deepEqual(f.docs.get('sessions/'+id(0)).connections,[]);assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,13);
});
test('attachment associations share the same ready original, touch its registry once per batch and never expose original names or tokens',async()=>{
  const f=fixture();const record=upload();const value=plan(2,record);f.docs.set('config/attachmentSecurity',{writesEnabled:true,bucket:record.bucket});f.docs.set('attachmentUploads/'+record.header.id,record);
  await executeDocumentImport('alice',value,'begin',f.deps);await executeDocumentImport('alice',batches(value)[0],'apply',f.deps);
  assert.equal(f.docs.get('attachmentUploads/'+record.header.id).referenceRevision,1);
  for(const index of [0,1])assert.deepEqual(f.docs.get('sessions/'+id(index)).attachments,[{type:'document',url:'mnemosyne-attachment:v1:'+record.header.id,name:'Anexo cifrado',size:record.bytes,mimeType:'application/octet-stream',source:'upload'}]);
  assert.equal(f.docs.get('sessions/'+id(2)).attachments,null);
});
test('missing, pending, foreign, wrong bucket, changed header, purging and disabled attachments stop the entire creation batch before any writes',async()=>{
  for(const mode of ['missing','pending','foreign','bucket','header','purging','disabled','entitlement']){
    const f=fixture();const record=upload();const value=plan(2,record);f.docs.set('config/attachmentSecurity',{writesEnabled:true,bucket:record.bucket});f.docs.set('attachmentUploads/'+record.header.id,record);
    await executeDocumentImport('alice',value,'begin',f.deps);
    if(mode==='missing')f.docs.delete('attachmentUploads/'+record.header.id);
    if(mode==='pending')Object.assign(record,{status:'reserved',quotaReserved:true});
    if(mode==='foreign')f.docs.set('attachmentUploads/'+record.header.id,upload(5000,'bob'));
    if(mode==='bucket')record.bucket='other-private';
    if(mode==='header'){record.header.iv='D'.repeat(16);record.digest=createHash('sha256').update(encodeAttachmentHeader(record.header)).digest('hex');}
    if(mode==='purging')Object.assign(record,{purgeState:'pending',purgeId:id(6000),purgeAfter:1000,purgeReason:'unreferenced',storedQuotaReleased:false});
    if(mode==='disabled')f.docs.get('config/attachmentSecurity').writesEnabled=false;
    if(mode==='entitlement')f.docs.set('config/monetization',{mode:'paid'});
    const before=structuredClone([...f.docs]);await assert.rejects(executeDocumentImport('alice',batches(value)[0],'apply',f.deps));assert.deepEqual([...f.docs],before);
  }
});
test('whole admission quota, collision and daily budgets reject without partial notes; later quota exhaustion preserves a resumable cursor',async()=>{
  for(const mode of ['quota','collision','budget','attachment-entitlement']){
    const f=fixture();const value=mode==='attachment-entitlement'?plan(2,upload()):plan();
    if(mode==='quota'){f.docs.set('config/monetization',{mode:'paid'});f.docs.set('users/alice',{usage:{memoriesThisMonth:20,periodYear:1970,periodMonth:1}});}
    if(mode==='collision')f.docs.set('memoryUsageReceipts/'+id(12),{uid:'bob'});
    if(mode==='budget')f.docs.set('documentImportBudgets/'+createHash('sha256').update('alice').digest('hex')+'_1970-01-01',{v:1,uid:'alice',day:'1970-01-01',imports:10,memories:0,bytes:0});
    if(mode==='attachment-entitlement')f.docs.set('config/monetization',{mode:'paid'});
    const before=structuredClone([...f.docs]);await assert.rejects(executeDocumentImport('alice',value,'begin',f.deps));assert.deepEqual([...f.docs],before);
  }
  const f=fixture();const value=plan();f.docs.set('config/monetization',{mode:'paid'});await executeDocumentImport('alice',value,'begin',f.deps);
  f.docs.set('users/alice',{usage:{memoriesThisMonth:28,periodYear:1970,periodMonth:1}});await assert.rejects(executeDocumentImport('alice',batches(value)[0],'apply',f.deps),{code:'resource-exhausted'});assert.equal(f.docs.get('documentImports/'+importId).nextBatch,0);
  f.docs.set('entitlements/alice',{effectiveTier:'pro'});for(const batch of batches(value))await executeDocumentImport('alice',batch,'apply',f.deps);assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,41);
});
test('immutable batches, ownership, shares, tombstones, changed ciphertext, receipt and parent changes cannot partially connect the hierarchy',async()=>{
  for(const mode of ['batch','order','owner','team','share','deleted','cipher','receipt','parent']){
    const f=fixture();const value=plan();const calls=batches(value);await executeDocumentImport('alice',value,'begin',f.deps);
    if(mode==='batch'){const bad=structuredClone(calls[0]);bad.memories[0].enc.ct='C'.repeat(32);await assert.rejects(executeDocumentImport('alice',bad,'apply',f.deps),{code:'aborted'});continue;}
    if(mode==='order'){await assert.rejects(executeDocumentImport('alice',calls[1],'apply',f.deps),{code:'aborted'});continue;}
    await executeDocumentImport('alice',calls[0],'apply',f.deps);await executeDocumentImport('alice',calls[1],'apply',f.deps);
    const patch={owner:{uid:'bob'},team:{teamId:'crew'},share:{sharedWithIds:['bob']},deleted:{deletedAt:1001},cipher:{enc:{...enc,ct:'C'.repeat(32)}},parent:{parentId:id(100)}}[mode];
    if(patch)Object.assign(f.docs.get('sessions/'+id(1)),patch);if(mode==='receipt')f.docs.get('memoryCreationReceipts/'+id(1)).kind='other';
    const before=structuredClone([...f.docs]);await assert.rejects(executeDocumentImport('alice',calls[2],'apply',f.deps));assert.deepEqual([...f.docs],before);
  }
});
test('cancellation before admission blocks late requests; cancellation after commit preserves receipt and data without future work',async()=>{
  for(const started of [false,true]){
    const f=fixture();const value=plan();if(started){await executeDocumentImport('alice',value,'begin',f.deps);await executeDocumentImport('alice',batches(value)[0],'apply',f.deps);}
    const result=await executeDocumentImport('alice',identity(value),'cancel',f.deps);assert.equal(result.status,'cancelled');assert.equal(result.createdCount,started?10:0);
    await assert.rejects(executeDocumentImport('alice',value,'begin',f.deps));await assert.rejects(executeDocumentImport('alice',batches(value)[started?1:0],'apply',f.deps));
    if(started)assert.equal((await executeDocumentImport('alice',batches(value)[0],'apply',f.deps)).status,'cancelled');
  }
});
test('foreign UID, mismatched digests and account deletion cannot inspect or advance a plan',async()=>{
  const f=fixture();const value=plan();await executeDocumentImport('alice',value,'begin',f.deps);
  await assert.rejects(executeDocumentImport('bob',identity(value),'status',f.deps),{code:'permission-denied'});
  await assert.rejects(executeDocumentImport('alice',{...identity(value),planDigest:'f'.repeat(64)},'status',f.deps),{code:'permission-denied'});
  f.docs.set('accountDeletions/alice',{status:'complete'});await assert.rejects(executeDocumentImport('alice',batches(value)[0],'apply',f.deps),{code:'permission-denied'});
});
test('closed callables reject before rate/database writes, authenticate first and bind no provider secrets',async()=>{
  const value=plan();await assert.rejects(beginDocumentImport.run(value,{}),{code:'unauthenticated'});await assert.rejects(beginDocumentImport.run({...value,text:'Synthetic'},{auth:{uid:'alice'}}),{code:'invalid-argument'});
  await assert.rejects(beginDocumentImport.run(value,{auth:{uid:'alice'}}),{code:'failed-precondition'});await assert.rejects(applyDocumentImportBatch.run(batches(value)[0],{auth:{uid:'alice'}}),{code:'failed-precondition'});
  for(const callable of [beginDocumentImport,applyDocumentImportBatch,getDocumentImportStatus,cancelDocumentImport])assert.deepEqual(callable.__endpoint.secretEnvironmentVariables||[],[]);
});
