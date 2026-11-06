'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),{createHash}=require('node:crypto'),admin=require('firebase-admin');
const {executeMemoryEditPreparation:prepare,executeMemoryEdit:execute,executeMemoryEditCall,prepareMemoryEdit,applyMemoryEdit,getMemoryEditStatus,cancelMemoryEdit}=require('../lib/memoryEdits');
const {parseMemoryEditRequest,parseMemoryEditBaseline,parseMemoryEditMetadata,memoryEditRequestBytes}=require('../lib/memoryEditContract');
const keyId='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222';
const cipher=(byte,v=1)=>({v,iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(32,byte).toString('base64')});
function fixture(team=false){
  const docs=new Map();for(const uid of ['owner','alice','bob','ex'])docs.set('users/'+uid,{uid});
  const row={ownerUid:'owner',memberUids:['owner','alice','bob'],roles:{owner:'owner',alice:'admin',bob:'member'},activeKeyEpoch:1,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null,wrappedKeys:{owner:{v:1},alice:{v:1},bob:{v:1}}};
  docs.set('teams/crew',row);docs.set('teams/crew/keyEpochs/1',{epoch:1,keyId,status:'active',memberUids:row.memberUids,wrappedKeys:row.wrappedKeys});docs.set('config/teamSecurity',{writesEnabled:true});
  docs.set('sessions/memory',{uid:team?'bob':'alice',teamId:team?'crew':null,...(team?{keyEpoch:1,keyId}:{}),text:'',title:null,enc:cipher(1,team?2:1),timestamp:1,updatedAt:100,tags:['synthetic'],category:'Universe',connections:['old-link'],attachments:[{synthetic:true}],embedding:[.1],embeddingModel:'synthetic-model',parentId:'parent',generatedProvider:'synthetic',learning:{source:'manual'},customMarker:{preserved:true}});
  const versions=new Map();let stamp=1;const ref=path=>({path,id:path.split('/').pop(),collection:kind=>({doc:id=>ref(path+'/'+kind+'/'+id)})});
  const db={doc:ref,runTransaction:async work=>{const writes=[],get=async ref=>{assert.equal(writes.length,0);return{exists:docs.has(ref.path),ref,data:()=>structuredClone(docs.get(ref.path)),updateTime:admin.firestore.Timestamp.fromMillis(versions.get(ref.path)||1)};};const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(ref,data)=>{assert.equal(docs.has(ref.path),false);writes.push({ref,data});},set:(ref,data)=>writes.push({ref,data}),update:(ref,data)=>writes.push({ref,data,merge:true})});for(const{ref,data,merge}of writes){docs.set(ref.path,merge?{...docs.get(ref.path),...data}:data);versions.set(ref.path,++stamp);}return result;}};
  const deps={firestore:db,now:()=>1000};return{docs,deps,touch:path=>versions.set(path,++stamp),input:async(uid='alice',operation='edit')=>({operationId,operation,baseline:await prepare(uid,{sessionId:'memory',teamId:team?'crew':null},deps),enc:operation==='edit'?cipher(2,team?2:1):null,priorEnc:cipher(1,team?2:1),metadata:operation==='edit'?{tags:['changed'],projectStatus:'done'}:{}})};
}
test('supersession records exact edit provenance once and excludes tombstones and cancelled requests',async()=>{
  for(const team of [false,true]){const f=fixture(team),input=await f.input();await execute('alice',input,'apply',f.deps);
    const events=[...f.docs].filter(([path])=>path.startsWith('users/alice/memoryEvents/')).map(([,row])=>row);assert.equal(events.length,1);
    assert.equal(events[0].kind,'supersede');assert.equal(events[0].source,'memory-edit');assert.equal(events[0].memoryId,'memory');assert.equal(events[0].previousRevision,input.baseline.revision);assert.equal(events[0].revision,1000);
    assert(f.docs.has('sessions/memory/versions/'+events[0].versionId));assert.equal('enc'in events[0],false);await execute('alice',input,'apply',f.deps);
    assert.equal([...f.docs.keys()].filter(path=>path.startsWith('users/alice/memoryEvents/')).length,1);
  }
  for(const mode of ['delete','cancel']){const f=fixture(),input=await f.input('alice',mode==='delete'?'delete':'edit');await execute('alice',input,mode==='cancel'?'cancel':'apply',f.deps);assert.equal([...f.docs.keys()].some(path=>path.includes('/memoryEvents/')),false);}
});

