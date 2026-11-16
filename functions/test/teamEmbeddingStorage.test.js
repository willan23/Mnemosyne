'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),{createHash}=require('node:crypto'),admin=require('firebase-admin');
const service=require('../lib/teamRevisions'),contract=require('../lib/teamRevisionContract'),storage=require('../lib/embeddingStorage');
const keyId='11111111-1111-4111-8111-111111111111',first='22222222-2222-4222-8222-222222222222',second='33333333-3333-4333-8333-333333333333';
const cipher=byte=>({v:2,iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(32,byte).toString('base64')}),hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(index={embedding:[-0,Number.MIN_VALUE,1/3],embeddingModel:'historic@1'}){
  const docs=new Map();for(const uid of ['owner','admin','member','ex'])docs.set('users/'+uid,{uid});
  const team={ownerUid:'owner',memberUids:['owner','admin','member'],roles:{owner:'owner',admin:'admin',member:'member'},activeKeyEpoch:2,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null,wrappedKeys:{owner:{v:1},admin:{v:1},member:{v:1}}};
  docs.set('teams/org',team);docs.set('teams/org/keyEpochs/2',{epoch:2,keyId,status:'active',memberUids:[...team.memberUids],wrappedKeys:{...team.wrappedKeys}});docs.set('config/teamSecurity',{writesEnabled:true});
  docs.set('sessions/note',{uid:'member',teamId:'org',keyEpoch:1,keyId,text:'',title:null,enc:cipher(1),timestamp:1,updatedAt:100,connections:['peer'],learning:{source:'text-generation',learnedAt:1},customMarker:{retained:true},...index});
  const versions=new Map(),ref=path=>({path,id:path.split('/').pop(),collection:kind=>({doc:id=>ref(path+'/'+kind+'/'+id)})});let stamp=1;
  const db={doc:ref,runTransaction:async work=>{const writes=[],get=async target=>{assert.equal(writes.length,0);return{exists:docs.has(target.path),ref:target,data:()=>structuredClone(docs.get(target.path)),updateTime:admin.firestore.Timestamp.fromMillis(versions.get(target.path)||1)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(target,data)=>{assert(!docs.has(target.path));writes.push({target,data});},set:(target,data)=>writes.push({target,data}),update:(target,data)=>writes.push({target,data,merge:true})});
    for(const{target,data,merge}of writes){const next=merge?{...docs.get(target.path)}:{};for(const[key,value]of Object.entries(data)){if(value instanceof Object&&value.isEqual?.(admin.firestore.FieldValue.delete()))delete next[key];else next[key]=value;}docs.set(target.path,next);versions.set(target.path,++stamp);}return result;
  }};
  const deps={firestore:db,now:()=>1000};return{docs,deps,touch:path=>versions.set(path,++stamp),request:async(uid='member',change={kind:'compact'},operationId=first)=>({operationId,baseline:await service.executeTeamRevisionPreparation(uid,{sessionId:'note',teamId:'org'},deps),change})};
}
const apply=(f,uid,input)=>service.executeTeamRevision(uid,input,'apply',f.deps),state=f=>structuredClone([...f.docs]);

