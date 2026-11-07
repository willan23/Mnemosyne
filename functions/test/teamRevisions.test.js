'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),{createHash}=require('node:crypto'),admin=require('firebase-admin');
const {executeTeamRevisionPreparation:prepare,executeTeamRevision:execute,executeTeamRevisionCall,prepareTeamRevision,applyTeamRevision,getTeamRevisionStatus,cancelTeamRevision}=require('../lib/teamRevisions');
const {parseTeamRevisionRequest,parseTeamRevisionBaseline,parseTeamRevisionCipher,teamRevisionRequestBytes}=require('../lib/teamRevisionContract');
const keyId='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222';
const cipher=(byte,v=2)=>({v,iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(32,byte).toString('base64')});
function fixture(){
  const docs=new Map();for(const uid of ['owner','admin','member','ex'])docs.set('users/'+uid,{uid});
  const team={ownerUid:'owner',memberUids:['owner','admin','member'],roles:{owner:'owner',admin:'admin',member:'member'},activeKeyEpoch:1,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null,wrappedKeys:{owner:{v:1},admin:{v:1},member:{v:1}}};
  docs.set('teams/org',team);docs.set('teams/org/keyEpochs/1',{epoch:1,keyId,status:'active',memberUids:[...team.memberUids],wrappedKeys:{...team.wrappedKeys}});docs.set('config/teamSecurity',{writesEnabled:true});
  docs.set('sessions/memory',{uid:'member',teamId:'org',keyEpoch:1,keyId,text:'',title:null,enc:cipher(1),timestamp:1,updatedAt:100,tags:['synthetic'],category:'Gerações',connections:['old-link'],embedding:[0.1,0.2],embeddingModel:'synthetic-model',entities:['synthetic-entity'],parentId:'source',taxonomyLane:'A',projectStatus:'active',generatedProvider:'synthetic',generatedModel:'synthetic-model',learning:{schemaVersion:1,source:'text-generation',modality:'text',learnedAt:1,batchId:null,attachmentCount:0},customMarker:{synthetic:1}});
  const versions=new Map(),ref=path=>({path,id:path.split('/').pop(),collection:kind=>({doc:id=>ref(path+'/'+kind+'/'+id)})});let stamp=1;
  const db={doc:ref,runTransaction:async work=>{const writes=[],get=async ref=>{assert.equal(writes.length,0);return{exists:docs.has(ref.path),ref,data:()=>structuredClone(docs.get(ref.path)),updateTime:admin.firestore.Timestamp.fromMillis(versions.get(ref.path)||1)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(ref,data)=>{assert.equal(docs.has(ref.path),false);writes.push({ref,data});},set:(ref,data)=>writes.push({ref,data}),update:(ref,data)=>writes.push({ref,data,merge:true})});
    for(const{ref,data,merge}of writes){docs.set(ref.path,merge?{...docs.get(ref.path),...data}:data);versions.set(ref.path,++stamp);}return result;
  }};
  const deps={firestore:db,now:()=>1000};return{docs,deps,touch:path=>versions.set(path,++stamp),input:async uid=>({operationId,baseline:await prepare(uid,{teamId:'org',sessionId:'memory'},deps),enc:cipher(2),priorEnc:cipher(1),metadata:{embedding:null,embeddingModel:null,semanticClusterId:null,position:null,importance:0.55,processingMethod:'learned:revision'}})};
}
test('team revision supersession belongs to its live actor and retains exact archived revision provenance',async()=>{
  const f=fixture(),input=await f.input('member');await execute('member',input,'apply',f.deps);
  const events=[...f.docs].filter(([path])=>path.startsWith('users/member/memoryEvents/')).map(([,row])=>row);assert.equal(events.length,1);
  assert.equal(events[0].source,'team-revision');assert.equal(events[0].kind,'supersede');assert.equal(events[0].memoryId,'memory');assert.equal(events[0].previousRevision,input.baseline.revision);assert.equal(events[0].revision,1000);
  assert(f.docs.has('sessions/memory/versions/'+events[0].versionId));const state=JSON.stringify([...f.docs]);await execute('member',input,'apply',f.deps);assert.equal(JSON.stringify([...f.docs]),state);
  const g=fixture(),cancel=await g.input('member');await execute('member',cancel,'cancel',g.deps);assert.equal([...g.docs.keys()].some(path=>path.includes('/memoryEvents/')),false);
});

