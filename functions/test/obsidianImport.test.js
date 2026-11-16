const assert=require('node:assert/strict');const test=require('node:test');const {createHash}=require('node:crypto');
process.env.GCLOUD_PROJECT=process.env.GCLOUD_PROJECT||'demo-mnemosyne-test';
const admin=require('firebase-admin');
const {parseObsidianImportPlan,parseObsidianImportBatch,obsidianPlanBatches}=require('../lib/obsidianImportContract');
const {executeObsidianImport,obsidianPlanDigest,beginObsidianImport,applyObsidianImportBatch,getObsidianImportStatus,cancelObsidianImport,beginCapsuleImport,applyCapsuleImportBatch}=require('../lib/obsidianImport');
const enc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)};
function plan(count=13){return parseObsidianImportPlan({importId:'synthetic-import',source:'obsidian-vault',memories:Array.from({length:count},(_,index)=>({sessionId:'note-'+String(index).padStart(3,'0'),role:'note',enc,metadata:{tags:['Synthetic'],category:'Synthetic'}})),
  edges:Array.from({length:count-1},(_,index)=>({sourceId:'note-'+String(index).padStart(3,'0'),targetId:'note-'+String(index+1).padStart(3,'0'),kind:'wikilink'}))});}
function fixture(){
  const docs=new Map([['users/alice',{}],['users/bob',{}]]);let transactions=0;
  const ref=path=>({path,id:path.split('/').pop(),collection:name=>({doc:id=>ref(`${path}/${name}/${id}`)})});
  const db={doc:ref,runTransaction:async work=>{transactions++;const writes=[];
    const get=async ref=>{assert.equal(writes.length,0,'All reads precede writes');return{ref,id:ref.id,exists:docs.has(ref.path),updateTime:admin.firestore.Timestamp.fromMillis(transactions),data:()=>docs.get(ref.path)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(ref,data)=>{assert.equal(docs.has(ref.path),false);writes.push({ref,data});},set:(ref,data)=>writes.push({ref,data}),update:(ref,data)=>writes.push({ref,data,merge:true})});
    assert.ok(writes.length<=500);for(const {ref,data,merge}of writes){const normalized={...data};if(normalized.importCount?.isEqual?.(admin.firestore.FieldValue.increment(1)))normalized.importCount=(docs.get(ref.path)?.importCount??0)+1;docs.set(ref.path,merge?{...docs.get(ref.path),...normalized}:normalized);}return result;}};
  return{docs,deps:{firestore:db,now:()=>1000},transactions:()=>transactions};
}
const identity=value=>({importId:value.importId,planDigest:obsidianPlanDigest(value)});
const batches=value=>obsidianPlanBatches(value).map(batch=>({...identity(value),...batch}));
test('vault import validates complete encrypted plans, topology, metadata and batch bounds before admission',()=>{
  const good=plan();assert.equal(good.memories.length,13);
  for(const value of [null,[],{...good,uid:'alice'},{...good,source:'manual'},{...good,memories:[]},{...good,memories:[good.memories[0],good.memories[0]]},{...good,edges:[good.edges[0],good.edges[0]]},
    {...good,edges:[{...good.edges[0],targetId:'outside'}]},{...good,edges:[{...good.edges[0],sourceId:good.edges[0].targetId}]},{...good,memories:[{...good.memories[0],text:'Synthetic'}]},
    {...good,memories:[{...good.memories[0],metadata:{title:'Synthetic'}}]},{...good,memories:[{...good.memories[0],metadata:{connections:['outside']}}]}])assert.throws(()=>parseObsidianImportPlan(value));
  const input=batches(good)[0];assert.deepEqual(parseObsidianImportBatch(input),input);assert.throws(()=>parseObsidianImportBatch({...input,memories:Array(11).fill(input.memories[0])}));
  assert.throws(()=>parseObsidianImportBatch({...input,memories:[input.memories[0],input.memories[0]]}));
});
test('vault import enforces note/cipher and UTF8 aggregate limits, including multibyte metadata below the character limit',async()=>{
  assert.equal(plan(150).memories.length,150);assert.throws(()=>plan(151));
  const oversized=plan(5);for(const memory of oversized.memories)memory.enc={...enc,ct:'A'.repeat(900000)};
  assert.throws(()=>parseObsidianImportPlan(oversized));
  const unicode=plan(150);for(const memory of unicode.memories)memory.metadata.tags=Array.from({length:70},(_,index)=>`${index}${'漢'.repeat(190)}`);
  assert.ok(JSON.stringify(unicode).length<4_000_000);assert.ok(Buffer.byteLength(JSON.stringify(unicode))>4_000_000);
  const f=fixture();const before=structuredClone([...f.docs]);await assert.rejects(executeObsidianImport('alice',unicode,'begin',f.deps),{code:'invalid-argument'});assert.equal(f.transactions(),0);assert.deepEqual([...f.docs],before);
  const badHub=plan(1);badHub.memories.unshift({...badHub.memories[0],sessionId:'orphan-hub',role:'hub'});assert.throws(()=>parseObsidianImportPlan(badHub));
});
test('vault import admits once, creates stable encrypted IDs with atomic quota/receipts, then confirms both directions and history',async()=>{
  const f=fixture();const value=plan();const calls=batches(value);const start=await executeObsidianImport('alice',value,'begin',f.deps);assert.equal(start.nextBatch,0);assert.equal(f.docs.size,4);
  assert.deepEqual(await executeObsidianImport('alice',value,'begin',f.deps),start);assert.equal([...f.docs.keys()].filter(key=>key.startsWith('obsidianImportBudgets/')).length,1);
  for(const [index,input]of calls.entries()){
    const result=await executeObsidianImport('alice',input,'apply',f.deps);assert.equal(result.nextBatch,index+1);assert.deepEqual(await executeObsidianImport('alice',input,'apply',f.deps),result);
  }
  const state=await executeObsidianImport('alice',identity(value),'status',f.deps);assert.equal(state.status,'complete');assert.equal(state.createdCount,13);assert.equal(state.linkedCount,12);
  assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,13);assert.equal([...f.docs.keys()].filter(key=>key.startsWith('memoryUsageReceipts/')).length,13);
  for(const item of value.memories){const memory=f.docs.get('sessions/'+item.sessionId);assert.equal(memory.text,'');assert.equal(memory.title,null);assert.equal(memory.teamId,null);assert.deepEqual(memory.enc,enc);assert.ok(memory.connections.length);}
  assert.equal([...f.docs.keys()].filter(key=>key.includes('/versions/')).length,13);
});
test('vault import receipt replay after missing targets never recreates notes, charges twice or reapplies later removed links',async()=>{
  const f=fixture();const value=plan(2);const calls=batches(value);await executeObsidianImport('alice',value,'begin',f.deps);for(const input of calls)await executeObsidianImport('alice',input,'apply',f.deps);
  f.docs.delete('sessions/note-001');f.docs.get('sessions/note-000').connections=[];
  for(const input of calls)assert.equal((await executeObsidianImport('alice',input,'apply',f.deps)).status,'complete');
  assert.equal(f.docs.has('sessions/note-001'),false);assert.deepEqual(f.docs.get('sessions/note-000').connections,[]);assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,2);
});
test('vault import refuses the whole initial quota, reserved ID collisions and daily budgets before creating any note',async()=>{
  for(const mode of ['quota','session','creation','usage','budget']){
    const f=fixture();const value=plan();if(mode==='quota'){f.docs.set('config/monetization',{mode:'paid'});f.docs.set('users/alice',{usage:{memoriesThisMonth:20,periodYear:1970,periodMonth:1}});}
    if(mode==='session')f.docs.set('sessions/note-012',{uid:'bob'});if(mode==='creation')f.docs.set('memoryCreationReceipts/note-012',{uid:'alice'});if(mode==='usage')f.docs.set('memoryUsageReceipts/note-012',{uid:'alice'});
    if(mode==='budget')f.docs.set(`obsidianImportBudgets/${createHash('sha256').update('alice').digest('hex')}_1970-01-01`,{v:1,uid:'alice',day:'1970-01-01',imports:10,memories:0,bytes:0});
    const before=structuredClone([...f.docs]);await assert.rejects(executeObsidianImport('alice',value,'begin',f.deps));assert.deepEqual([...f.docs],before);
  }
});
test('vault import quota changes after admission pause without partial batch or duplicate count and can resume after authorized entitlement change',async()=>{
  const f=fixture();const value=plan();f.docs.set('config/monetization',{mode:'paid'});await executeObsidianImport('alice',value,'begin',f.deps);
  f.docs.set('users/alice',{usage:{memoriesThisMonth:28,periodYear:1970,periodMonth:1}});const before=structuredClone([...f.docs]);await assert.rejects(executeObsidianImport('alice',batches(value)[0],'apply',f.deps),{code:'resource-exhausted'});assert.deepEqual([...f.docs],before);
  f.docs.set('entitlements/alice',{effectiveTier:'pro'});for(const input of batches(value))await executeObsidianImport('alice',input,'apply',f.deps);assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,41);
});
test('vault import manifest binding, ordered batches and all graph scopes reject altered work without changing progress or graph',async()=>{
  for(const mode of ['batch','order','owner','team','share','deleted','cipher','receipt']){
    const f=fixture();const value=plan();const calls=batches(value);await executeObsidianImport('alice',value,'begin',f.deps);
    if(mode==='batch'){const input=structuredClone(calls[0]);input.memories[0].enc.ct='C'.repeat(32);await assert.rejects(executeObsidianImport('alice',input,'apply',f.deps),{code:'aborted'});assert.equal(f.docs.get('obsidianImports/synthetic-import').nextBatch,0);continue;}
    if(mode==='order'){await assert.rejects(executeObsidianImport('alice',calls[1],'apply',f.deps),{code:'aborted'});continue;}
    await executeObsidianImport('alice',calls[0],'apply',f.deps);await executeObsidianImport('alice',calls[1],'apply',f.deps);
    const patch={owner:{uid:'bob'},team:{teamId:'crew'},share:{sharedWithIds:['bob']},deleted:{deletedAt:1001},cipher:{enc:{...enc,ct:'C'.repeat(32)}}}[mode];
    if(patch)Object.assign(f.docs.get('sessions/note-000'),patch);if(mode==='receipt')f.docs.get('memoryCreationReceipts/note-000').status='cancelled';
    const before=structuredClone([...f.docs]);await assert.rejects(executeObsidianImport('alice',calls[2],'apply',f.deps));assert.deepEqual([...f.docs],before);
  }
});
test('vault import cancel preserves committed progress and blocks all future batches; cancel-before-begin blocks a late plan',async()=>{
  for(const started of [false,true]){
    const f=fixture();const value=plan();if(started){await executeObsidianImport('alice',value,'begin',f.deps);await executeObsidianImport('alice',batches(value)[0],'apply',f.deps);}
    const cancelled=await executeObsidianImport('alice',identity(value),'cancel',f.deps);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.createdCount,started?10:0);
    await assert.rejects(executeObsidianImport('alice',value,'begin',f.deps));await assert.rejects(executeObsidianImport('alice',batches(value)[started?1:0],'apply',f.deps));assert.equal(f.docs.has('sessions/note-012'),false);
    if(started)assert.equal((await executeObsidianImport('alice',batches(value)[0],'apply',f.deps)).status,'cancelled');
  }
});
test('vault import foreign IDs/digests and permanent account deletion cannot consult or advance existing progress',async()=>{
  const f=fixture();const value=plan();await executeObsidianImport('alice',value,'begin',f.deps);
  await assert.rejects(executeObsidianImport('bob',identity(value),'status',f.deps),{code:'permission-denied'});await assert.rejects(executeObsidianImport('alice',{...identity(value),planDigest:'f'.repeat(64)},'status',f.deps),{code:'permission-denied'});
  f.docs.set('accountDeletions/alice',{status:'complete'});await assert.rejects(executeObsidianImport('alice',batches(value)[0],'apply',f.deps),{code:'permission-denied'});
});
test('vault import closed gates, absent Auth and malformed ciphertext fail before rate/DB work; no provider secrets bind',async()=>{
  const value=plan();await assert.rejects(beginObsidianImport.run(value,{}),{code:'unauthenticated'});await assert.rejects(beginObsidianImport.run({...value,text:'Synthetic'},{auth:{uid:'alice'}}),{code:'invalid-argument'});
  await assert.rejects(beginObsidianImport.run(value,{auth:{uid:'alice'}}),{code:'failed-precondition'});await assert.rejects(applyObsidianImportBatch.run(batches(value)[0],{auth:{uid:'alice'}}),{code:'failed-precondition'});
  for(const callable of [beginObsidianImport,applyObsidianImportBatch,getObsidianImportStatus,cancelObsidianImport])assert.deepEqual(callable.__endpoint.secretEnvironmentVariables||[],[]);
});

