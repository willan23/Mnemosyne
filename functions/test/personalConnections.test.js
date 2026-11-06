const assert=require('node:assert/strict');const test=require('node:test');
process.env.GCLOUD_PROJECT=process.env.GCLOUD_PROJECT||'demo-mnemosyne-test';
const admin=require('firebase-admin');
const {executePersonalConnection,executePersonalConnectionPreparation,applyPersonalConnection,preparePersonalConnection,getPersonalConnectionStatus,cancelPersonalConnection}=require('../lib/personalConnections');
const {parsePersonalConnectionRequest,parsePersonalConnectionPair,MAX_PERSONAL_CONNECTIONS}=require('../lib/personalConnectionContract');
const {parseSyncMetadata}=require('../lib/mobileSyncImportContract');
const enc={v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)};
const pair={sourceId:'source',targetId:'target'};
function fixture(){
  const base={uid:'alice',teamId:null,text:'',title:null,enc,timestamp:1,updatedAt:10,connections:[],attachments:[{synthetic:true}],learning:{source:'obsidian-vault'}};
  const docs=new Map([['users/alice',{}],['sessions/source',structuredClone(base)],['sessions/target',structuredClone(base)]]);let version=1;
  const ref=path=>({path,id:path.split('/').pop(),collection:name=>({doc:id=>ref(`${path}/${name}/${id}`)})});
  const db={doc:ref,runTransaction:async work=>{
    const writes=[];const get=async ref=>{assert.equal(writes.length,0);return{ref,id:ref.id,exists:docs.has(ref.path),updateTime:admin.firestore.Timestamp.fromMillis(version),data:()=>docs.get(ref.path)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(ref,data)=>{assert.equal(docs.has(ref.path),false);writes.push({ref,data});},update:(ref,data)=>writes.push({ref,data,update:true})});
    for(const {ref,data,update}of writes)docs.set(ref.path,update?{...docs.get(ref.path),...data}:data);if(writes.length)version++;return result;
  }};
  return{docs,deps:{firestore:db,now:()=>1000},prepare:async(operationId='operation',operation='link')=>{
    const prep=await executePersonalConnectionPreparation('alice',pair,{firestore:db,now:()=>1000});return{...pair,operationId,operation,expectedSourceHash:prep.sourceHash,expectedTargetHash:prep.targetHash};
  }};
}
test('personal connections reject authority, plaintext, self links, invalid hashes and extra fields before admission',()=>{
  const good={...pair,operationId:'op',operation:'link',expectedSourceHash:'a'.repeat(64),expectedTargetHash:'b'.repeat(64)};
  assert.deepEqual(parsePersonalConnectionRequest(good),good);assert.deepEqual(parsePersonalConnectionPair(pair),pair);
  for(const data of [null,[],{...good,uid:'alice'},{...good,text:'Synthetic'},{...good,enc},{...good,sourceId:'a/b'},{...good,targetId:'source'},{...good,operation:'infer'},{...good,expectedTargetHash:'x'.repeat(64)}])assert.throws(()=>parsePersonalConnectionRequest(data));
  assert.doesNotThrow(()=>parseSyncMetadata({connections:Array.from({length:150},(_,i)=>'synthetic-'+i)}));
  assert.throws(()=>parseSyncMetadata({connections:Array.from({length:MAX_PERSONAL_CONNECTIONS+1},(_,i)=>'synthetic-'+i)}));assert.throws(()=>parseSyncMetadata({tags:Array(101).fill('Synthetic')}));
});
test('personal connections atomically archive both ciphertext documents and apply both edges without consuming memory quota',async()=>{
  const f=fixture();const input=await f.prepare();const before=structuredClone([...f.docs.entries()]);
  const prep=await executePersonalConnectionPreparation('alice',pair,f.deps);assert.deepEqual(Object.keys(prep).sort(),['sourceHash','sourceId','targetHash','targetId']);
  const result=await executePersonalConnection('alice',input,'apply',f.deps);assert.equal(result.status,'committed');assert.equal(result.changed,true);
  assert.deepEqual(f.docs.get('sessions/source').connections,['target']);assert.deepEqual(f.docs.get('sessions/target').connections,['source']);
  const histories=[...f.docs].filter(([path])=>path.includes('/versions/'));assert.equal(histories.length,2);
  for(const [path,data]of histories){const old=before.find(([p])=>path.startsWith(p+'/versions/'))[1];assert.deepEqual(data.enc,old.enc);assert.deepEqual(data.attachments,old.attachments);assert.deepEqual(data.learning,old.learning);assert.deepEqual(data.connections,[]);}
  assert.deepEqual(f.docs.get('users/alice'),{});assert.equal([...f.docs.keys()].some(path=>path.startsWith('memoryUsageReceipts/')),false);
  const replay=await executePersonalConnection('alice',input,'apply',f.deps);assert.deepEqual(replay,result);assert.equal([...f.docs].filter(([path])=>path.includes('/versions/')).length,2);
});
test('personal connections replay historical results after target removal without resurrecting or reverting later edges',async()=>{
  const f=fixture();const input=await f.prepare();const result=await executePersonalConnection('alice',input,'apply',f.deps);
  f.docs.delete('sessions/target');f.docs.get('sessions/source').connections=[];
  assert.deepEqual(await executePersonalConnection('alice',input,'apply',f.deps),result);assert.equal(f.docs.has('sessions/target'),false);assert.deepEqual(f.docs.get('sessions/source').connections,[]);
  await assert.rejects(executePersonalConnection('alice',{...input,operation:'unlink'},'status',f.deps),{code:'permission-denied'});
  f.docs.set('users/bob',{});await assert.rejects(executePersonalConnection('bob',input,'status',f.deps),{code:'permission-denied'});
});
test('personal connections repair one-sided legacy links and no-op repeats avoid extra revisions and archives',async()=>{
  const f=fixture();f.docs.get('sessions/source').connections=['target'];const input=await f.prepare();
  const source=structuredClone(f.docs.get('sessions/source'));await executePersonalConnection('alice',input,'apply',f.deps);
  assert.deepEqual(f.docs.get('sessions/source'),source);assert.deepEqual(f.docs.get('sessions/target').connections,['source']);assert.equal([...f.docs.keys()].filter(path=>path.includes('/versions/')).length,1);
  const noop=await f.prepare('noop');const state=structuredClone([...f.docs]);const result=await executePersonalConnection('alice',noop,'apply',f.deps);assert.equal(result.changed,false);
  for(const [path,data]of state)assert.deepEqual(f.docs.get(path),data);
  const unlink=await f.prepare('unlink','unlink');await executePersonalConnection('alice',unlink,'apply',f.deps);assert.deepEqual(f.docs.get('sessions/source').connections,[]);assert.deepEqual(f.docs.get('sessions/target').connections,[]);
});
test('personal connections stale document state, ambiguous scope, deletion and malformed ciphertext leave both edges and receipt untouched',async()=>{
  for(const patch of [{updatedAt:11},{position:[1,2,3]},{uid:'bob'},{teamId:'crew'},{teamId:undefined},{sharedWithIds:['bob']},{deletedAt:20},{enc:{...enc,v:2}},{connections:['target','target']},{text:'Synthetic legacy'}]){
    const f=fixture();const input=await f.prepare();Object.assign(f.docs.get('sessions/source'),patch);const before=structuredClone([...f.docs]);
    await assert.rejects(executePersonalConnection('alice',input,'apply',f.deps));assert.deepEqual([...f.docs],before);
  }
  const f=fixture();const input=await f.prepare();f.docs.set('accountDeletions/alice',{status:'complete'});await assert.rejects(executePersonalConnection('alice',input,'apply',f.deps),{code:'permission-denied'});
});
test('personal connections cancel-before-apply survives missing targets and blocks a late write; committed cancel preserves its historical result',async()=>{
  const f=fixture();const input=await f.prepare();f.docs.delete('sessions/target');
  assert.equal((await executePersonalConnection('alice',input,'status',f.deps)).status,'unknown');
  const cancelled=await executePersonalConnection('alice',input,'cancel',f.deps);assert.equal(cancelled.status,'cancelled');
  await assert.rejects(executePersonalConnection('alice',input,'apply',f.deps),{code:'failed-precondition'});assert.equal(f.docs.has('sessions/target'),false);
  const committedFixture=fixture();const committedInput=await committedFixture.prepare();const saved=await executePersonalConnection('alice',committedInput,'apply',committedFixture.deps);
  assert.deepEqual(await executePersonalConnection('alice',committedInput,'cancel',committedFixture.deps),saved);
});
test('personal connections closed callable and malformed calls fail before database/rate access and bind no provider secrets',async()=>{
  const input={...pair,operationId:'op',operation:'link',expectedSourceHash:'a'.repeat(64),expectedTargetHash:'b'.repeat(64)};
  await assert.rejects(applyPersonalConnection.run(input,{}),{code:'unauthenticated'});await assert.rejects(applyPersonalConnection.run({...input,token:'Synthetic'},{auth:{uid:'alice'}}),{code:'invalid-argument'});
  await assert.rejects(applyPersonalConnection.run(input,{auth:{uid:'alice'}}),{code:'failed-precondition'});
  for(const callable of [applyPersonalConnection,preparePersonalConnection,getPersonalConnectionStatus,cancelPersonalConnection])assert.deepEqual(callable.__endpoint.secretEnvironmentVariables||[],[]);
});
