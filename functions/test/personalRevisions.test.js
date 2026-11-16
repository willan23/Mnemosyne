const assert=require('node:assert/strict');const test=require('node:test');const {createHash}=require('node:crypto');
process.env.GCLOUD_PROJECT=process.env.GCLOUD_PROJECT||'demo-mnemosyne-test';
const admin=require('firebase-admin');
const {executePersonalRevisionPreparation:prepare,executePersonalRevision:execute,preparePersonalRevision,applyPersonalRevision,getPersonalRevisionStatus,cancelPersonalRevision}=require('../lib/personalRevisions');
const {parsePersonalRevisionRequest,parsePersonalRevisionBaseline}=require('../lib/personalRevisionContract');
const oldEnc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)},enc={v:1,iv:'C'.repeat(16),ct:'D'.repeat(32)};
const metadata={embedding:[0.1,0.2],embeddingModel:'synthetic-local',semanticClusterId:null,position:[1,2,3],importance:0.5,processingMethod:'learned:revision'};
const operationId='11111111-1111-4111-8111-111111111111';
function fixture(){
  const docs=new Map([['users/alice',{}],['sessions/note',{uid:'alice',teamId:null,timestamp:1,updatedAt:10,text:'',title:null,enc:oldEnc,
    attachments:[{synthetic:true}],tags:['old'],category:'old',connections:['peer'],learning:{source:'text-generation',learnedAt:1},generatedPrompt:'Legacy secret'}]]);
  let stamp=1;const ref=path=>({path,id:path.split('/').pop(),collection:name=>({doc:id=>ref(`${path}/${name}/${id}`)})});
  const db={doc:ref,runTransaction:async work=>{const writes=[];
    const get=async r=>{assert.equal(writes.length,0);return{exists:docs.has(r.path),updateTime:admin.firestore.Timestamp.fromMillis(stamp),data:()=>structuredClone(docs.get(r.path))};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),
      create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push({r,data});},set:(r,data)=>writes.push({r,data}),update:(r,data)=>writes.push({r,data,update:true})});
    for(const{r,data,update}of writes)docs.set(r.path,update?{...docs.get(r.path),...data}:data);if(writes.length)stamp++;return result;}};
  const deps={firestore:db,now:()=>1000};return{docs,deps,touch:()=>stamp++,input:async()=>({operationId,baseline:await prepare('alice',{sessionId:'note'},deps),enc,priorEnc:oldEnc,metadata})};
}
test('revision parsers clone baselines and reject authority, plaintext, malformed cipher and unknown metadata',async()=>{
  const f=fixture(),input=await f.input();assert.deepEqual(parsePersonalRevisionRequest(input),input);
  const copy=parsePersonalRevisionBaseline(input.baseline);input.baseline.revision=42;assert.equal(copy.revision,10);
  for(const bad of [null,[],{...input,uid:'alice'},{...input,text:'private'},{...input,operationId:'bad'},{...input,enc:{v:2}},
    {...input,metadata:{...metadata,importance:NaN}},{...input,metadata:{...metadata,teamId:'crew'}},{...input,metadata:{...metadata,embedding:[Infinity]}},
    {...input,baseline:{...copy,revision:1.5}}])assert.throws(()=>parsePersonalRevisionRequest(bad));
});