function capsulePlan(count=13,shareId='synthetic-share'){
  const value=plan(count);return parseObsidianImportPlan({...value,source:'capsule-import',edges:[],capsule:{shareId}});
}
const share=()=>({uid:'bob',encrypted:true,ciphertext:{v:1,alg:'AES-GCM-PBKDF2',salt:'A'.repeat(24),iv:'B'.repeat(16),data:'C'.repeat(40)},importCount:0});
test('capsule contract requires its bounded share identity and disallows hubs, links, parents and forged plaintext author metadata',()=>{
  const value=capsulePlan();assert.equal(value.memories.length,13);assert.equal(capsulePlan(150,null).capsule.shareId,null);assert.throws(()=>capsulePlan(151));
  for(const bad of [{...value,capsule:undefined},{...value,capsule:{shareId:'../x'}},{...value,capsule:{shareId:'synthetic-share',ownerUid:'bob'}},{...value,capsule:{shareId:'x',title:'PRIVATE'}},{...value,edges:plan().edges},
    {...value,memories:[{...value.memories[0],metadata:{parentId:'foreign'}}]},{...plan(),capsule:{shareId:null}}])assert.throws(()=>parseObsidianImportPlan(bad));
});
test('capsule final record shares the last batch transaction, derives its author and replays without a second notice or creation',async()=>{
  const f=fixture();f.docs.set('shares/synthetic-share',share());const value=capsulePlan();await executeObsidianImport('alice',value,'begin',f.deps,'capsule');
  const calls=batches(value);await executeObsidianImport('alice',calls[0],'apply',f.deps,'capsule');assert.equal(f.docs.get('shares/synthetic-share').importCount,0);assert.equal(f.docs.has('capsuleImportNotices/synthetic-import'),false);
  await executeObsidianImport('alice',calls[1],'apply',f.deps,'capsule');const notice=f.docs.get('capsuleImportNotices/synthetic-import');assert.equal(notice.ownerUid,'bob');assert.equal(notice.titleHint,null);assert.equal(notice.itemCount,13);
  const before=structuredClone([...f.docs]);assert.equal((await executeObsidianImport('alice',calls[1],'apply',f.deps,'capsule')).status,'complete');assert.deepEqual([...f.docs],before);assert.equal(f.docs.get('users/alice').usage.memoriesThisMonth,13);assert.equal(f.docs.get('shares/synthetic-share').importCount,1);
  assert.equal((await executeObsidianImport('alice',identity(value),'cancel',f.deps)).status,'complete');
});
test('changed, removed, expired or revoked capsule and final notice collision stop the entire next batch and retain prior progress',async()=>{
  for(const mode of ['owner','cipher','deleted','expired','revoked','notice']){
    const f=fixture();f.docs.set('shares/synthetic-share',share());const value=capsulePlan();await executeObsidianImport('alice',value,'begin',f.deps);await executeObsidianImport('alice',batches(value)[0],'apply',f.deps);
    if(mode==='owner')f.docs.get('shares/synthetic-share').uid='alice';if(mode==='cipher')f.docs.get('shares/synthetic-share').ciphertext.data='D'.repeat(40);
    if(mode==='deleted')f.docs.delete('shares/synthetic-share');if(mode==='expired')f.docs.get('shares/synthetic-share').expiresAt=1000;
    if(mode==='revoked')f.docs.set('accountDeletions/bob',{status:'complete'});if(mode==='notice')f.docs.set('capsuleImportNotices/synthetic-import',{read:true});
    const before=structuredClone([...f.docs]);await assert.rejects(executeObsidianImport('alice',batches(value)[1],'apply',f.deps));assert.deepEqual([...f.docs],before);
    assert.equal((await executeObsidianImport('alice',identity(value),'cancel',f.deps)).createdCount,10);assert.equal(f.docs.has('sessions/note-012'),false);
  }
});
test('capsule and Obsidian write families cannot bypass each other; private/self imports have no author notices and closed gates fail before DB',async()=>{
  const f=fixture();const value=capsulePlan(2,null);await assert.rejects(executeObsidianImport('alice',value,'begin',f.deps,'obsidian'),{code:'permission-denied'});
  await assert.rejects(executeObsidianImport('alice',plan(2),'begin',f.deps,'capsule'),{code:'permission-denied'});
  await executeObsidianImport('alice',value,'begin',f.deps,'capsule');await assert.rejects(executeObsidianImport('alice',batches(value)[0],'apply',f.deps,'obsidian'),{code:'permission-denied'});
  await executeObsidianImport('alice',batches(value)[0],'apply',f.deps,'capsule');assert.equal([...f.docs.keys()].some(key=>key.startsWith('capsuleImportNotices/')),false);
  await assert.rejects(beginCapsuleImport.run(value,{auth:{uid:'alice'}}),{code:'failed-precondition'});await assert.rejects(applyCapsuleImportBatch.run(batches(value)[0],{auth:{uid:'alice'}}),{code:'failed-precondition'});
  for(const callable of [beginCapsuleImport,applyCapsuleImportBatch])assert.deepEqual(callable.__endpoint.secretEnvironmentVariables||[],[]);
});
