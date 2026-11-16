'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),{generateKeyPairSync}=require('node:crypto');
const api=require('../lib/mobilePairing'),contract=require('../lib/mobilePairingContract');
const key=()=>{const result=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'});return{kty:result.kty,crv:result.crv,x:result.x,y:result.y};};
const desktop=key(),mobile=key(),sync=key(),id='P'.repeat(24),deviceId='M'.repeat(24);
const create=()=>({v:1,actorUid:'alice',action:'create',pairingId:id,desktopDeviceName:'Synthetic desktop',desktopPublicKeyJwk:structuredClone(desktop)});
function fixture(){
  const docs=new Map([['users/alice',{}]]),state={enabled:true,now:1000000,writes:0,authReads:0,transactionReads:0,failCommit:false,user:{uid:'alice',disabled:false}};let queue=Promise.resolve();
  const ref=path=>({path}),firestore={doc:ref,runTransaction:work=>{const result=queue.then(async()=>{const writes=[],get=async r=>{state.transactionReads++;assert.equal(writes.length,0);return{exists:docs.has(r.path),data:()=>structuredClone(docs.get(r.path))};};const value=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push({r,data,create:true});},set:(r,data)=>writes.push({r,data}),update:(r,data)=>{assert.ok(docs.has(r.path));writes.push({r,data,merge:true});}});if(state.failCommit)throw Error('Synthetic atomic refusal');for(const row of writes){docs.set(row.r.path,row.merge?{...docs.get(row.r.path),...structuredClone(row.data)}:structuredClone(row.data));state.writes++;}return value;});queue=result.catch(()=>{});return result;}};
  const deps={firestore,auth:{getUser:async()=>{state.authReads++;if(!state.user)throw Error('Synthetic absent account');return structuredClone(state.user);}},now:()=>state.now,enabled:()=>state.enabled};
  const run=(command=create(),mode='apply',uid='alice')=>api.executeMobilePairing(uid,command,mode,deps),dump=()=>JSON.stringify([...docs]);
  const accept=()=>({v:1,actorUid:'alice',action:'accept',pairingId:id,creationDigest:api.mobilePairingCommandDigest(create()),expiresAt:docs.get('devicePairings/'+id).expiresAt,mobileDeviceId:deviceId,mobileDeviceName:'Synthetic mobile',mobilePublicKeyJwk:structuredClone(mobile),encryptedHandshake:{iv:'A'.repeat(16),data:'A'.repeat(256)}});
  const trust=()=>({v:1,actorUid:'alice',action:'trust',pairingId:id,acceptanceDigest:docs.get('devicePairings/'+id).acceptanceDigest,desktopPublicKeyJwk:structuredClone(sync)});
  const cancel=()=>({v:1,actorUid:'alice',action:'cancel',pairingId:id,creationDigest:api.mobilePairingCommandDigest(create())});
  const revoke=()=>({v:1,actorUid:'alice',action:'revoke',deviceId});
  return{docs,state,deps,run,dump,create,accept,trust,cancel,revoke};
}
test('pairing contract strips optional public flags, captures input, and rejects private/extra/oversized fields',()=>{
  const input=create();input.desktopPublicKeyJwk={...input.desktopPublicKeyJwk,ext:true,key_ops:[]};const parsed=contract.parsePairingCommand(input);input.desktopPublicKeyJwk.x='Changed';assert.deepEqual(parsed,create());
  for(const patch of[{extra:true},{actorUid:'../bad'},{pairingId:'short'},{desktopDeviceName:''},{desktopDeviceName:'X'.repeat(121)},{desktopDeviceName:'Bad\nlabel'},{desktopPublicKeyJwk:{...desktop,d:'Synthetic private material'}},{desktopPublicKeyJwk:{...desktop,key_ops:['deriveKey']}},{v:2},{action:'replace'}])assert.throws(()=>contract.parsePairingCommand({...create(),...patch}));
});
test('captured actor is checked before Auth or Firestore access for every operation and status',async()=>{
  const f=fixture();await f.run();const accept=f.accept();await f.run(accept);const commands=[create(),accept,f.trust(),f.cancel(),f.revoke()];f.state.authReads=0;f.state.transactionReads=0;
  for(const command of commands)for(const mode of['apply','status'])await assert.rejects(f.run(command,mode,'bob'),{code:'permission-denied'});assert.equal(f.state.authReads,0);assert.equal(f.state.transactionReads,0);
});
test('actual non-curve public points are refused before services',async()=>{
  const f=fixture();await assert.rejects(f.run({...create(),desktopPublicKeyJwk:{kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'A'.repeat(43)}}),{code:'invalid-argument'});assert.equal(f.state.authReads,0);assert.equal(f.state.writes,0);
});
test('unknown status and closed admission never create invitations or daily counters',async()=>{
  const f=fixture(),before=f.dump();assert.equal((await f.run(create(),'status')).status,'unknown');f.state.enabled=false;await assert.rejects(f.run(),{code:'failed-precondition'});assert.equal(f.dump(),before);
});
test('server expiry and quota commit together; same request retries never extend or count twice',async()=>{
  const f=fixture(),first=await f.run(),state=f.dump(),writes=f.state.writes;assert.equal(first.expiresAt,first.createdAt+contract.PAIRING_TTL_MS);assert.equal(first.changed,true);
  f.state.now+=1000;const retry=await f.run();assert.equal(retry.createdAt,first.createdAt);assert.equal(retry.expiresAt,first.expiresAt);assert.equal(retry.changed,false);assert.equal(f.dump(),state);assert.equal(f.state.writes,writes);
  f.state.enabled=false;assert.equal((await f.run()).status,'pending');assert.equal(f.dump(),state);f.state.now=first.expiresAt;assert.equal((await f.run()).status,'expired');assert.equal(f.dump(),state);
});
test('daily creation budget bounds new requests while permitting historical retries and next-day admission',async()=>{
  const f=fixture();for(let index=0;index<contract.PAIRING_DAILY_INVITES;index++)await f.run({...create(),pairingId:'P'.repeat(24)+index});const state=f.dump();await assert.rejects(f.run(),{code:'resource-exhausted'});assert.equal(f.dump(),state);await f.run({...create(),pairingId:'P'.repeat(24)+'0'});assert.equal(f.dump(),state);f.state.now+=86400000;assert.equal((await f.run()).status,'pending');
});
test('same pairing ID cannot replace a key, name, owner or legacy v1 row',async()=>{
  const f=fixture();await f.run();const state=f.dump();for(const patch of[{desktopPublicKeyJwk:sync},{desktopDeviceName:'Synthetic replacement'}])await assert.rejects(f.run({...create(),...patch}),{code:'already-exists'});assert.equal(f.dump(),state);
  for(const mutation of[{ownerUid:'bob'},{version:1},{creationDigest:'a'.repeat(64)},{desktopDeviceName:'Synthetic forged'}]){const g=fixture();await g.run();Object.assign(g.docs.get('devicePairings/'+id),mutation);const before=g.dump();await assert.rejects(g.run());assert.equal(g.dump(),before);}
});
test('acceptance binds exact invitation, device, ciphertext and public key; retries preserve first acceptance',async()=>{
  const f=fixture();await f.run();const command=f.accept(),accepted=await f.run(command),state=f.dump();assert.equal(accepted.status,'accepted');assert.equal(accepted.deviceId,deviceId);assert.equal((await f.run(command)).changed,false);assert.equal(f.dump(),state);
  for(const patch of[{mobileDeviceId:'Q'.repeat(24)},{mobileDeviceName:'Synthetic other'},{mobilePublicKeyJwk:sync},{encryptedHandshake:{iv:'B'.repeat(16),data:'B'.repeat(256)}}])await assert.rejects(f.run({...command,...patch}),{code:'already-exists'});assert.equal(f.dump(),state);
});
test('expired, cancelled, closed, foreign digest and reserved device refuse fresh acceptance',async()=>{
  for(const reason of['expired','cancelled','closed','digest','expiry','reserved']){const f=fixture();await f.run();const command=f.accept();if(reason==='expired')f.state.now=command.expiresAt;if(reason==='cancelled')await f.run(f.cancel());if(reason==='closed')f.state.enabled=false;if(reason==='digest')command.creationDigest='a'.repeat(64);if(reason==='expiry')command.expiresAt++;if(reason==='reserved')f.docs.set('trustedDevices/'+deviceId,{ownerUid:'bob'});const state=f.dump();await assert.rejects(f.run(command));assert.equal(f.dump(),state);}
});
test('trust creates matched keys and permanent device binding atomically; response retry is read-only',async()=>{
  const f=fixture();await f.run();await f.run(f.accept());const command=f.trust(),outcome=await f.run(command),state=f.dump();assert.equal(outcome.status,'active');assert.deepEqual(f.docs.get('trustedDevices/'+deviceId).publicKeyJwk,mobile);assert.deepEqual(f.docs.get('trustedDevices/'+deviceId).desktopPublicKeyJwk,sync);assert.equal(f.docs.get('devicePairings/'+id).status,'trusted');f.state.now+=86400000;f.state.enabled=false;assert.equal((await f.run(command)).status,'active');assert.equal(f.dump(),state);
});
test('trust refuses expired/closed acceptance, conflicting device, changed acceptance and tampered stored payloads',async()=>{
  for(const reason of['expired','closed','reserved','digest','key','cipher']){const f=fixture();await f.run();await f.run(f.accept());const command=f.trust();if(reason==='expired')f.state.now=f.accept().expiresAt;if(reason==='closed')f.state.enabled=false;if(reason==='reserved')f.docs.set('trustedDevices/'+deviceId,{deviceId,ownerUid:'alice',status:'revoked'});if(reason==='digest')command.acceptanceDigest='a'.repeat(64);if(reason==='key')f.docs.get('devicePairings/'+id).mobilePublicKeyJwk=sync;if(reason==='cipher')f.docs.get('devicePairings/'+id).encryptedHandshake.data='B'.repeat(256);const state=f.dump();await assert.rejects(f.run(command));assert.equal(f.dump(),state);}
});
test('revocation stays available with enrollment closed and can never be undone by trust retries',async()=>{
  const f=fixture();await f.run();await f.run(f.accept());const trust=f.trust();await f.run(trust);f.state.enabled=false;assert.equal((await f.run(f.revoke())).status,'revoked');const state=f.dump();assert.equal((await f.run(f.revoke())).changed,false);assert.equal((await f.run(trust)).status,'revoked');assert.equal(f.dump(),state);f.state.enabled=true;await assert.rejects(f.run({...trust,desktopPublicKeyJwk:desktop}));assert.equal(f.dump(),state);
});
test('revocation handles owned legacy IDs without granting new trust, and refuses foreign or missing IDs',async()=>{
  const f=fixture();f.state.enabled=false;f.docs.set('trustedDevices/legacy',{deviceId:'legacy',ownerUid:'alice',status:'active',name:'Synthetic legacy',pairedAt:1});assert.equal((await f.run({...f.revoke(),deviceId:'legacy'})).status,'revoked');f.docs.set('trustedDevices/'+deviceId,{deviceId,ownerUid:'bob',status:'active'});const state=f.dump();await assert.rejects(f.run(f.revoke()),{code:'permission-denied'});await assert.rejects(f.run({...f.revoke(),deviceId:'missing'}),{code:'not-found'});assert.equal((await f.run({...f.revoke(),deviceId:'missing'},'status')).status,'unknown');assert.equal(f.dump(),state);
});
test('missing trusted device after a historical commit is unavailable and is never recreated',async()=>{
  const f=fixture();await f.run();await f.run(f.accept());const trust=f.trust();await f.run(trust);f.docs.delete('trustedDevices/'+deviceId);const state=f.dump();for(const mode of['status','apply'])assert.equal((await f.run(trust,mode)).status,'unavailable');assert.equal(f.dump(),state);
});
test('cancellation serializes before trust and preserves encrypted acceptance; trusted pairs require device revocation',async()=>{
  const f=fixture();await f.run();await f.run(f.accept());const accepted=f.accept(),trust=f.trust();f.state.enabled=false;assert.equal((await f.run(f.cancel())).status,'cancelled');const state=f.dump();assert.equal((await f.run(accepted)).status,'cancelled');assert.equal((await f.run(f.cancel())).changed,false);f.state.enabled=true;await assert.rejects(f.run(trust));assert.equal(f.dump(),state);assert.deepEqual(f.docs.get('devicePairings/'+id).encryptedHandshake,accepted.encryptedHandshake);
  const g=fixture();await g.run();await g.run(g.accept());await g.run(g.trust());await assert.rejects(g.run(g.cancel()),{code:'failed-precondition'});
});
test('account markers, absent/deleting profiles and disabled/missing Auth refuse all actions and status',async()=>{
  for(const reason of['marker','deleting','profile','disabled','auth','uid'])for(const mode of['apply','status']){const f=fixture();if(reason==='marker')f.docs.set('accountDeletions/alice',{});if(reason==='deleting')f.docs.get('users/alice').deletionState='deleting';if(reason==='profile')f.docs.delete('users/alice');if(reason==='disabled')f.state.user.disabled=true;if(reason==='auth')f.state.user=null;if(reason==='uid')f.state.user.uid='bob';const state=f.dump();await assert.rejects(f.run(create(),mode),{code:'permission-denied'});assert.equal(f.dump(),state);}
});
test('failed commits preserve invitation/budget or invitation/device pairs together',async()=>{
  const f=fixture();f.state.failCommit=true;const initial=f.dump();await assert.rejects(f.run());assert.equal(f.dump(),initial);f.state.failCommit=false;await f.run();await f.run(f.accept());const state=f.dump();f.state.failCommit=true;await assert.rejects(f.run(f.trust()));assert.equal(f.dump(),state);
});
test('concurrent repeated requests return one mutation and opposing acceptances cannot replace each other',async()=>{
  const f=fixture();const created=await Promise.all(Array.from({length:4},()=>f.run()));assert.equal(created.filter(row=>row.changed).length,1);const accepted=f.accept(),results=await Promise.allSettled([f.run(accepted),f.run({...accepted,mobilePublicKeyJwk:sync}),f.run(accepted)]);assert.equal(results.filter(row=>row.status==='rejected').length,1);assert.equal(f.docs.get('devicePairings/'+id).acceptanceDigest,api.mobilePairingCommandDigest(accepted));
  const trusted=await Promise.all(Array.from({length:4},()=>f.run(f.trust())));assert.equal(trusted.filter(row=>row.changed).length,1);assert.equal([...f.docs.keys()].filter(key=>key.startsWith('trustedDevices/')).length,1);
});
test('callables are EU, source enrollment is closed and actor mismatch is refused before services',async()=>{
  assert.equal(api.MOBILE_PAIRING_ENABLED,false);for(const endpoint of[api.mutateMobilePairing,api.getMobilePairingMutationStatus]){assert.deepEqual(endpoint.__endpoint.region,['europe-west1']);await assert.rejects(endpoint.run(create(),{}),{code:'unauthenticated'});await assert.rejects(endpoint.run({...create(),actorUid:'bob'},{auth:{uid:'alice'}}),{code:'permission-denied'});}
});
test('inconsistent stored transition receipts and impossible server clock values fail without mutations',async()=>{
  for(const patch of[{status:'trusted'},{acceptanceDigest:'a'.repeat(64)},{trustDigest:'a'.repeat(64)}]){const f=fixture();await f.run();Object.assign(f.docs.get('devicePairings/'+id),patch);const state=f.dump();await assert.rejects(f.run());assert.equal(f.dump(),state);}
  const f=fixture();f.state.now=Number.MAX_SAFE_INTEGER;const initial=f.dump();await assert.rejects(f.run());assert.equal(f.dump(),initial);
  const g=fixture();await g.run();const accept=g.accept();g.state.now--;const state=g.dump();await assert.rejects(g.run(accept));assert.equal(g.dump(),state);
});
test('client-facing confirmation binds the exact command, account, response shape and read-only intent',async()=>{
  const f=fixture(),input=create(),outcome=await f.run(),hash=api.mobilePairingCommandDigest(input);assert.deepEqual(contract.parsePairingOutcome(outcome,input,hash,'apply'),outcome);
  for(const patch of[{actorUid:'bob'},{action:'trust'},{id:'Q'.repeat(24)},{commandDigest:'a'.repeat(64)},{status:'active'},{createdAt:null},{expiresAt:outcome.expiresAt+1},{extra:true}])assert.throws(()=>contract.parsePairingOutcome({...outcome,...patch},input,hash,'apply'));
  assert.throws(()=>contract.parsePairingOutcome(outcome,input,hash,'status'));const current=await f.run(input,'status');assert.deepEqual(contract.parsePairingOutcome(current,input,hash,'status'),current);
});
test('cancellation before a delayed creation reserves the exact ID permanently and never publishes its keys',async()=>{
  const f=fixture();f.state.enabled=false;const cancelled=await f.run(f.cancel());assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.changed,true);const initial=f.dump();f.state.enabled=true;assert.equal((await f.run()).status,'cancelled');assert.equal((await f.run(f.cancel())).changed,false);assert.equal(f.dump(),initial);assert.equal(f.docs.get('devicePairings/'+id).desktopPublicKeyJwk,undefined);assert.equal(f.docs.get('users/alice/mobilePairingBudgets/0').created,1);await assert.rejects(f.run({...create(),desktopPublicKeyJwk:sync}),{code:'already-exists'});assert.equal(f.dump(),initial);
});