test('generic edit contract rejects authority, plaintext, graph, attachment and incompatible deletion payloads',async()=>{
  const f=fixture(),input=await f.input(),copy=parseMemoryEditRequest(input);assert.equal(memoryEditRequestBytes(copy),memoryEditRequestBytes(parseMemoryEditRequest(copy)));input.baseline.revision=999;assert.notEqual(copy.baseline.revision,input.baseline.revision);
  for(const bad of [null,[],{...copy,uid:'bob'},{...copy,text:'Synthetic forbidden text'},{...copy,enc:{...copy.enc,v:2}},{...copy,metadata:{connections:['forged']}},{...copy,metadata:{attachments:[]}},{...copy,metadata:{learning:{revisedAt:1}}},{...copy,operation:'delete'},{...copy,baseline:{...copy.baseline,teamId:'crew'}},{...copy,baseline:{...copy.baseline,ownerUid:'bob'}}])assert.throws(()=>parseMemoryEditRequest(bad));
  for(const metadata of [{tags:null},{importance:null},{embedding:[.1]},{embedding:null},{entities:{privatePrompt:['Synthetic']}},{color:'red'},{position:[Infinity,0,0]},{taxonomyLane:'Z'},{scale:-1},{processingMethod:''},{category:undefined}])assert.throws(()=>parseMemoryEditMetadata(metadata));
  assert.deepEqual(parseMemoryEditMetadata({embedding:null,embeddingModel:null,projectStatus:null,entities:{people:['Synthetic person']},color:'#ab01EF',orbitSpeed:-1}),{embedding:null,embeddingModel:null,projectStatus:null,entities:{people:['Synthetic person']},color:'#ab01EF',orbitSpeed:-1});assert.throws(()=>parseMemoryEditBaseline({...copy.baseline,keyEpoch:1}));
});
for(const team of [false,true])test(`${team?'team':'personal'} edit commits one exact archive, metadata patch, event, receipt and budgets without changing other fields`,async()=>{
  const f=fixture(team),input=await f.input(),before=structuredClone(f.docs.get('sessions/memory')),result=await execute('alice',input,'apply',f.deps),after=f.docs.get('sessions/memory'),version=f.docs.get('sessions/memory/versions/memory-edit-'+operationId);
  assert.equal(result.status,'committed');assert.equal(after.uid,before.uid);assert.equal(after.timestamp,1);assert.deepEqual(after.tags,['changed']);assert.equal(after.projectStatus,'done');for(const key of ['attachments','connections','embedding','parentId','generatedProvider','customMarker'])assert.deepEqual(after[key],before[key]);assert.deepEqual(version.enc,before.enc);assert.deepEqual(version.learning,before.learning);assert.equal(after.learning.revisedAt,1000);
  assert.equal([...f.docs.keys()].filter(path=>path.startsWith('memoryEditBudgets/')).length,1);assert.equal([...f.docs.keys()].filter(path=>path.startsWith('memoryEditTeamBudgets/')).length,team?1:0);const event=f.docs.get('memoryEditEvents/'+operationId);assert.equal(event.operation,'edit');for(const key of ['enc','embedding','text','title','tags'])assert.equal(key in event,false);
  const state=JSON.stringify([...f.docs]);for(const mode of ['status','apply','cancel'])assert.deepEqual(await execute('alice',input,mode,f.deps),result);assert.equal(JSON.stringify([...f.docs]),state);
});
test('personal owner and team owner tombstones archive without relabelling or replacing the historical cipher context',async()=>{
  for(const team of [false,true]){const f=fixture(team),uid=team?'owner':'alice',input=await f.input(uid,'delete'),before=structuredClone(f.docs.get('sessions/memory'));await execute(uid,input,'apply',f.deps);const after=f.docs.get('sessions/memory');assert.equal(after.deletedAt,1000);assert.equal(after.uid,before.uid);assert.deepEqual(after.enc,before.enc);assert.equal(after.keyEpoch,before.keyEpoch);assert.deepEqual(after.learning,before.learning);}
  for(const uid of ['alice','bob']){const f=fixture(true),input=await f.input(uid,'delete'),before=JSON.stringify([...f.docs]);await assert.rejects(execute(uid,input,'apply',f.deps),{code:'permission-denied'});assert.equal(JSON.stringify([...f.docs]),before);}
});
test('legacy owned plaintext can be archived as supplied ciphertext, while raw side fields and missing explicit scope refuse',async()=>{
  const f=fixture();Object.assign(f.docs.get('sessions/memory'),{enc:null,text:'Synthetic legacy text',title:null});const input=await f.input();await execute('alice',input,'apply',f.deps);assert.equal(f.docs.get('sessions/memory').text,'');assert.deepEqual(f.docs.get('sessions/memory/versions/memory-edit-'+operationId).enc,input.priorEnc);
  for(const field of ['nodes','links','generatedPrompt','generatedImagePrompt','teamId']){const g=fixture();if(field==='teamId')delete g.docs.get('sessions/memory').teamId;else g.docs.get('sessions/memory')[field]=[];const before=JSON.stringify([...g.docs]);await assert.rejects(g.input());assert.equal(JSON.stringify([...g.docs]),before);}
});
test('a shared owner can edit while a shared recipient cannot substitute the personal owner or cipher',async()=>{
  const f=fixture();f.docs.get('sessions/memory').sharedWithIds=['bob'];const input=await f.input();await assert.rejects(prepare('bob',{sessionId:'memory',teamId:null},f.deps),{code:'permission-denied'});await assert.rejects(execute('bob',input,'cancel',f.deps),{code:'permission-denied'});await execute('alice',input,'apply',f.deps);assert.deepEqual(f.docs.get('sessions/memory').sharedWithIds,['bob']);
});
test('complete document/team/epoch versions refuse stale and ABA operations with no partial writes',async()=>{
  for(const path of ['sessions/memory','teams/crew','teams/crew/keyEpochs/1']){const f=fixture(true),input=await f.input();f.touch(path);const before=JSON.stringify([...f.docs]);await assert.rejects(execute('alice',input,'apply',f.deps),{code:'aborted'});assert.equal(JSON.stringify([...f.docs]),before);}
  const f=fixture(),input=await f.input();f.docs.get('sessions/memory').customMarker={changed:true};const before=JSON.stringify([...f.docs]);await assert.rejects(execute('alice',input,'apply',f.deps),{code:'aborted'});assert.equal(JSON.stringify([...f.docs]),before);
});
test('owned cancellation is idempotent and terminal recovery survives lost parent and changed team access',async()=>{
  const f=fixture(true),input=await f.input();assert.equal((await execute('alice',input,'status',f.deps)).status,'unknown');const cancelled=await execute('alice',input,'cancel',f.deps);assert.deepEqual(await execute('alice',input,'cancel',f.deps),cancelled);await assert.rejects(execute('alice',input,'apply',f.deps));assert.equal(f.docs.has('sessions/memory/versions/memory-edit-'+operationId),false);
  const g=fixture(true),request=await g.input(),committed=await execute('alice',request,'apply',g.deps);g.docs.delete('sessions/memory');g.docs.get('teams/crew').memberUids=['owner'];g.docs.get('teams/crew').pendingRotationId=operationId;const before=JSON.stringify([...g.docs]);assert.deepEqual(await execute('alice',request,'status',g.deps),committed);assert.equal(JSON.stringify([...g.docs]),before);
});
test('permanent author/owner/team revocation closes unknown requests without references; actor markers deny every mode',async()=>{
  for(const path of ['accountDeletions/bob','accountDeletions/owner','teamDeletions/crew']){const f=fixture(true),input=await f.input();f.docs.set(path,{status:'complete'});const before=JSON.stringify([...f.docs]);for(const mode of ['status','cancel'])assert.equal((await execute('alice',input,mode,f.deps)).status,'revoked');await assert.rejects(execute('alice',input,'apply',f.deps));assert.equal(JSON.stringify([...f.docs]),before);}
  const f=fixture(),input=await f.input();f.docs.set('accountDeletions/alice',{status:'complete'});for(const mode of ['status','cancel','apply'])await assert.rejects(execute('alice',input,mode,f.deps),{code:'permission-denied'});
});
test('quotas, operational stop, occupied anchors and malformed receipts fail without a partial tombstone',async()=>{
  for(const kind of ['quota','team-quota','gate','rotation','version','event','receipt']){const f=fixture(true),input=await f.input('owner','delete'),day='1970-01-01';if(kind==='quota')f.docs.set('memoryEditBudgets/'+createHash('sha256').update(JSON.stringify(['owner','crew'])).digest('hex')+'_'+day,{v:1,uid:'owner',teamId:'crew',day,operations:200,cipherBytes:0});if(kind==='team-quota')f.docs.set('memoryEditTeamBudgets/'+createHash('sha256').update('crew').digest('hex')+'_'+day,{v:1,teamId:'crew',day,operations:1000,cipherBytes:0});if(kind==='gate')f.docs.get('config/teamSecurity').writesEnabled=false;if(kind==='rotation')f.docs.get('teams/crew').pendingRotationId=operationId;if(kind==='version')f.docs.set('sessions/memory/versions/memory-edit-'+operationId,{});if(kind==='event')f.docs.set('memoryEditEvents/'+operationId,{});if(kind==='receipt')f.docs.set('memoryEdits/'+operationId,{uid:'foreign'});const before=JSON.stringify([...f.docs]);await assert.rejects(execute('owner',input,'apply',f.deps));assert.equal(JSON.stringify([...f.docs]),before);}
});
test('all commands bind captured actor before rate/database access and both admission source gates stay closed',async()=>{
  const f=fixture(),input=await f.input();for(const [mode,callable]of [['prepare',prepareMemoryEdit],['apply',applyMemoryEdit],['status',getMemoryEditStatus],['cancel',cancelMemoryEdit]]){const command={actorUid:'alice',request:mode==='prepare'?{sessionId:'memory',teamId:null}:input};await assert.rejects(executeMemoryEditCall('bob',mode,command,{firestore:{doc:()=>{throw Error('Unexpected access');}}}),{code:'permission-denied'});await assert.rejects(callable.run(command,{auth:{uid:'bob'}}),{code:'permission-denied'});await assert.rejects(executeMemoryEditCall('alice',mode,command.request,f.deps),{code:'invalid-argument'});}
  await assert.rejects(applyMemoryEdit.run({actorUid:'alice',request:input},{auth:{uid:'alice'}}),{code:'failed-precondition'});const team=fixture(true);await assert.rejects(applyMemoryEdit.run({actorUid:'alice',request:await team.input()},{auth:{uid:'alice'}}),{code:'failed-precondition'});
});

