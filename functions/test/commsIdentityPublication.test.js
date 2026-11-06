'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),{createHash,generateKeyPairSync}=require('node:crypto');
const {executeCommsIdentityPublication:execute,publishCommsIdentityKey,COMMS_IDENTITY_PUBLICATION_ENABLED}=require('../lib/commsIdentityPublication');
const {parseCommsIdentityPublication,parseCommsIdentityPublicationOutcome}=require('../lib/commsIdentityPublicationContract');
const pem=(type='rsa',options={modulusLength:2048})=>{const key=generateKeyPairSync(type,options).publicKey;return'-----BEGIN PUBLIC KEY-----\n'+key.export({type:'spki',format:'der'}).toString('base64')+'\n-----END PUBLIC KEY-----';};
const key=pem(),other=pem(),fingerprint=createHash('sha256').update(key).digest('hex'),command=(mode='publish')=>({v:1,actorUid:'alice',publicKeyPem:key,mode});
function fixture(){
  const docs=new Map([['users/alice',{uid:'alice',usage:{synthetic:1},subscription:{synthetic:true}}]]),state={enabled:true,authReads:0,transactions:0,writes:0,failCommit:false,user:{uid:'alice',disabled:false,displayName:'Synthetic server Alice',email:'synthetic@example.invalid'}};
  const ref=path=>({path});const firestore={doc:ref,runTransaction:async work=>{state.transactions++;const writes=[];const get=async r=>{assert.equal(writes.length,0,'All reads precede writes');return{exists:docs.has(r.path),data:()=>structuredClone(docs.get(r.path))};};const result=await work({getAll:(...refs)=>Promise.all(refs.map(get)),set:(r,value,options)=>{writes.push({r,value,merge:options?.merge===true});}});if(state.failCommit)throw Error('Synthetic commit denied');for(const row of writes){docs.set(row.r.path,row.merge?{...docs.get(row.r.path),...structuredClone(row.value)}:structuredClone(row.value));state.writes++;}return result;}};
  const deps={firestore,auth:{getUser:async uid=>{state.authReads++;assert.equal(uid,'alice');if(!state.user)throw Error('Synthetic missing Auth user');return structuredClone(state.user);}},enabled:()=>state.enabled};
  return{docs,state,deps,dump:()=>JSON.stringify([...docs]),call:(value=command())=>execute('alice',value,deps)};
}
test('publication contract captures only explicit actor, public key and check/publish intent',()=>{
  const input=command(),copy=parseCommsIdentityPublication(input);input.actorUid='bob';assert.equal(copy.actorUid,'alice');
  for(const value of [null,[],{...command(),uid:'bob'},{...command(),privateKey:'Synthetic secret'},{...command(),displayName:'Forged'},{...command(),emailHash:'Forged'},{...command(),mode:1},{...command(),mode:{toString:()=> 'publish'}},{...command(),publicKeyPem:key+'\n'}])assert.throws(()=>parseCommsIdentityPublication(value));
  const confirmed={v:1,uid:'alice',fingerprint,status:'current',changed:false};assert.deepEqual(parseCommsIdentityPublicationOutcome(confirmed,'alice',fingerprint),confirmed);
  for(const value of [{...confirmed,uid:'bob'},{...confirmed,fingerprint:'b'.repeat(64)},{...confirmed,extra:true},{...confirmed,status:{toString:()=> 'current'}},{...confirmed,status:'unpublished',changed:true}])assert.throws(()=>parseCommsIdentityPublicationOutcome(value,'alice',fingerprint));
});
test('publication binds authenticated actor before Auth lookup or Firestore and never accepts caller-owned metadata',async()=>{
  const f=fixture();await assert.rejects(execute('alice',{...command(),actorUid:'bob'},f.deps),{code:'permission-denied'});await assert.rejects(execute('',command(),f.deps),{code:'unauthenticated'});
  await assert.rejects(f.call({...command(),displayName:'Synthetic attacker label'}),{code:'invalid-argument'});assert.equal(f.state.authReads,0);assert.equal(f.state.transactions,0);assert.equal(f.state.writes,0);
});
test('server key validation rejects private keys, noncanonical SPKI, EC, small RSA and alternate exponents',async()=>{
  const f=fixture();for(const invalid of ['Synthetic public key',key+'\n',pem('ec',{namedCurve:'prime256v1'}),pem('rsa',{modulusLength:1024}),pem('rsa',{modulusLength:2048,publicExponent:3})])await assert.rejects(f.call({...command(),publicKeyPem:invalid}),{code:'invalid-argument'});
  assert.equal(f.state.authReads,0);assert.equal(f.state.writes,0);
});
test('initial publication writes a matched pair atomically with Auth-derived bounded metadata and preserves existing fields',async()=>{
  const f=fixture();f.docs.set('publicProfiles/alice',{uid:'alice',syntheticRetained:{v:1}});f.state.user.displayName='S'.repeat(200);const result=await f.call();assert.deepEqual(result,{v:1,uid:'alice',fingerprint,status:'current',changed:true});assert.equal(f.state.writes,2);
  for(const path of ['users/alice','publicProfiles/alice']){assert.equal(f.docs.get(path).publicKeyPem,key);assert.equal(f.docs.get(path).uid,'alice');assert.ok(f.docs.get(path).publicKeyUpdatedAt);}
  assert.deepEqual(f.docs.get('users/alice').usage,{synthetic:1});assert.deepEqual(f.docs.get('users/alice').subscription,{synthetic:true});assert.deepEqual(f.docs.get('publicProfiles/alice').syntheticRetained,{v:1});
  assert.equal(f.docs.get('publicProfiles/alice').displayName,'S'.repeat(120));assert.equal(f.docs.get('publicProfiles/alice').emailHash,createHash('sha256').update(f.state.user.email).digest('hex'));assert.equal(JSON.stringify([...f.docs]).includes(f.state.user.email),false);
});
test('same-key retry after a lost reply confirms the durable pair without more writes or advancing timestamps',async()=>{
  const f=fixture();await f.call();const state=f.dump(),writes=f.state.writes;assert.deepEqual(await f.call(),{v:1,uid:'alice',fingerprint,status:'current',changed:false});assert.equal(f.dump(),state);assert.equal(f.state.writes,writes);
  assert.deepEqual(await f.call(command('check')),{v:1,uid:'alice',fingerprint,status:'current',changed:false});assert.equal(f.dump(),state);
});
test('check mode and closed server admission never initialize, repair or refresh a pair',async()=>{
  const f=fixture(),initial=f.dump();assert.equal((await f.call(command('check'))).status,'unpublished');assert.equal(f.dump(),initial);
  f.state.enabled=false;assert.equal((await f.call()).status,'unpublished');assert.equal(f.dump(),initial);assert.equal(f.state.writes,0);
  f.state.enabled=true;await f.call();f.state.enabled=false;f.state.user.displayName='Synthetic changed label';const current=f.dump(),writes=f.state.writes;
  assert.deepEqual(await f.call(),{v:1,uid:'alice',fingerprint,status:'current',changed:false});assert.equal(f.dump(),current);assert.equal(f.state.writes,writes);
});
test('a closed-gate confirmation of the same key cannot repair a missing profile',async()=>{
  for(const path of ['users/alice','publicProfiles/alice']){const f=fixture();await f.call();f.docs.delete(path);f.state.enabled=false;const state=f.dump();assert.equal((await f.call()).status,'unpublished');assert.equal(f.dump(),state);f.state.enabled=true;assert.equal((await f.call()).status,'current');for(const target of ['users/alice','publicProfiles/alice'])assert.equal(f.docs.get(target).publicKeyPem,key);}
});
test('a published different key, inconsistent UID or mismatched pair cannot be replaced even by a same-account bootstrap',async()=>{
  for(const path of ['users/alice','publicProfiles/alice'])for(const mutation of ['key','uid']){const f=fixture();await f.call();f.docs.set(path,{...f.docs.get(path),...(mutation==='key'?{publicKeyPem:other}:{uid:'bob'})});const state=f.dump();
    for(const mode of ['check','publish'])await assert.rejects(f.call(command(mode)),{code:mutation==='key'?'already-exists':'permission-denied'});assert.equal(f.dump(),state);
  }
});
test('metadata refresh uses current Auth data, preserves the paired key and does not change key publication timestamps',async()=>{
  const f=fixture();await f.call();const stamp=JSON.stringify(f.docs.get('publicProfiles/alice').publicKeyUpdatedAt),writes=f.state.writes;f.state.user.displayName='Synthetic renamed';f.state.user.email='Other@EXAMPLE.INVALID';
  assert.equal((await f.call()).changed,true);assert.equal(f.state.writes,writes+1);assert.equal(f.docs.get('publicProfiles/alice').displayName,'Synthetic renamed');assert.equal(f.docs.get('publicProfiles/alice').emailHash,createHash('sha256').update('other@example.invalid').digest('hex'));assert.equal(JSON.stringify(f.docs.get('publicProfiles/alice').publicKeyUpdatedAt),stamp);assert.equal(f.docs.get('users/alice').publicKeyPem,key);assert.equal(f.docs.get('publicProfiles/alice').publicKeyPem,key);
});
test('permanent deletion, deleting profile, disabled or absent Auth users refuse initialization and confirmation without resurrection',async()=>{
  for(const mode of ['check','publish'])for(const condition of ['marker','deleting','disabled','missing','foreign-auth']){const f=fixture();if(condition==='marker'){f.docs.delete('users/alice');f.docs.set('accountDeletions/alice',{status:'complete'});}if(condition==='deleting')f.docs.get('users/alice').deletionState='deleting';if(condition==='disabled')f.state.user.disabled=true;if(condition==='missing')f.state.user=null;if(condition==='foreign-auth')f.state.user.uid='bob';const state=f.dump();await assert.rejects(f.call(command(mode)),{code:'permission-denied'});assert.equal(f.dump(),state);assert.equal(f.state.writes,0);}
});
test('a rejected atomic commit leaves both profile documents unmodified',async()=>{
  const f=fixture(),state=f.dump();f.state.failCommit=true;await assert.rejects(f.call());assert.equal(f.dump(),state);assert.equal(f.state.writes,0);
});
test('callable transport is EU, keeps source admission closed and refuses unauthenticated or foreign commands before accessing services',async()=>{
  assert.equal(COMMS_IDENTITY_PUBLICATION_ENABLED,false);assert.deepEqual(publishCommsIdentityKey.__endpoint.region,['europe-west1']);
  await assert.rejects(publishCommsIdentityKey.run(command(),{}),{code:'unauthenticated'});await assert.rejects(publishCommsIdentityKey.run({...command(),actorUid:'bob'},{auth:{uid:'alice'}}),{code:'permission-denied'});
});