test('team storage contract accepts only compact/validated rollback and preserves content-revision request bytes',async()=>{
  const f=fixture(),input=await f.request();assert.deepEqual(contract.parseTeamRevisionRequest(input),input);
  const rollback={...input,change:{kind:'rollback',versionId:'team-revision-'+second}};assert.deepEqual(contract.parseTeamRevisionRequest(rollback),rollback);
  for(const bad of [{...input,uid:'owner'},{...input,enc:cipher(2)},{...input,change:{kind:'compact',vector:[1]}},{...input,change:{kind:'compact',space:'replacement'}},{...input,change:{kind:'rollback',versionId:'embedding-index-'+first}},{...input,change:{kind:'rollback',versionId:'team-revision-wrong'}},{...input,change:{kind:'rollback',versionId:'team-revision-'+first,teamId:'other'}}])assert.throws(()=>contract.parseTeamRevisionRequest(bad));
  const legacy={operationId:first,baseline:input.baseline,enc:cipher(2),priorEnc:cipher(1),metadata:{embedding:null,embeddingModel:null,semanticClusterId:null,position:null,importance:.5,processingMethod:'learned:revision'}};
  assert.equal(contract.teamRevisionRequestBytes(legacy),contract.teamRevisionRequestBytes(contract.parseTeamRevisionRequest(legacy)));assert.notEqual(contract.teamRevisionRequestBytes(input),contract.teamRevisionRequestBytes(legacy));
});
for(const actor of ['owner','admin','member'])test(`team storage ${actor} preserves exact source, historic epoch and model while creating one receipt/audit/budget`,async()=>{
  const f=fixture(),input=await f.request(actor),before=structuredClone(f.docs.get('sessions/note')),result=await apply(f,actor,input),after=f.docs.get('sessions/note'),version=f.docs.get('sessions/note/versions/team-revision-'+first);
  assert.equal(result.status,'committed');assert.equal(typeof after.embedding,'string');const vector=storage.readStoredEmbedding(after.embedding);assert(vector.every((n,i)=>Object.is(n,before.embedding[i])));
  for(const key of Object.keys(before)){assert.deepEqual(version[key],before[key]);if(key!=='embedding'&&key!=='updatedAt')assert.deepEqual(after[key],before[key]);}
  assert.equal(after.keyEpoch,1);assert.equal(version.teamEmbeddingIndex.kind,'compact');assert.equal(version.editorUid,actor);assert.equal(after.lastVersionId,'team-revision-'+first);assert.equal([...f.docs.keys()].filter(p=>p.includes('/memoryEvents/')).length,0);
  const audit=f.docs.get('teamAudit/revision-'+first);assert.equal(audit.type,'embedding_storage_compacted');assert.equal('enc' in audit,false);assert.equal('embedding' in audit,false);
  const user=[...f.docs].find(([p])=>p.startsWith('teamRevisionBudgets/'))[1],team=[...f.docs].find(([p])=>p.startsWith('teamRevisionTeamBudgets/'))[1];assert.equal(user.revisions,1);assert.equal(team.revisions,1);assert(user.cipherBytes>=Buffer.byteLength(require('../lib/mobileSyncImportContract').canonicalSyncState(before)));assert.equal(team.cipherBytes,user.cipherBytes);
  const committed=state(f);for(const mode of ['apply','status','cancel'])assert.deepEqual(await service.executeTeamRevision(actor,input,mode,f.deps),result);assert.deepEqual(state(f),committed);
});
test('unknown, null and absent historical model markers survive compact/rollback without relabelling',async()=>{
  for(const marker of [{},{embeddingModel:null},{embeddingModel:'unknown-historical-space'}]){
    const f=fixture({embedding:[.1,.2],...marker}),before=structuredClone(f.docs.get('sessions/note'));await apply(f,'member',await f.request());
    assert.equal(Object.hasOwn(f.docs.get('sessions/note'),'embeddingModel'),Object.hasOwn(before,'embeddingModel'));
    await apply(f,'member',await f.request('member',{kind:'rollback',versionId:'team-revision-'+first},second));const after=f.docs.get('sessions/note');
    for(const key of Object.keys(before).filter(k=>k!=='updatedAt'))assert.deepEqual(after[key],before[key]);assert.equal(Object.hasOwn(after,'embeddingModel'),Object.hasOwn(before,'embeddingModel'));assert.equal(f.docs.get('teamAudit/revision-'+second).type,'embedding_storage_rolled_back');
  }
});
test('recovery after member removal returns only the existing actor-bound receipt; missing receipts do not recreate deleted references',async()=>{
  const f=fixture(),request=await f.request(),done=await apply(f,'member',request);f.docs.get('teams/org').memberUids=['owner'];f.docs.get('teams/org').pendingRotationId=second;
  const before=state(f);for(const mode of ['status','cancel','apply'])assert.deepEqual(await service.executeTeamRevision('member',request,mode,f.deps),done);assert.deepEqual(state(f),before);
  await assert.rejects(service.executeTeamRevision('owner',request,'status',f.deps),{code:'permission-denied'});
  f.docs.delete('teamRevisions/'+first);f.docs.set('teamDeletions/org',{status:'complete'});f.docs.delete('teams/org');const removed=state(f);for(const mode of ['status','cancel'])assert.equal((await service.executeTeamRevision('member',request,mode,f.deps)).status,'revoked');await assert.rejects(apply(f,'member',request),{code:'permission-denied'});assert.deepEqual(state(f),removed);
});
test('parent, team and active epoch ABA versions abort storage writes without rebasing or partial history',async()=>{
  for(const path of ['sessions/note','teams/org','teams/org/keyEpochs/2']){const f=fixture(),request=await f.request();f.touch(path);const before=state(f);await assert.rejects(apply(f,'member',request),{code:'aborted'});assert.deepEqual(state(f),before);}
});
test('removal, rotation, wraps, account deletion, operational gate and shared/tombstoned scope fail atomically',async()=>{
  const changes=[f=>f.docs.get('teams/org').memberUids.splice(2,1),f=>{f.docs.get('teams/org').pendingRotationId=second;},f=>{delete f.docs.get('teams/org/keyEpochs/2').wrappedKeys.member;},f=>f.docs.set('accountDeletions/member',{status:'complete'}),f=>f.docs.set('accountDeletions/owner',{status:'complete'}),f=>{f.docs.get('config/teamSecurity').writesEnabled=false;},f=>{f.docs.get('sessions/note').sharedWithIds=['ex'];},f=>{f.docs.get('sessions/note').deletedAt=100;},f=>{f.docs.get('sessions/note').teamScopeAmbiguous=true;}];
  for(const change of changes){const f=fixture(),request=await f.request();change(f);const before=state(f);await assert.rejects(apply(f,'member',request));assert.deepEqual(state(f),before);}
  const f=fixture();await assert.rejects(f.request('ex'),{code:'permission-denied'});
});
test('already compact, empty, absent, corrupt or nonfinite vectors never create a storage revision',async()=>{
  for(const index of [{embedding:'[1,0]'},{embedding:[]},{},{embedding:null},{embedding:[1,null]},{embedding:[1,Infinity]},{embedding:[1],embeddingModel:42}]){const f=fixture(index),before=state(f);await assert.rejects(async()=>apply(f,'member',await f.request()));assert.deepEqual(state(f),before);}
});
test('rollback checks provenance, author, team and unchanged ciphertext; never restores content, graph or a foreign snapshot',async()=>{
  const changes=[row=>{row.uid='ex';},row=>{row.teamId='foreign';},row=>{row.enc=cipher(7);},row=>{row.teamEmbeddingIndex.kind='foreign';},row=>{row.teamEmbeddingIndex.operationId=second;},row=>{row.teamEmbeddingIndex.contentDigest='f'.repeat(64);},row=>{row.embedding=[1,null];}];
  for(const change of changes){const f=fixture();await apply(f,'member',await f.request());change(f.docs.get('sessions/note/versions/team-revision-'+first));const input=await f.request('member',{kind:'rollback',versionId:'team-revision-'+first},second),before=state(f);await assert.rejects(apply(f,'member',input));assert.deepEqual(state(f),before);}
  const f=fixture();await apply(f,'member',await f.request());f.docs.get('sessions/note').enc=cipher(8);const input=await f.request('member',{kind:'rollback',versionId:'team-revision-'+first},second),before=state(f);await assert.rejects(apply(f,'member',input));assert.deepEqual(state(f),before);
});
test('shared user/team operation and byte budgets and occupied anchors reject the whole mutation',async()=>{
  for(const kind of ['user-count','team-count','user-bytes','team-bytes','archive','audit']){const f=fixture(),request=await f.request(),day='1970-01-01';
    if(kind.startsWith('user'))f.docs.set('teamRevisionBudgets/'+hash(JSON.stringify(['member','org']))+'_'+day,{v:1,uid:'member',teamId:'org',day,revisions:kind==='user-count'?200:0,cipherBytes:kind==='user-bytes'?20*1024*1024:0});
    if(kind.startsWith('team'))f.docs.set('teamRevisionTeamBudgets/'+hash('org')+'_'+day,{v:1,teamId:'org',day,revisions:kind==='team-count'?1000:0,cipherBytes:kind==='team-bytes'?100*1024*1024:0});
    if(kind==='archive')f.docs.set('sessions/note/versions/team-revision-'+first,{occupied:true});if(kind==='audit')f.docs.set('teamAudit/revision-'+first,{occupied:true});
    const before=state(f);await assert.rejects(apply(f,'member',request),{code:kind==='archive'||kind==='audit'?'already-exists':'resource-exhausted'});assert.deepEqual(state(f),before);
  }
});
test('storage cancellation seals only its nonce, does not admit later writes and cannot reuse another change digest',async()=>{
  const f=fixture(),input=await f.request(),before=structuredClone(f.docs.get('sessions/note'));const cancelled=await service.executeTeamRevision('member',input,'cancel',f.deps);assert.equal(cancelled.status,'cancelled');assert.deepEqual(f.docs.get('sessions/note'),before);assert.equal([...f.docs.keys()].filter(p=>p.startsWith('teamAudit/')).length,0);await assert.rejects(apply(f,'member',input));
  await assert.rejects(service.executeTeamRevision('member',{...input,change:{kind:'rollback',versionId:'team-revision-'+second}},'status',f.deps),{code:'permission-denied'});
});
test('storage commands keep the existing captured actor binding and closed release gate',async()=>{
  const f=fixture(),input=await f.request();for(const mode of ['apply','status','cancel'])await assert.rejects(service.executeTeamRevisionCall('owner',mode,{actorUid:'member',request:input},{firestore:{doc:()=>{throw Error('Unexpected database call');}},now:()=>1000}),{code:'permission-denied'});
  await assert.rejects(service.applyTeamRevision.run({actorUid:'member',request:input},{auth:{uid:'member'}}),{code:'failed-precondition'});
});