test('personal revision records one private supersession in the same commit and collision aborts the complete revision',async()=>{
  const f=fixture(),input=await f.input();await execute('alice',input,'apply',f.deps);
  const entries=[...f.docs].filter(([path])=>path.startsWith('users/alice/memoryEvents/'));assert.equal(entries.length,1);
  const [path,event]=entries[0];assert.equal(event.kind,'supersede');assert.equal(event.source,'personal-revision');
  assert.equal(event.memoryId,'note');assert.equal(event.previousRevision,10);assert.equal(event.revision,1000);
  assert.equal(event.versionId,'revision-'+operationId);assert(f.docs.has('sessions/note/versions/'+event.versionId));
  assert.equal(JSON.stringify(event).includes('Legacy'),false);await execute('alice',input,'apply',f.deps);
  assert.equal([...f.docs].filter(([key])=>key.startsWith('users/alice/memoryEvents/')).length,1);
  const g=fixture(),request=await g.input();g.docs.set(path,{occupied:true});const before=JSON.stringify([...g.docs]);
  await assert.rejects(execute('alice',request,'apply',g.deps));assert.equal(JSON.stringify([...g.docs]),before);
});
test('revision preparation returns only state hashes and revision, while apply archives and accounts atomically',async()=>{
  const f=fixture(),input=await f.input(),before=structuredClone(f.docs.get('sessions/note'));
  assert.deepEqual(Object.keys(input.baseline).sort(),['revision','sessionId','stateDigest','stateHash']);assert.equal(JSON.stringify(input.baseline).includes('Legacy'),false);
  const result=await execute('alice',input,'apply',f.deps);assert.equal(result.status,'committed');assert.equal(result.revision,1000);
  const current=f.docs.get('sessions/note'),archive=f.docs.get(`sessions/note/versions/revision-${operationId}`);
  assert.deepEqual(archive.enc,oldEnc);assert.equal(archive.text,'');assert.equal(archive.title,null);assert.equal(archive.previousUpdatedAt,10);
  assert.deepEqual(current.enc,enc);assert.deepEqual(current.learning,{source:'text-generation',learnedAt:1,revisedAt:1000});
  for(const key of ['uid','teamId','timestamp','attachments','tags','category','connections'])assert.deepEqual(current[key],before[key]);
  for(const key of ['nodes','links','generatedPrompt','generatedImagePrompt'])assert.equal(current[key],null);
  assert.deepEqual(f.docs.get('users/alice'),{});assert.equal([...f.docs.keys()].filter(p=>p.startsWith('personalRevisionBudgets/')).length,1);
  const snapshot=structuredClone([...f.docs]);assert.deepEqual(await execute('alice',input,'apply',f.deps),result);assert.deepEqual([...f.docs],snapshot);
});
test('revision receipt replay after deletion neither recreates a memory nor consumes another budget',async()=>{
  const f=fixture(),input=await f.input(),result=await execute('alice',input,'apply',f.deps);f.docs.delete('sessions/note');
  const snapshot=structuredClone([...f.docs]);for(const mode of ['status','apply','cancel'])assert.deepEqual(await execute('alice',input,mode,f.deps),result);
  assert.deepEqual([...f.docs],snapshot);await assert.rejects(execute('alice',{...input,enc:oldEnc},'status',f.deps),{code:'permission-denied'});
  f.docs.set('users/bob',{});await assert.rejects(execute('bob',input,'status',f.deps),{code:'permission-denied'});
});
test('revision whole document and Firestore update stamp comparisons prevent silent rebasing',async()=>{
  for(const patch of [{updatedAt:11},{connections:[]},{attachments:[]},{uid:'bob'},{teamId:'crew'},{teamId:undefined},{sharedWithIds:['bob']},{deletedAt:1},{learning:'bad'},{enc:{...enc,v:2}}]){
    const f=fixture(),input=await f.input();Object.assign(f.docs.get('sessions/note'),patch);const snapshot=structuredClone([...f.docs]);
    await assert.rejects(execute('alice',input,'apply',f.deps));assert.deepEqual([...f.docs],snapshot);
  }
  const f=fixture(),input=await f.input();f.touch();await assert.rejects(execute('alice',input,'apply',f.deps),{code:'aborted'});
  const fresh=await f.input();await assert.rejects(execute('alice',{...fresh,priorEnc:enc},'apply',f.deps),{code:'aborted'});
});
test('legacy plaintext archives accept only a client ciphertext envelope and remove prompts from current state',async()=>{
  const f=fixture();Object.assign(f.docs.get('sessions/note'),{enc:null,text:'Legacy note',title:'Legacy title'});const input=await f.input();
  await execute('alice',input,'apply',f.deps);const archive=f.docs.get(`sessions/note/versions/revision-${operationId}`);
  assert.equal(archive.text,'');assert.equal(archive.title,null);assert.deepEqual(archive.enc,oldEnc);assert.equal(JSON.stringify(archive).includes('Legacy'),false);
});
test('status is read only; cancelled revisions reject late apply and committed cancel preserves its historical outcome',async()=>{
  const f=fixture(),input=await f.input(),snapshot=structuredClone([...f.docs]);assert.equal((await execute('alice',input,'status',f.deps)).status,'unknown');assert.deepEqual([...f.docs],snapshot);
  f.docs.delete('sessions/note');const cancelled=await execute('alice',input,'cancel',f.deps);assert.equal(cancelled.status,'cancelled');
  assert.deepEqual(await execute('alice',input,'cancel',f.deps),cancelled);await assert.rejects(execute('alice',input,'apply',f.deps),{code:'failed-precondition'});
});
test('daily revision quota refusal leaves archive, receipt, parent and budget unchanged',async()=>{
  for(const consumed of [{revisions:200,cipherBytes:0},{revisions:0,cipherBytes:20*1024*1024}]){
    const f=fixture(),input=await f.input(),day='1970-01-01',id=createHash('sha256').update('alice').digest('hex')+'_'+day;
    f.docs.set('personalRevisionBudgets/'+id,{v:1,uid:'alice',day,...consumed});const snapshot=structuredClone([...f.docs]);
    await assert.rejects(execute('alice',input,'apply',f.deps),{code:'resource-exhausted'});assert.deepEqual([...f.docs],snapshot);
  }
});
test('account revocation refuses preparation and every receipt operation; closed callable touches no database',async()=>{
  const f=fixture(),input=await f.input();f.docs.set('accountDeletions/alice',{status:'complete'});
  await assert.rejects(prepare('alice',{sessionId:'note'},f.deps),{code:'permission-denied'});
  for(const mode of ['status','apply','cancel'])await assert.rejects(execute('alice',input,mode,f.deps),{code:'permission-denied'});
  await assert.rejects(applyPersonalRevision.run(input,{}),{code:'unauthenticated'});
  await assert.rejects(applyPersonalRevision.run({...input,plaintext:'secret'},{auth:{uid:'alice'}}),{code:'invalid-argument'});
  await assert.rejects(applyPersonalRevision.run(input,{auth:{uid:'alice'}}),{code:'failed-precondition'});
  for(const callable of [preparePersonalRevision,applyPersonalRevision,getPersonalRevisionStatus,cancelPersonalRevision])assert.deepEqual(callable.__endpoint.secretEnvironmentVariables||[],[]);
});
