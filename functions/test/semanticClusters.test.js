'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),admin=require('firebase-admin'),{createHash}=require('node:crypto');
const {executeSemanticClusterPreparation:prepare,executeSemanticClusters:execute,executeSemanticClusterCall,applySemanticClusters}=require('../lib/semanticClusters');
const {canonicalSyncState}=require('../lib/mobileSyncImportContract');
const {semanticClusterGraphProjection,parseSemanticClusterRequest}=require('../lib/semanticClusterContract');
const {buildSemanticClusterBackfillPatches}=require('../lib/semanticClusterGraph');
const hash=value=>createHash('sha256').update(value).digest('hex'),keyId='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222';
const copy=value=>value instanceof admin.firestore.Timestamp?value:Array.isArray(value)?value.map(copy):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,value])=>[key,copy(value)])):value;
function fixture(teamId=null){
  const docs=new Map(),versions=new Map();let stamp=1;
  for(const uid of ['owner','alice','bob','foreign'])docs.set('users/'+uid,{});
  const team={ownerUid:'owner',memberUids:['owner','alice','bob'],wrappedKeys:{owner:{v:1},alice:{v:1},bob:{v:1}},activeKeyEpoch:2,activeKeyId:keyId,keyRotationStatus:'active',pendingRotationId:null};
  docs.set('teams/crew',team);docs.set('teams/crew/keyEpochs/2',{epoch:2,keyId,status:'active',memberUids:team.memberUids,wrappedKeys:team.wrappedKeys});docs.set('config/teamSecurity',{writesEnabled:true});
  for(const [index,id]of ['a','b'].entries())docs.set('sessions/'+id,{uid:teamId&&index?'bob':'alice',teamId,timestamp:index+1,updatedAt:10+index,connections:[index?'a':'b'],enc:{v:1,ct:'unchanged',iv:'unchanged'},text:'Legacy retained',title:'Retained',custom:{retained:true},attachments:[{retained:true}]});
  const ref=path=>({path,id:path.split('/').pop()}),db={doc:ref,runTransaction:async work=>{
    const writes=[],get=async ref=>{assert.equal(writes.length,0);return {id:ref.id,exists:docs.has(ref.path),ref,data:()=>copy(docs.get(ref.path)),updateTime:admin.firestore.Timestamp.fromMillis(versions.get(ref.path)||1)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.filter(ref=>ref.path).map(get)),create:(ref,data)=>{assert.equal(docs.has(ref.path),false);writes.push({ref,data});},set:(ref,data)=>writes.push({ref,data}),update:(ref,data)=>writes.push({ref,data,merge:true})});
    const time=++stamp;function resolve(value){if(value instanceof admin.firestore.FieldValue)return admin.firestore.Timestamp.fromMillis(time);if(Array.isArray(value))return value.map(resolve);if(value&&typeof value==='object'&&!(value instanceof admin.firestore.Timestamp))return Object.fromEntries(Object.entries(value).map(([key,value])=>[key,resolve(value)]));return value;}
    for(const{ref,data,merge}of writes){const row=resolve(data);docs.set(ref.path,merge?{...docs.get(ref.path),...row}:row);versions.set(ref.path,time);}return result;
  }};
  const deps={firestore:db,now:()=>1000},target=()=>({scope:{teamId},views:['a','b'].map(sessionId=>({sessionId,graphHash:hash(canonicalSyncState(semanticClusterGraphProjection(sessionId,docs.get('sessions/'+sessionId))))}))});
  return{docs,deps,target,touch:path=>versions.set(path,++stamp),input:async()=>{const base=await prepare('alice',target(),deps),namespace=hash(canonicalSyncState({uid:teamId===null?'alice':null,teamId})).slice(0,32);return{...base,operationId,patches:buildSemanticClusterBackfillPatches(['a','b'].map(id=>({id,...docs.get('sessions/'+id)})),namespace).map(row=>({sessionId:row.id,semanticClusterId:row.semanticClusterId}))};}};
}
test('scoped metadata writes preserve all content and metadata; receipt advances only exact committed versions and retries are read-only',async()=>{
  for(const teamId of [null,'crew']){const f=fixture(teamId),input=await f.input(),before=['a','b'].map(id=>structuredClone(f.docs.get('sessions/'+id))),first={...input,patches:input.patches.slice(0,1)},result=await execute('alice',first,'apply',f.deps);assert.equal(result.changed,1);assert.equal(result.dependencyUpdates[0].sessionId,'a');
    for(const[index,id]of ['a','b'].entries()){const row=f.docs.get('sessions/'+id);for(const key of ['uid','timestamp','teamId','enc','text','title','attachments','connections','custom'])assert.deepEqual(row[key],before[index][key]);}assert.equal(f.docs.get('semanticClusterEvents/'+operationId).changes[0].previousClusterPresent,false);
    const terminal=JSON.stringify([...f.docs]);assert.deepEqual(await execute('alice',first,'apply',f.deps),result);assert.equal(JSON.stringify([...f.docs]),terminal);
    const next={...input,operationId:'33333333-3333-4333-8333-333333333333',patches:input.patches.slice(1),dependencies:input.dependencies.map(row=>({...row,stateHash:result.dependencyUpdates.find(update=>update.sessionId===row.sessionId)?.stateHash??row.stateHash}))};assert.equal((await execute('alice',next,'apply',f.deps)).changed,1);assert.equal(f.docs.get('sessions/a').semanticClusterId,f.docs.get('sessions/b').semanticClusterId);
  }
});
test('ciphertext metadata and ABA versions reject the entire batch without rebase; mismatched original graph cannot prepare',async()=>{
  for(const path of ['sessions/a','sessions/b','teams/crew','teams/crew/keyEpochs/2']){const f=fixture('crew'),input=await f.input();f.touch(path);const before=JSON.stringify([...f.docs]);await assert.rejects(execute('alice',input,'apply',f.deps),{code:'aborted'});assert.equal(JSON.stringify([...f.docs]),before);}
  const f=fixture(),target=f.target();f.docs.get('sessions/a').connections=[];await assert.rejects(prepare('alice',target,f.deps),{code:'aborted'});
});
test('derived clusters cannot overwrite persisted labels or accept arbitrary client labels, incomplete or malformed authority',async()=>{
  const f=fixture(),input=await f.input();assert.throws(()=>parseSemanticClusterRequest({...input,patches:[...input.patches,input.patches[0]]}));assert.throws(()=>parseSemanticClusterRequest({...input,authority:{...input.authority,keyEpoch:2}}));assert.throws(()=>parseSemanticClusterRequest({...input,text:'unwanted'}));await assert.rejects(execute('alice',{...input,patches:[{sessionId:'a',semanticClusterId:'arbitrary'}]},'apply',f.deps),{code:'invalid-argument'});
  await assert.rejects(prepare('alice',{...f.target(),views:f.target().views.slice(0,1)},f.deps),{code:'aborted'});
  f.docs.get('sessions/a').semanticClusterId='kept';const base=await prepare('alice',f.target(),f.deps);await assert.rejects(execute('alice',{...base,operationId,patches:[{sessionId:'a',semanticClusterId:'overwrite'}]},'apply',f.deps),{code:'invalid-argument'});assert.equal(f.docs.get('sessions/a').semanticClusterId,'kept');
});
test('shared foreign deleted or ambiguous personal documents never prepare and team membership is required',async()=>{
  for(const changes of [{uid:'bob'},{sharedWithIds:['bob']},{deletedAt:12},{teamScopeAmbiguous:true},{teamId:undefined}]){const f=fixture(),target=f.target();Object.assign(f.docs.get('sessions/a'),changes);await assert.rejects(prepare('alice',target,f.deps));assert.equal([...f.docs.keys()].some(path=>path.startsWith('semanticCluster')),false);}const f=fixture('crew');await assert.rejects(prepare('foreign',f.target(),f.deps),{code:'permission-denied'});
});
test('known result survives team removal; unknown cancellation remains possible during rotation; author deletion is read-only revocation',async()=>{
  const f=fixture('crew'),input=await f.input(),committed=await execute('alice',input,'apply',f.deps);f.docs.get('teams/crew').memberUids=['owner'];assert.deepEqual(await execute('alice',input,'status',f.deps),committed);await assert.rejects(execute('bob',input,'status',f.deps),{code:'permission-denied'});
  const rotation=fixture('crew'),request=await rotation.input();rotation.docs.get('teams/crew').keyRotationStatus='rotation_pending';rotation.docs.delete('teams/crew/keyEpochs/2');assert.equal((await execute('alice',request,'status',rotation.deps)).status,'unknown');await assert.rejects(execute('alice',request,'apply',rotation.deps));assert.equal((await execute('alice',request,'cancel',rotation.deps)).status,'cancelled');assert.equal([...rotation.docs.keys()].some(path=>path.startsWith('semanticClusterBudgets')),false);
  const revoked=fixture('crew'),pending=await revoked.input();revoked.docs.set('accountDeletions/bob',{});const before=JSON.stringify([...revoked.docs]);assert.equal((await execute('alice',pending,'cancel',revoked.deps)).status,'revoked');await assert.rejects(execute('alice',pending,'apply',revoked.deps),{code:'permission-denied'});assert.equal(JSON.stringify([...revoked.docs]),before);
});
test('gates quotas invalid terminal deltas and captured actor mismatch refuse mutation',async()=>{
  const f=fixture('crew'),input=await f.input();f.docs.get('config/teamSecurity').writesEnabled=false;await assert.rejects(execute('alice',input,'apply',f.deps));f.docs.get('config/teamSecurity').writesEnabled=true;const day='1970-01-01',path='semanticClusterBudgets/'+hash(canonicalSyncState({uid:'alice',teamId:'crew'}))+'_'+day;f.docs.set(path,{v:1,uid:'alice',teamId:'crew',day,operations:200,writes:0,reads:0});await assert.rejects(execute('alice',input,'apply',f.deps),{code:'resource-exhausted'});f.docs.delete(path);await execute('alice',input,'apply',f.deps);f.docs.get('semanticClusterChanges/'+operationId).changedIds=['foreign'];await assert.rejects(execute('alice',input,'status',f.deps),{code:'permission-denied'});
  const deps={firestore:{doc:()=>{throw Error('Unexpected DB');}},now:()=>1};await assert.rejects(executeSemanticClusterCall('bob','apply',{actorUid:'alice',request:input},deps),{code:'permission-denied'});await assert.rejects(applySemanticClusters.run({actorUid:'alice',request:input},{auth:{uid:'alice'}}),{code:'failed-precondition'});
});
test('already matching labels charge one metadata operation without content versions or parent updates; unsafe revisions refuse atomically',async()=>{
  const f=fixture(),input=await f.input();for(const patch of input.patches)f.docs.get('sessions/'+patch.sessionId).semanticClusterId=patch.semanticClusterId;const base=await prepare('alice',f.target(),f.deps),before=['a','b'].map(id=>copy(f.docs.get('sessions/'+id))),result=await execute('alice',{...input,...base},'apply',f.deps);assert.equal(result.changed,0);assert.deepEqual(result.dependencyUpdates,[]);for(const[index,id]of ['a','b'].entries())assert.deepEqual(f.docs.get('sessions/'+id),before[index]);assert.deepEqual(f.docs.get('semanticClusterEvents/'+operationId).changes,[]);
  const overflow=fixture();overflow.docs.get('sessions/a').updatedAt=Number.MAX_SAFE_INTEGER;const request=await overflow.input(),snapshot=JSON.stringify([...overflow.docs]);await assert.rejects(execute('alice',request,'apply',overflow.deps));assert.equal(JSON.stringify([...overflow.docs]),snapshot);
});