test('team revision contracts bind target, full baseline and exact ciphertext/metadata; extra/private fields fail',async()=>{
  const f=fixture(),input=await f.input('member'),copy=parseTeamRevisionRequest(input);input.baseline.stateHash='f'.repeat(64);assert.notEqual(copy.baseline.stateHash,input.baseline.stateHash);
  for(const bad of [null,[],{...copy,uid:'ex'},{...copy,text:'Synthetic forbidden plaintext'},{...copy,operationId:'wrong'},{...copy,enc:{...copy.enc,v:'2'}},{...copy,priorEnc:{...copy.priorEnc,v:'1'}},{...copy,baseline:{...copy.baseline,teamId:'bad/path'}},{...copy,baseline:{...copy.baseline,keyEpoch:0}}])assert.throws(()=>parseTeamRevisionRequest(bad));
  assert.throws(()=>parseTeamRevisionBaseline({...copy.baseline,stateDigest:'bad'}));assert.throws(()=>parseTeamRevisionCipher({...copy.enc,iv:'wrong'}));assert.equal(teamRevisionRequestBytes(copy),teamRevisionRequestBytes(parseTeamRevisionRequest(copy)));
});
for(const actor of ['owner','admin','member'])test(`team revision ${actor} commits archive/parent/receipt/audit/budgets atomically with original authorship`,async()=>{
  const f=fixture(),input=await f.input(actor),before=structuredClone(f.docs.get('sessions/memory')),result=await execute(actor,input,'apply',f.deps),after=f.docs.get('sessions/memory'),version=f.docs.get('sessions/memory/versions/team-revision-'+operationId);
  assert.equal(result.status,'committed');assert.equal(result.revision,1000);assert.equal(after.uid,'member');assert.equal(after.timestamp,1);assert.deepEqual(after.customMarker,{synthetic:1});assert.deepEqual(after.connections,before.connections);assert.deepEqual(version.enc,before.enc);for(const key of ['learning','entities','parentId','taxonomyLane','projectStatus','generatedProvider','generatedModel'])assert.deepEqual(version[key],before[key]);assert.equal(version.editorUid,actor);assert.equal(version.uid,'member');assert.equal(version.timestamp,1);assert.equal(after.learning.revisedAt,1000);
  const audit=f.docs.get('teamAudit/revision-'+operationId);assert.equal(audit.actorUid,actor);assert.equal(audit.teamId,'org');assert.equal('enc' in audit,false);assert.equal('embedding' in audit,false);assert.equal([...f.docs.keys()].filter(key=>key.startsWith('teamRevisionBudgets/')).length,1);assert.equal([...f.docs.keys()].filter(key=>key.startsWith('teamRevisionTeamBudgets/')).length,1);
  const state=JSON.stringify([...f.docs]);for(const mode of ['status','apply','cancel'])assert.deepEqual(await execute(actor,input,mode,f.deps),result);assert.equal(JSON.stringify([...f.docs]),state);
});
test('an ex-member cannot prepare or apply and unknown recovery returns revoked without references',async()=>{
  const f=fixture(),input=await f.input('member'),before=JSON.stringify([...f.docs]);await assert.rejects(prepare('ex',{sessionId:'memory',teamId:'org'},f.deps),{code:'permission-denied'});await assert.rejects(execute('ex',input,'apply',f.deps),{code:'permission-denied'});assert.equal((await execute('ex',input,'status',f.deps)).status,'revoked');assert.equal((await execute('ex',input,'cancel',f.deps)).status,'revoked');assert.equal(JSON.stringify([...f.docs]),before);
});
test('complete document, team and epoch versions reject changed/restored content or metadata without rebasing',async()=>{
  for(const path of ['sessions/memory','teams/org','teams/org/keyEpochs/1']){const f=fixture(),input=await f.input('member');f.touch(path);const before=JSON.stringify([...f.docs]);await assert.rejects(execute('member',input,'apply',f.deps),{code:'aborted'});assert.equal(JSON.stringify([...f.docs]),before);}
  for(const key of ['embedding','learning','customMarker','connections']){const f=fixture(),input=await f.input('member');f.docs.get('sessions/memory')[key]={syntheticChanged:true};const before=JSON.stringify([...f.docs]);await assert.rejects(execute('member',input,'apply',f.deps),{code:'aborted'});assert.equal(JSON.stringify([...f.docs]),before);}
});
test('closed operational gate, rotation, missing epoch wraps and deleted parent never create partial history',async()=>{
  for(const change of ['gate','rotation','wrap','deleted']){const f=fixture(),input=await f.input('member');if(change==='gate')f.docs.get('config/teamSecurity').writesEnabled=false;if(change==='rotation')f.docs.get('teams/org').pendingRotationId=operationId;if(change==='wrap')delete f.docs.get('teams/org/keyEpochs/1').wrappedKeys.member;if(change==='deleted')f.docs.get('sessions/memory').deletedAt=101;
    const before=JSON.stringify([...f.docs]);await assert.rejects(execute('member',input,'apply',f.deps));assert.equal(JSON.stringify([...f.docs]),before);
  }
});
test('unknown cancellation is idempotent, preserves content and refuses later admission',async()=>{
  const f=fixture(),input=await f.input('member'),before=structuredClone(f.docs.get('sessions/memory'));assert.equal((await execute('member',input,'status',f.deps)).status,'unknown');const cancelled=await execute('member',input,'cancel',f.deps);assert.equal(cancelled.status,'cancelled');assert.deepEqual(await execute('member',input,'cancel',f.deps),cancelled);await assert.rejects(execute('member',input,'apply',f.deps));assert.deepEqual(f.docs.get('sessions/memory'),before);
});
test('legacy plaintext side fields refuse preparation without discarding unarchived source data',async()=>{
  for(const key of ['nodes','links','generatedPrompt','generatedImagePrompt']){const f=fixture();f.docs.get('sessions/memory')[key]=key.includes('Prompt')?'Synthetic legacy prompt':[];const before=JSON.stringify([...f.docs]);await assert.rejects(prepare('member',{sessionId:'memory',teamId:'org'},f.deps),{code:'permission-denied'});assert.equal(JSON.stringify([...f.docs]),before);}
});
test('terminal receipts recover after rotation/removal; purged receipts with permanent markers never recreate references',async()=>{
  const f=fixture(),input=await f.input('member'),committed=await execute('member',input,'apply',f.deps);f.docs.get('teams/org').memberUids=['owner'];f.docs.get('teams/org').pendingRotationId=operationId;const before=JSON.stringify([...f.docs]);assert.deepEqual(await execute('member',input,'status',f.deps),committed);assert.equal(JSON.stringify([...f.docs]),before);
  f.docs.delete('teamRevisions/'+operationId);f.docs.set('teamDeletions/org',{v:1,status:'complete'});f.docs.delete('teams/org');const purged=JSON.stringify([...f.docs]);for(const mode of ['status','cancel'])assert.equal((await execute('member',input,mode,f.deps)).status,'revoked');await assert.rejects(execute('member',input,'apply',f.deps));assert.equal(JSON.stringify([...f.docs]),purged);
});
test('account markers for actor/author/owner prevent new deletion references while transient absence is not revocation',async()=>{
  for(const uid of ['member','owner']){const f=fixture(),input=await f.input('admin');f.docs.set('accountDeletions/'+uid,{status:'complete'});const before=JSON.stringify([...f.docs]);assert.equal((await execute('admin',input,'cancel',f.deps)).status,'revoked');await assert.rejects(execute('admin',input,'apply',f.deps));assert.equal(JSON.stringify([...f.docs]),before);}
  const f=fixture(),input=await f.input('member');f.docs.set('accountDeletions/member',{status:'complete'});await assert.rejects(execute('member',input,'status',f.deps),{code:'permission-denied'});
  const g=fixture(),request=await g.input('member');g.docs.delete('teams/org');const before=JSON.stringify([...g.docs]);await assert.rejects(execute('member',request,'cancel',g.deps));assert.equal(JSON.stringify([...g.docs]),before);
});
test('user/team daily limits and occupied version/audit anchors fail atomically',async()=>{
  for(const kind of ['user-budget','team-budget','version','audit']){const f=fixture(),input=await f.input('member');const day='1970-01-01';if(kind==='user-budget')f.docs.set('teamRevisionBudgets/'+createHash('sha256').update(JSON.stringify(['member','org'])).digest('hex')+'_'+day,{v:1,uid:'member',teamId:'org',day,revisions:200,cipherBytes:0});if(kind==='team-budget')f.docs.set('teamRevisionTeamBudgets/'+createHash('sha256').update('org').digest('hex')+'_'+day,{v:1,teamId:'org',day,revisions:1000,cipherBytes:0});if(kind==='version')f.docs.set('sessions/memory/versions/team-revision-'+operationId,{synthetic:true});if(kind==='audit')f.docs.set('teamAudit/revision-'+operationId,{synthetic:true});const before=JSON.stringify([...f.docs]);await assert.rejects(execute('member',input,'apply',f.deps));assert.equal(JSON.stringify([...f.docs]),before);}
});
test('four commands bind captured actor before any database or rate access and keep the apply gate closed',async()=>{
  const f=fixture(),input=await f.input('member');for(const [mode,callable]of [['prepare',prepareTeamRevision],['apply',applyTeamRevision],['status',getTeamRevisionStatus],['cancel',cancelTeamRevision]]){
    const command={actorUid:'member',request:mode==='prepare'?{sessionId:'memory',teamId:'org'}:input};await assert.rejects(executeTeamRevisionCall('owner',mode,command,{firestore:{doc:()=>{throw Error('Unexpected database access');}},now:()=>1000}),{code:'permission-denied'});await assert.rejects(callable.run(command,{auth:{uid:'owner'}}),{code:'permission-denied'});await assert.rejects(executeTeamRevisionCall('member',mode,command.request,f.deps),{code:'invalid-argument'});
  }await assert.rejects(applyTeamRevision.run({actorUid:'member',request:input},{auth:{uid:'member'}}),{code:'failed-precondition'});
});
