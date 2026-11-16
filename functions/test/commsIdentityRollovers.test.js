'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),{createHash,generateKeyPairSync}=require('node:crypto'),admin=require('firebase-admin');
const {executeCommsIdentityPreparation:prepare,executeCommsIdentityRollover:execute,executeCommsIdentityCall,applyCommsIdentityRollover,prepareCommsIdentityRollover,getCommsIdentityRolloverStatus,cancelCommsIdentityRollover}=require('../lib/commsIdentityRollovers');
const {parseCommsIdentityRollover,parseCommsIdentityBaseline,parseCommsIdentityCommand}=require('../lib/commsIdentityContract');
const pem=()=>{const key=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey;return`-----BEGIN PUBLIC KEY-----\n${key.export({type:'spki',format:'der'}).toString('base64')}\n-----END PUBLIC KEY-----`;};
const oldPem=pem(),newPem=pem(),operationId='11111111-1111-4111-8111-111111111111';
function fixture(){
  const docs=new Map([['users/alice',{uid:'alice',publicKeyPem:oldPem,usage:{synthetic:1}}],['publicProfiles/alice',{uid:'alice',publicKeyPem:oldPem,displayName:'Synthetic Alice'}]]);let stamp=1;
  const ref=path=>({path,id:path.split('/').pop()});const db={doc:ref,runTransaction:async work=>{const writes=[];const get=async r=>{assert.equal(writes.length,0);return{exists:docs.has(r.path),data:()=>structuredClone(docs.get(r.path)),updateTime:admin.firestore.Timestamp.fromMillis(stamp)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push({r,data});},set:(r,data)=>writes.push({r,data}),update:(r,data)=>writes.push({r,data,merge:true})});
    for(const{r,data,merge}of writes)docs.set(r.path,merge?{...docs.get(r.path),...data}:data);if(writes.length)stamp++;return result;
  }};const deps={firestore:db,now:()=>1000};return{docs,deps,touch:()=>stamp++,input:async()=>({operationId,baseline:await prepare('alice',{},deps),publicKeyPem:newPem})};
}
test('identity rollover contract rejects private material, foreign authority, invalid IDs and mutable baselines',async()=>{
  const f=fixture(),input=await f.input(),copy=parseCommsIdentityRollover(input);input.baseline.userStateHash='a'.repeat(64);assert.notEqual(copy.baseline.userStateHash,input.baseline.userStateHash);
  for(const bad of [null,[],{...copy,uid:'bob'},{...copy,privateKey:'secret'},{...copy,operationId:'bad'},{...copy,publicKeyPem:'private'},{...copy,baseline:{...copy.baseline,publicKeyPem:oldPem}}])assert.throws(()=>parseCommsIdentityRollover(bad));
  assert.throws(()=>parseCommsIdentityBaseline({...copy.baseline,priorFingerprint:'bad'}));
});
test('identity rollover commits both profiles, receipt and daily budget atomically and preserves unrelated profile fields',async()=>{
  const f=fixture(),input=await f.input(),result=await execute('alice',input,'apply',f.deps);assert.equal(result.status,'committed');assert.equal(result.current,true);
  assert.equal(f.docs.get('users/alice').publicKeyPem,newPem);assert.equal(f.docs.get('publicProfiles/alice').publicKeyPem,newPem);assert.deepEqual(f.docs.get('users/alice').usage,{synthetic:1});assert.equal(f.docs.get('publicProfiles/alice').displayName,'Synthetic Alice');
  assert.equal([...f.docs.keys()].filter(key=>key.startsWith('commsIdentityBudgets/')).length,1);const state=JSON.stringify([...f.docs]);
  for(const mode of ['status','apply','cancel'])assert.deepEqual(await execute('alice',input,mode,f.deps),result);assert.equal(JSON.stringify([...f.docs]),state);
});
test('CAS includes complete profiles and Firestore version stamps, and never silently rebases',async()=>{
  for(const patch of ['usage','profile','stamp','key']){const f=fixture(),input=await f.input();if(patch==='usage')f.docs.get('users/alice').usage.synthetic=2;if(patch==='profile')f.docs.get('publicProfiles/alice').displayName='Changed';if(patch==='stamp')f.touch();if(patch==='key')f.docs.get('users/alice').publicKeyPem=newPem;
    const state=JSON.stringify([...f.docs]);await assert.rejects(execute('alice',input,'apply',f.deps));assert.equal(JSON.stringify([...f.docs]),state);
  }
});
test('a historical committed receipt never replaces a newer identity or recreates a removed public profile',async()=>{
  const f=fixture(),input=await f.input();await execute('alice',input,'apply',f.deps);f.docs.get('users/alice').publicKeyPem=oldPem;f.docs.get('publicProfiles/alice').publicKeyPem=oldPem;
  let state=JSON.stringify([...f.docs]);const replay=await execute('alice',input,'apply',f.deps);assert.equal(replay.status,'committed');assert.equal(replay.current,false);assert.equal(JSON.stringify([...f.docs]),state);
  f.docs.delete('publicProfiles/alice');state=JSON.stringify([...f.docs]);assert.equal((await execute('alice',input,'cancel',f.deps)).current,false);assert.equal(JSON.stringify([...f.docs]),state);
});
test('cancel serializes with apply, keeps the old profiles and forbids later apply',async()=>{
  const f=fixture(),input=await f.input();assert.equal((await execute('alice',input,'status',f.deps)).status,'unknown');assert.equal(f.docs.size,2);
  const result=await execute('alice',input,'cancel',f.deps);assert.equal(result.status,'cancelled');assert.equal(result.current,false);await assert.rejects(execute('alice',input,'apply',f.deps),{code:'failed-precondition'});assert.equal(f.docs.get('users/alice').publicKeyPem,oldPem);
});
test('a receipt with matching keys but a foreign user UID is not currently confirmed',async()=>{
  const f=fixture(),input=await f.input();await execute('alice',input,'apply',f.deps);f.docs.get('users/alice').uid='bob';const state=JSON.stringify([...f.docs]);
  assert.equal((await execute('alice',input,'status',f.deps)).current,false);assert.equal(JSON.stringify([...f.docs]),state);
});
test('daily quota refusal performs no partial profile, receipt or budget writes',async()=>{
  const f=fixture(),input=await f.input(),id=createHash('sha256').update('alice').digest('hex')+'_1970-01-01';f.docs.set('commsIdentityBudgets/'+id,{v:1,uid:'alice',day:'1970-01-01',rollovers:5});const state=JSON.stringify([...f.docs]);
  await assert.rejects(execute('alice',input,'apply',f.deps),{code:'resource-exhausted'});assert.equal(JSON.stringify([...f.docs]),state);
});
test('foreign replay, changed candidate, revoked account and invalid RSA keys are rejected',async()=>{
  const f=fixture(),input=await f.input();await execute('alice',input,'apply',f.deps);f.docs.set('users/bob',{uid:'bob'});
  await assert.rejects(execute('bob',input,'status',f.deps),{code:'permission-denied'});await assert.rejects(execute('alice',{...input,publicKeyPem:oldPem},'status',f.deps),{code:'permission-denied'});
  await assert.rejects(execute('alice',{...input,publicKeyPem:'-----BEGIN PUBLIC KEY-----\nYWJjZA==\n-----END PUBLIC KEY-----'},'status',f.deps),{code:'invalid-argument'});
  f.docs.set('accountDeletions/alice',{status:'complete'});await assert.rejects(prepare('alice',{},f.deps),{code:'permission-denied'});for(const mode of ['status','apply','cancel'])await assert.rejects(execute('alice',input,mode,f.deps),{code:'permission-denied'});
});
test('closed rollover callable rejects unauthenticated, private fields and writes without touching the database',async()=>{
  const f=fixture(),input=await f.input();await assert.rejects(applyCommsIdentityRollover.run(input,{}),{code:'unauthenticated'});await assert.rejects(applyCommsIdentityRollover.run({actorUid:'alice',request:{...input,privateKey:'secret'}},{auth:{uid:'alice'}}),{code:'invalid-argument'});await assert.rejects(applyCommsIdentityRollover.run({actorUid:'alice',request:input},{auth:{uid:'alice'}}),{code:'failed-precondition'});
  for(const callable of [prepareCommsIdentityRollover,applyCommsIdentityRollover,getCommsIdentityRolloverStatus,cancelCommsIdentityRollover])assert.deepEqual(callable.__endpoint.secretEnvironmentVariables||[],[]);
});
test('all four identity commands reject a token swap before rate limit, profile reads or writes',async()=>{
  const f=fixture(),input=await f.input(),before=JSON.stringify([...f.docs]);
  for(const [mode,callable]of [['prepare',prepareCommsIdentityRollover],['apply',applyCommsIdentityRollover],['status',getCommsIdentityRolloverStatus],['cancel',cancelCommsIdentityRollover]]){
    const value={actorUid:'alice',request:mode==='prepare'?{}:input};assert.equal(parseCommsIdentityCommand(mode,value).actorUid,'alice');
    await assert.rejects(executeCommsIdentityCall('bob',mode,value,{firestore:{doc:()=>{throw Error('Unexpected database access');}},now:()=>1000}),{code:'permission-denied'});
    await assert.rejects(callable.run(value,{auth:{uid:'bob'}}),{code:'permission-denied'});
    await assert.rejects(executeCommsIdentityCall('alice',mode,value.request,f.deps),{code:'invalid-argument'});
  }assert.equal(JSON.stringify([...f.docs]),before);
});
test('explicit republish of a superseded candidate requires a new nonce and exact current baseline',async()=>{
  const f=fixture(),input=await f.input();await executeCommsIdentityCall('alice','apply',{actorUid:'alice',request:input},f.deps);
  const remotePem=pem();f.docs.get('users/alice').publicKeyPem=remotePem;f.docs.get('publicProfiles/alice').publicKeyPem=remotePem;f.touch();
  const baseline=await executeCommsIdentityCall('alice','prepare',{actorUid:'alice',request:{}},f.deps),next={...input,operationId:'22222222-2222-4222-8222-222222222222',baseline};
  assert.equal((await execute('alice',input,'status',f.deps)).current,false);const before=JSON.stringify([...f.docs]);
  await assert.rejects(execute('alice',{...next,baseline:input.baseline},'apply',f.deps),{code:'aborted'});assert.equal(JSON.stringify([...f.docs]),before);
  const result=await executeCommsIdentityCall('alice','apply',{actorUid:'alice',request:next},f.deps);assert.equal(result.current,true);assert.equal(f.docs.get('users/alice').publicKeyPem,newPem);
  assert.equal(f.docs.get('commsIdentityRollovers/'+input.operationId).digest,createHash('sha256').update(JSON.stringify(parseCommsIdentityRollover(input))).digest('hex'));
  assert.equal([...f.docs].filter(([key])=>key.startsWith('commsIdentityRollovers/')).length,2);assert.equal([...f.docs].find(([key])=>key.startsWith('commsIdentityBudgets/'))[1].rollovers,2);
});
