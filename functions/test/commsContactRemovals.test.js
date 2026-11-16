'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash,generateKeyPairSync}=require('node:crypto');
const {executeCommsContactRemoval:remove,beginCommsContactRemoval}=require('../lib/commsContactRemovals');
const contacts=require('../lib/commsContacts'),{executeCommsList}=require('../lib/commsLists'),contract=require('../lib/commsContactRemovalContract');
const {compareCommsDocumentIds}=require('../lib/commsListContract');
const id='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
const pem=`-----BEGIN PUBLIC KEY-----\n${generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64')}\n-----END PUBLIC KEY-----`,hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(count=61){
  const docs=new Map(),users=new Map(['alice','bob','carol'].map(uid=>[uid,{uid,disabled:false}])),queries=[];
  for(const uid of users.keys()){docs.set('users/'+uid,{uid,publicKeyPem:pem});docs.set('publicProfiles/'+uid,{uid,displayName:'Synthetic '+uid,publicKeyPem:pem});}
  for(let i=0;i<count;i++)docs.set('friendRequests/'+String(i).padStart(3,'0'),{fromUid:i%2?'bob':'alice',toUid:i%2?'alice':'bob',status:i===0||i%3?'accepted':'pending',createdAt:1,updatedAt:2,extra:'preserved'});
  docs.set('friendRequests/other',{fromUid:'bob',toUid:'carol',status:'accepted',createdAt:1,updatedAt:2});docs.set('transmissions/keep',{senderId:'alice',recipientId:'bob',timestamp:1,status:'sent',encryptedData:Buffer.alloc(256).toString('base64')});
  const ref=path=>({path,id:path.split('/').pop(),get:async()=>snap(path)}),snap=path=>({id:path.split('/').pop(),ref:ref(path),exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
  const query=(name,state={filters:[]})=>({name,state,where:(field,op,value)=>query(name,{...state,filters:[...state.filters,{field,op,value}]}),orderBy:()=>query(name,state),limit:n=>query(name,{...state,limit:n}),select:()=>query(name,state),startAfter:after=>query(name,{...state,after})});
  let queue=Promise.resolve(),onAuth=()=>{};
  const db={doc:ref,collection:query,runTransaction:work=>{const run=queue.then(async()=>{const writes=[];const get=async r=>{assert.equal(writes.length,0);if(r.path)return snap(r.path);queries.push(r);const rows=[...docs].filter(([p,d])=>p.startsWith(r.name+'/')&&r.state.filters.every(f=>f.op==='in'?f.value.includes(d[f.field]):d[f.field]===f.value)&&(!r.state.after||compareCommsDocumentIds(p.split('/').pop(),r.state.after)>0)).sort(([a],[b])=>compareCommsDocumentIds(a,b)).slice(0,r.state.limit).map(([p])=>snap(p));return{docs:rows,size:rows.length};};const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push({r,data});},set:(r,data)=>writes.push({r,data}),update:(r,data)=>{assert.equal(docs.has(r.path),true);writes.push({r,data,merge:true});}});for(const {r,data,merge}of writes)docs.set(r.path,merge?{...docs.get(r.path),...data}:data);return result;});queue=run.catch(()=>{});return run;}};
  const deps={firestore:db,now:()=>1000,auth:{getUser:async uid=>{onAuth(uid);if(!users.has(uid)){const e=Error();e.code='auth/user-not-found';throw e;}return users.get(uid);},getUserByEmail:async()=>users.get('bob')}};
  const input={requestId:id,actorUid:'alice',peerUid:'bob',anchorId:'000',anchorUpdatedAt:2};return{docs,users,queries,deps,input,onAuth:fn=>onAuth=fn,call:(mode='begin',value=input,uid='alice')=>remove(uid,value,mode,deps)};
}
test('removal has a strict immutable request and closed admission fails before Auth/database access',async()=>{
  const f=fixture();for(const value of[{...f.input,uid:'carol'},{...f.input,requestId:'invalid'},{...f.input,anchorId:'bad/path'},{...f.input,anchorUpdatedAt:0}])await assert.rejects(f.call('begin',value),{code:'invalid-argument'});
  assert.equal(f.queries.length,0);await assert.rejects(beginCommsContactRemoval.run(f.input,{auth:{uid:'alice'}}),{code:'failed-precondition'});assert.deepEqual(beginCommsContactRemoval.__endpoint.secretEnvironmentVariables||[],[]);
  await assert.rejects(beginCommsContactRemoval.run(f.input,{auth:{uid:'carol'}}),{code:'permission-denied'});await assert.rejects(f.call('cancel',f.input,'carol'),{code:'permission-denied'});assert.equal(f.docs.has('commsContactRemovals/'+id),false);
});
test('bounded removal drains both directions and pending duplicates, retains messages/extras, and retries terminal receipts safely',async()=>{
  const f=fixture(),other=JSON.stringify(f.docs.get('friendRequests/other')),transmission=JSON.stringify(f.docs.get('transmissions/keep'));
  assert.equal((await f.call('status')).status,'unknown');await assert.rejects(f.call('advance'));
  const first=await f.call();assert.equal(first.status,'pending');assert.equal(first.removedCount,25);assert.deepEqual(await f.call(),first);
  assert.equal((await executeCommsList('alice',{uid:'alice',kind:'contact-directory',after:null},f.deps)).rows.length,0);
  assert.equal((await f.call('advance')).removedCount,50);const done=await f.call('advance');assert.equal(done.status,'complete');assert.equal(done.removedCount,61);
  const before=JSON.stringify([...f.docs]);assert.deepEqual(await f.call('advance'),done);assert.equal(JSON.stringify([...f.docs]),before);
  assert.equal(JSON.stringify(f.docs.get('friendRequests/other')),other);assert.equal(JSON.stringify(f.docs.get('transmissions/keep')),transmission);
  assert.ok([...f.docs].filter(([p])=>/^friendRequests\/\d+$/.test(p)).every(([,row])=>row.status==='cancelled'&&row.extra==='preserved'));
  assert.ok(f.queries.every(query=>query.state.limit<=26));assert.equal(f.docs.get('commsContactPairs/'+contacts.commsContactPairId('alice','bob')).removalRequestId,null);
});
test('the pair lock blocks a competing nonce, new invitation and legacy acceptance until continuation completes',async()=>{
  const f=fixture();await f.call();const request={requestId:otherId,recipientUid:'bob',recipientFingerprint:hash(pem)};
  await assert.rejects(contacts.executeCommsContact('alice',request,'create',f.deps),{code:'aborted'});
  await assert.rejects(f.call('begin',{...f.input,requestId:otherId}),{code:'already-exists'});
  const pending=[...f.docs].find(([p,r])=>p.startsWith('friendRequests/')&&r.fromUid==='bob'&&r.toUid==='alice'&&r.status==='pending');assert.ok(pending);
  await assert.rejects(contacts.executeCommsContactResponse('alice',{requestId:pending[0].split('/')[1],status:'accepted'},f.deps),{code:'aborted'});
});
test('a completed nonce cannot cancel a newly admitted relationship and terminal history no longer blocks new invitations',async()=>{
  const f=fixture(1);const done=await f.call(),request={requestId:otherId,recipientUid:'bob',recipientFingerprint:hash(pem)};
  for(let i=0;i<100;i++)f.docs.set('friendRequests/terminal'+i,{fromUid:'bob',toUid:'alice',status:'cancelled'});
  assert.equal((await contacts.executeCommsContact('alice',request,'create',f.deps)).status,'pending');const before=JSON.stringify([...f.docs]);assert.deepEqual(await f.call('advance'),done);assert.equal(JSON.stringify([...f.docs]),before);assert.equal(f.docs.get('friendRequests/'+otherId).status,'pending');
});
test('stale/foreign anchors, swapped receipts, disabled actor and account markers never authorize removal',async()=>{
  for(const patch of[{anchorUpdatedAt:3},{peerUid:'carol'},{anchorId:'other'}]){const f=fixture(1),before=JSON.stringify([...f.docs]);await assert.rejects(f.call('begin',{...f.input,...patch}));assert.equal(JSON.stringify([...f.docs]),before);}
  const f=fixture(1);await f.call();await assert.rejects(f.call('status',f.input,'carol'),{code:'permission-denied'});await assert.rejects(f.call('status',{...f.input,anchorUpdatedAt:3}),{code:'permission-denied'});
  f.users.get('alice').disabled=true;await assert.rejects(f.call('status'),{code:'permission-denied'});f.users.get('alice').disabled=false;f.docs.set('accountDeletions/alice',{status:'complete'});await assert.rejects(f.call('status'),{code:'permission-denied'});
});
test('peer Auth disable still permits removal, permanent deletion returns revoked without recreating references',async()=>{
  const f=fixture(1);f.users.get('bob').disabled=true;assert.equal((await f.call()).status,'complete');
  const g=fixture();await g.call();g.docs.set('accountDeletions/bob',{status:'complete'});g.docs.delete('commsContactRemovals/'+id);g.docs.delete('commsContactPairs/'+contacts.commsContactPairId('alice','bob'));const before=JSON.stringify([...g.docs]);assert.equal((await g.call('advance')).status,'revoked');assert.equal(JSON.stringify([...g.docs]),before);
});
test('late anchor authority changes after Auth and malformed pair ownership fail closed',async()=>{
  const f=fixture(1);f.onAuth(()=>f.docs.get('friendRequests/000').toUid='carol');await assert.rejects(f.call(),{code:'aborted'});assert.equal(f.docs.has('commsContactRemovals/'+id),false);
  const g=fixture(1);g.docs.set('commsContactPairs/'+contacts.commsContactPairId('alice','bob'),{v:1,memberUids:['alice','carol'],fromUid:'alice',toUid:'carol',status:'accepted',requestId:'000'});await assert.rejects(g.call());assert.equal(g.docs.get('friendRequests/000').status,'accepted');
});
test('opposing participant removals serialize to one owner and completion in Firestore-like transactions',async()=>{
  const f=fixture(),reverse={requestId:otherId,actorUid:'bob',peerUid:'alice',anchorId:'000',anchorUpdatedAt:2};const results=await Promise.allSettled([f.call(),f.call('begin',reverse,'bob')]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.docs.get('commsContactRemovals/'+id).removedCount,25);assert.equal(f.docs.has('commsContactRemovals/'+otherId),false);
});
test('unknown cancellation is a terminal nonce checkpoint; admitted removal cancellation preserves progress',async()=>{
  const f=fixture(1),before=JSON.stringify(f.docs.get('friendRequests/000')),cancelled=await f.call('cancel');assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.removedCount,0);assert.equal(JSON.stringify(f.docs.get('friendRequests/000')),before);assert.equal(f.docs.has('commsContactPairs/'+contacts.commsContactPairId('alice','bob')),false);
  await assert.rejects(f.call('begin'),{code:'aborted'});assert.deepEqual(await f.call('cancel'),cancelled);
  const g=fixture(),pending=await g.call();const snapshot=JSON.stringify([...g.docs]);assert.deepEqual(await g.call('cancel'),pending);assert.equal(JSON.stringify([...g.docs]),snapshot);assert.equal((await g.call('advance')).removedCount,50);
});
test('begin/cancel races are terminal or pending with one consistent nonce and no rolled-back relationships',async()=>{
  for(const cancelFirst of [true,false]){const f=fixture();const work=cancelFirst?[f.call('cancel'),f.call('begin')]:[f.call('begin'),f.call('cancel')];const results=await Promise.allSettled(work);assert.ok(results.some(row=>row.status==='fulfilled'));const receipt=await f.call('status');assert.equal(receipt.status,cancelFirst?'cancelled':'pending');assert.equal(receipt.removedCount,cancelFirst?0:25);assert.equal(f.docs.get('friendRequests/000').status,cancelFirst?'accepted':'cancelled');}
});
