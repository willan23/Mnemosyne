'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{generateKeyPairSync,createHash}=require('node:crypto');
const {executeCommsRecipientLookup:lookup,executeCommsContact:contact,executeCommsContactResponse:respond,executeCommsContactCall:call,commsContactPairId,createCommsContactRequest,respondCommsContactRequest,lookupCommsRecipient,getCommsContactRequestStatus,cancelCommsContactRequest}=require('../lib/commsContacts');
const {parseCommsRecipientLookup,parseCommsContactRequest,parseCommsContactResponse,parseCommsContactCommand,commsContactRequestBytes}=require('../lib/commsContactContract');
const hash=value=>createHash('sha256').update(value).digest('hex');
const pem=()=>`-----BEGIN PUBLIC KEY-----\n${generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64')}\n-----END PUBLIC KEY-----`;
const pems={alice:pem(),bob:pem(),carol:pem()},id='11111111-1111-4111-8111-111111111111';
function fixture(){
  const docs=new Map(),users=new Map(Object.keys(pems).map(uid=>[uid,{uid,disabled:false,email:uid+'@example.invalid',emailVerified:true}])),emailCalls=[];
  for(const [uid,publicKeyPem]of Object.entries(pems)){docs.set('users/'+uid,{uid,publicKeyPem});docs.set('publicProfiles/'+uid,{uid,publicKeyPem,displayName:'Synthetic '+uid,emailHash:'private-metadata-not-returned'});}
  const snap=p=>({exists:docs.has(p),data:()=>structuredClone(docs.get(p))});const ref=p=>({path:p,get:async()=>snap(p)});let queue=Promise.resolve();
  function query(collection,filters=[],maximum=Infinity){return{collection,filters,maximum,where:(field,op,value)=>{assert.ok(['==','in'].includes(op));return query(collection,[...filters,[field,value,op]],maximum);},limit:value=>query(collection,filters,value)};}
  const db={doc:ref,collection:name=>query(name),runTransaction:work=>{const pending=queue.then(async()=>{const writes=[],get=async r=>{assert.equal(writes.length,0);if(r.collection){const rows=[...docs].filter(([key,value])=>key.startsWith(r.collection+'/')&&r.filters.every(([field,expected,op])=>op==='in'?expected.includes(value[field]):value[field]===expected)).slice(0,r.maximum).map(([key])=>({id:key.split('/').pop(),...snap(key)}));return{docs:rows,size:rows.length};}return snap(r.path);};const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push({r,data});},set:(r,data)=>writes.push({r,data}),update:(r,data)=>writes.push({r,data,merge:true})});for(const{r,data,merge}of writes)docs.set(r.path,merge?{...docs.get(r.path),...data}:data);return result;});queue=pending.catch(()=>{});return pending;}};
  const deps={firestore:db,now:()=>1000,auth:{getUser:async uid=>{if(!users.has(uid))throw Error();return users.get(uid);},getUserByEmail:async email=>{emailCalls.push(email);if(email!=='bob@example.invalid')throw Error();return users.get('bob');}}};
  const input={requestId:id,recipientUid:'bob',recipientFingerprint:hash(pems.bob)};return{docs,users,deps,input,emailCalls};
}
test('contact contracts strictly reject extra authority, secrets, malformed addresses and IDs',()=>{
  assert.deepEqual(parseCommsRecipientLookup({lookup:' BOB@example.invalid '}),{lookup:'bob@example.invalid'});
  for(const value of [{lookup:'x@y'},{lookup:'alice',uid:'bob'},{lookup:'a/b'},null])assert.throws(()=>parseCommsRecipientLookup(value));
  const f=fixture();assert.throws(()=>parseCommsContactRequest({...f.input,fromUid:'carol'}));assert.throws(()=>parseCommsContactRequest({...f.input,privateKey:'secret'}));assert.throws(()=>parseCommsContactResponse({requestId:id,status:'pending'}));
});
test('email/UID discovery uses point profiles with exact Auth binding and returns only public recipient fields',async()=>{
  const f=fixture();const byEmail=await lookup('alice',{lookup:' BOB@example.invalid '},f.deps),byUid=await lookup('alice',{lookup:'bob'},f.deps);assert.deepEqual(byEmail,byUid);assert.deepEqual(f.emailCalls,['bob@example.invalid']);assert.deepEqual(Object.keys(byUid).sort(),['displayName','fingerprint','publicKeyPem','uid']);assert.equal(byUid.fingerprint,hash(pems.bob));assert.equal(f.docs.size,6);
});
test('email discovery rejects unverified, absent or nonboolean verification and an inconsistent Auth address without writing',async()=>{
  for(const patch of [{emailVerified:false},{emailVerified:undefined},{emailVerified:'true'},{emailVerified:1},{email:null},{email:'other@example.invalid'}]){const f=fixture();Object.assign(f.users.get('bob'),patch);const before=JSON.stringify([...f.docs]);await assert.rejects(lookup('alice',{lookup:'bob@example.invalid'},f.deps),{code:'failed-precondition'});assert.equal(JSON.stringify([...f.docs]),before);}
});
test('email discovery rechecks the UID record after email lookup while explicit UID discovery remains available without an email claim',async()=>{
  for(const patch of [{emailVerified:false},{email:'changed@example.invalid'},{disabled:true}]){const f=fixture(),original=f.deps.auth.getUser;f.deps.auth.getUserByEmail=async()=>structuredClone(f.users.get('bob'));f.deps.auth.getUser=async uid=>{if(uid==='bob')Object.assign(f.users.get(uid),patch);return original(uid);};const before=JSON.stringify([...f.docs]);await assert.rejects(lookup('alice',{lookup:'bob@example.invalid'},f.deps));assert.equal(JSON.stringify([...f.docs]),before);}
  const f=fixture();f.users.get('bob').emailVerified=false;assert.equal((await lookup('alice',{lookup:'bob'},f.deps)).uid,'bob');
});
test('self, disabled/missing accounts, deletion markers, mismatched profiles and invalid RSA never resolve',async()=>{
  for(const mode of ['self','disabled','caller-disabled','missing','marker','uid','key','rsa']){const f=fixture();let target='bob';if(mode==='self')target='alice';if(mode==='disabled')f.users.get('bob').disabled=true;if(mode==='caller-disabled')f.users.get('alice').disabled=true;if(mode==='missing')f.users.delete('bob');if(mode==='marker')f.docs.set('accountDeletions/bob',{status:'complete'});if(mode==='uid')f.docs.get('publicProfiles/bob').uid='carol';if(mode==='key')f.docs.get('users/bob').publicKeyPem=pems.carol;if(mode==='rsa'){f.docs.get('users/bob').publicKeyPem='invalid';f.docs.get('publicProfiles/bob').publicKeyPem='invalid';}await assert.rejects(lookup('alice',{lookup:target},f.deps));}
});
test('same-ID replay charges once and opposing pair requests cannot duplicate a pending/accepted contact',async()=>{
  const f=fixture(),results=await Promise.all(Array.from({length:4},()=>contact('alice',f.input,'create',f.deps)));for(const row of results)assert.deepEqual(row,results[0]);const budget=[...f.docs.values()].find(row=>row.requests!==undefined);assert.equal(budget.requests,1);assert.equal(f.docs.get('commsContactPairs/'+commsContactPairId('alice','bob')).requestId,id);
  await assert.rejects(contact('bob',{requestId:'22222222-2222-4222-8222-222222222222',recipientUid:'alice',recipientFingerprint:hash(pems.alice)},'create',f.deps),{code:'already-exists'});
  const accepted=await respond('bob',{requestId:id,status:'accepted'},f.deps);assert.deepEqual(await respond('bob',{requestId:id,status:'accepted'},f.deps),accepted);assert.equal((await contact('alice',f.input,'status',f.deps)).status,'accepted');await assert.rejects(respond('bob',{requestId:id,status:'rejected'},f.deps));
});
test('cancel before create is terminal and budgeted; cancelling after acceptance preserves the accepted contact',async()=>{
  const f=fixture();assert.equal((await contact('alice',f.input,'status',f.deps)).status,'unknown');const result=await contact('alice',f.input,'cancel',f.deps);assert.equal(result.status,'cancelled');await assert.rejects(contact('alice',f.input,'create',f.deps));assert.deepEqual(await contact('alice',f.input,'cancel',f.deps),result);assert.equal([...f.docs.values()].find(row=>row.requests!==undefined).requests,1);
  const g=fixture();await contact('alice',g.input,'create',g.deps);await respond('bob',{requestId:id,status:'accepted'},g.deps);assert.equal((await contact('alice',g.input,'cancel',g.deps)).status,'accepted');
});
test('pending cancellation releases the pair and permits a fresh request without changing old receipts',async()=>{
  const f=fixture();await contact('alice',f.input,'create',f.deps);await contact('alice',f.input,'cancel',f.deps);const prior=JSON.stringify(f.docs.get('friendRequests/'+id));const next={...f.input,requestId:'22222222-2222-4222-8222-222222222222'};assert.equal((await contact('alice',next,'create',f.deps)).status,'pending');assert.equal(JSON.stringify(f.docs.get('friendRequests/'+id)),prior);
});
test('budget, stale recipient key, foreign replay and revocation fail without partial request/pair writes',async()=>{
  for(const mode of ['budget','stale','deleted']){const f=fixture();if(mode==='budget')f.docs.set('commsContactBudgets/'+hash('alice')+'_1970-01-01',{v:1,uid:'alice',day:'1970-01-01',requests:20});if(mode==='stale')f.input.recipientFingerprint=hash(pems.carol);if(mode==='deleted')f.docs.set('accountDeletions/bob',{status:'deleting'});const before=JSON.stringify([...f.docs]);await assert.rejects(contact('alice',f.input,'create',f.deps));assert.equal(JSON.stringify([...f.docs]),before);}
  const f=fixture();await contact('alice',f.input,'create',f.deps);await assert.rejects(contact('carol',f.input,'status',f.deps));await assert.rejects(respond('alice',{requestId:id,status:'accepted'},f.deps));
});
test('only the receiver may respond to a legacy pending request and duplicate response is idempotent',async()=>{
  const f=fixture();f.docs.set('friendRequests/legacy',{fromUid:'alice',toUid:'bob',status:'pending',fromLabel:'Synthetic',toLabel:'Synthetic',createdAt:1,updatedAt:1});await assert.rejects(respond('carol',{requestId:'legacy',status:'accepted'},f.deps));const result=await respond('bob',{requestId:'legacy',status:'rejected'},f.deps);assert.deepEqual(await respond('bob',{requestId:'legacy',status:'rejected'},f.deps),result);
});
test('closed mutation callables reject before database/provider access and use no secrets',async()=>{
  const f=fixture(),wire={actorUid:'alice',request:f.input};await assert.rejects(createCommsContactRequest.run(wire,{}),{code:'unauthenticated'});await assert.rejects(createCommsContactRequest.run(wire,{auth:{uid:'alice'}}),{code:'failed-precondition'});await assert.rejects(respondCommsContactRequest.run({actorUid:'bob',request:{requestId:id,status:'accepted'}},{auth:{uid:'bob'}}),{code:'failed-precondition'});assert.deepEqual(createCommsContactRequest.__endpoint.secretEnvironmentVariables||[],[]);
});
test('legacy active contacts prevent new duplicates and a capped history refuses incomplete discovery',async()=>{
  const f=fixture();f.docs.set('friendRequests/legacy',{fromUid:'bob',toUid:'alice',status:'accepted'});const before=JSON.stringify([...f.docs]);await assert.rejects(contact('alice',f.input,'create',f.deps),{code:'already-exists'});assert.equal(JSON.stringify([...f.docs]),before);
  const g=fixture();for(let i=0;i<51;i++)g.docs.set('friendRequests/legacy-'+i,{fromUid:'alice',toUid:'bob',status:'pending'});await assert.rejects(contact('alice',g.input,'create',g.deps));assert.equal(g.docs.has('friendRequests/'+id),false);
});
test('terminal legacy history without a pair is filtered before the cap and permits a fresh invitation',async()=>{
  const f=fixture();for(let i=0;i<100;i++)f.docs.set('friendRequests/terminal-'+i,{fromUid:'bob',toUid:'alice',status:'cancelled'});
  assert.equal((await contact('alice',f.input,'create',f.deps)).status,'pending');assert.equal(f.docs.get('friendRequests/terminal-99').status,'cancelled');
});
test('all five contact commands reject a swapped token or unbound/extra authority before Auth/DB/rate',async()=>{
  const f=fixture();let authReads=0;f.deps.auth.getUser=async()=>{authReads++;throw Error('Should not reach Auth');};
  const modes={lookup:lookupCommsRecipient,create:createCommsContactRequest,status:getCommsContactRequestStatus,cancel:cancelCommsContactRequest,respond:respondCommsContactRequest};
  for(const [mode,callable]of Object.entries(modes)){
    const payload=mode==='lookup'?{lookup:'bob'}:mode==='respond'?{requestId:id,status:'accepted'}:f.input,wire={actorUid:'alice',request:payload};
    await assert.rejects(call('carol',wire,mode,f.deps),{code:'permission-denied'});await assert.rejects(callable.run(wire,{auth:{uid:'carol'}}),{code:'permission-denied'});
    for(const invalid of [payload,{...wire,uid:'carol'},{...wire,actorUid:'bad/path'}])await assert.rejects(call('alice',invalid,mode,f.deps),{code:'invalid-argument'});
  }assert.equal(authReads,0);assert.equal(f.docs.has('friendRequests/'+id),false);
});
test('bound transport preserves the durable request digest, recovery ID and original encrypted-journal payload',async()=>{
  const f=fixture(),wire={actorUid:'alice',request:f.input};const digest=hash(JSON.stringify({requestId:id,recipientUid:'bob',recipientFingerprint:f.input.recipientFingerprint}));
  assert.equal(hash(commsContactRequestBytes(f.input)),digest);const result=await call('alice',wire,'create',f.deps);assert.equal(result.digest,digest);const before=JSON.stringify([...f.docs]);
  assert.deepEqual(await call('alice',wire,'status',f.deps),result);assert.deepEqual(await call('alice',wire,'create',f.deps),result);assert.equal(JSON.stringify([...f.docs]),before);
  assert.deepEqual(parseCommsContactCommand(wire,'create'),wire);assert.equal(f.docs.get('friendRequests/'+id).fromUid,'alice');
});
test('transport clones the captured actor and request before an Auth await can mutate the caller object',async()=>{
  const f=fixture(),wire={actorUid:'alice',request:{...f.input}},original=f.deps.auth.getUser;f.deps.auth.getUser=async uid=>{wire.actorUid='carol';wire.request.recipientUid='carol';return original(uid);};
  const result=await call('alice',wire,'create',f.deps);assert.equal(result.status,'pending');const data=f.docs.get('friendRequests/'+id);assert.equal(data.fromUid,'alice');assert.equal(data.toUid,'bob');
});
test('permanent peer deletion terminates status/cancel after Auth and profiles disappear without recreating references',async()=>{
  const f=fixture();f.docs.set('accountDeletions/bob',{status:'complete'});f.users.delete('bob');f.docs.delete('users/bob');f.docs.delete('publicProfiles/bob');const before=JSON.stringify([...f.docs]);
  let peerAuthReads=0;const original=f.deps.auth.getUser;f.deps.auth.getUser=async uid=>{if(uid==='bob')peerAuthReads++;return original(uid);};
  for(const mode of ['status','cancel']){const result=await call('alice',{actorUid:'alice',request:f.input},mode,f.deps);assert.equal(result.status,'revoked');assert.equal(result.createdAt,null);assert.equal(result.updatedAt,null);assert.equal(result.digest,hash(commsContactRequestBytes(f.input)));}
  assert.equal(peerAuthReads,0);assert.equal(JSON.stringify([...f.docs]),before);await assert.rejects(contact('alice',f.input,'create',f.deps),{code:'permission-denied'});assert.equal(JSON.stringify([...f.docs]),before);
});
test('owned old receipts project revoked with original dates while purged receipts return null dates',async()=>{
  const f=fixture(),pending=await contact('alice',f.input,'create',f.deps);f.docs.set('accountDeletions/bob',{status:'deleting'});const before=JSON.stringify([...f.docs]);
  const result=await contact('alice',f.input,'status',f.deps);assert.deepEqual(result,{...pending,status:'revoked'});assert.deepEqual(await contact('alice',f.input,'cancel',f.deps),result);assert.equal(JSON.stringify([...f.docs]),before);
  f.docs.delete('friendRequests/'+id);f.docs.delete('commsContactPairs/'+commsContactPairId('alice','bob'));const purged=JSON.stringify([...f.docs]);assert.equal((await contact('alice',f.input,'cancel',f.deps)).createdAt,null);assert.equal(JSON.stringify([...f.docs]),purged);
});
test('a deleting profile is definitive but missing/disabled Auth or missing profile without a marker cannot discard an intent',async()=>{
  const f=fixture();f.docs.get('users/bob').deletionState='deleting';assert.equal((await contact('alice',f.input,'status',f.deps)).status,'revoked');
  for(const kind of ['profile','auth','disabled','outage','database']){const g=fixture(),before=()=>JSON.stringify([...g.docs]);if(kind==='profile')g.docs.delete('users/bob');if(kind==='auth')g.users.delete('bob');if(kind==='disabled')g.users.get('bob').disabled=true;
    if(kind==='outage'){const original=g.deps.auth.getUser;g.deps.auth.getUser=async uid=>{if(uid==='bob')throw Error('Synthetic transient outage');return original(uid);};}
    if(kind==='database')g.deps.firestore.runTransaction=async()=>{throw Error('Synthetic database outage');};const snapshot=before();await assert.rejects(contact('alice',g.input,'status',g.deps));assert.equal(before(),snapshot);
  }
});
test('peer deletion arriving during failed or successful Auth is reread and never admits a new request',async()=>{
  for(const failAuth of [true,false]){const f=fixture(),original=f.deps.auth.getUser;f.deps.auth.getUser=async uid=>{if(uid==='bob'){f.docs.set('accountDeletions/bob',{status:'complete'});if(failAuth)throw Error('Synthetic Auth disappearance');}return original(uid);};
    assert.equal((await contact('alice',f.input,'status',f.deps)).status,'revoked');assert.equal(f.docs.has('friendRequests/'+id),false);assert.equal(f.docs.has('commsContactPairs/'+commsContactPairId('alice','bob')),false);
  }
});
test('revocation never masks a foreign/corrupt nonce binding or the caller permanent marker',async()=>{
  const f=fixture();await contact('alice',f.input,'create',f.deps);f.docs.set('accountDeletions/bob',{status:'complete'});f.docs.get('friendRequests/'+id).fromUid='carol';await assert.rejects(contact('alice',f.input,'status',f.deps),{code:'permission-denied'});
  f.docs.get('friendRequests/'+id).fromUid='alice';await assert.rejects(contact('alice',{...f.input,recipientFingerprint:hash(pems.carol)},'status',f.deps),{code:'permission-denied'});
  f.docs.set('accountDeletions/alice',{status:'complete'});await assert.rejects(contact('alice',f.input,'cancel',f.deps),{code:'permission-denied'});
});