test('trusted proposal admission reads precede writes and finalize the receipt in the same transaction',async()=>{
  const f=fixture(),input=await f.input();let reads=0,finalized=0;
  f.deps.authorize=async(tx,request,digest,receipt)=>{
    reads++;await tx.get(f.deps.firestore.doc('users/alice'));
    assert.equal(request.operationId,input.operationId);assert.equal(typeof digest,'string');
    if(receipt)return undefined;
    return(outcome,context)=>{finalized++;assert.equal(context.after.lastVersionId,context.versionId);assert.equal(context.before.updatedAt,100);
      tx.create(f.deps.firestore.doc('syntheticProposalReceipts/'+input.operationId),{digest,status:outcome.status,versionId:context.versionId});};
  };
  await execute('alice',input,'apply',f.deps);await execute('alice',input,'apply',f.deps);
  assert.equal(reads,2);assert.equal(finalized,1);assert.equal(f.docs.get('syntheticProposalReceipts/'+input.operationId).status,'committed');
});
test('proposal admission cannot bypass terminal receipt checks and a failing finalizer leaves every write uncommitted',async()=>{
  const f=fixture(),input=await f.input();const before=JSON.stringify([...f.docs]);
  f.deps.authorize=async()=>()=>{throw Error('Synthetic gate closed before commit');};
  await assert.rejects(execute('alice',input,'apply',f.deps));assert.equal(JSON.stringify([...f.docs]),before);
  delete f.deps.authorize;await execute('alice',input,'apply',f.deps);const committed=JSON.stringify([...f.docs]);
  f.deps.authorize=async()=>{throw Error('Synthetic proposal mismatch');};await assert.rejects(execute('alice',input,'apply',f.deps));
  assert.equal(JSON.stringify([...f.docs]),committed);
});
