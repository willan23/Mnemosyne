const assert=require('node:assert/strict');const test=require('node:test');
process.env.GCLOUD_PROJECT=process.env.GCLOUD_PROJECT||'demo-mnemosyne-test';
const {parseSyncPublication,syncDeviceState}=require('../lib/mobileSyncPublicationContract');
const {syncStateHash}=require('../lib/mobileSyncImport');
const {executeSyncPublication,publishMobileSyncEnvelope,getMobileSyncPublicationStatus,cancelMobileSyncPublication,SYNC_DAILY_ENVELOPES,SYNC_DAILY_CIPHER_BYTES}=require('../lib/mobileSyncPublication');
const publicKey={kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'B'.repeat(43),ext:true,key_ops:[]};
const device={ownerUid:'alice',deviceId:'phone',status:'active',publicKeyJwk:publicKey,desktopPublicKeyJwk:publicKey};
const input={envelopeId:'envelope',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-delta',senderPublicKeyJwk:publicKey,
  encryptedPayload:{iv:'A'.repeat(16),data:'B'.repeat(32)},memoryCount:1,tombstoneIds:[],expiresAt:100000,expectedDeviceHash:syncStateHash(syncDeviceState(device,'alice','phone'))};
function fixture(){
  const docs=new Map([['users/alice',{}],['trustedDevices/phone',structuredClone(device)]]);let now=1000;
  const doc=path=>({path,id:path.split('/').pop()});
  const db={doc,runTransaction:async work=>{
    const writes=[];const get=async ref=>{assert.equal(writes.length,0);return {ref,exists:docs.has(ref.path),data:()=>docs.get(ref.path)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(ref,data)=>{assert.equal(docs.has(ref.path),false);writes.push({ref,data,mode:'create'});},
      set:(ref,data)=>writes.push({ref,data,mode:'set'}),update:(ref,data)=>writes.push({ref,data,mode:'update'})});
    for(const write of writes)docs.set(write.ref.path,write.mode==='update'?{...docs.get(write.ref.path),...write.data}:write.data);return result;
  }};
  return {docs,deps:{firestore:db,now:()=>now},time:value=>{now=value;},run:(mode='publish',value=input,uid='alice')=>executeSyncPublication(uid,value,mode,{firestore:db,now:()=>now})};
}
test('publication rejects plaintext, authority, malformed keys/ciphers, counts and metadata before admission',()=>{
  assert.deepEqual(parseSyncPublication(input),input);
  for(const value of [null,[],{...input,uid:'alice'},{...input,text:'Synthetic'},{...input,envelopeId:'a/b'},{...input,memoryCount:2501},{...input,tombstoneIds:['a','a']},
    {...input,senderPublicKeyJwk:{...publicKey,d:'C'.repeat(43)}},{...input,encryptedPayload:{iv:'x',data:'x'}},{...input,expectedDeviceHash:'x'},
    {...input,direction:'mobile-to-desktop',payloadType:'memory-snapshot'}])assert.throws(()=>parseSyncPublication(value));
});
test('callables reject missing Auth, invalid input and closed publication before rate/database; recovery has no secret bindings',async()=>{
  await assert.rejects(publishMobileSyncEnvelope.run(input,{}),{code:'unauthenticated'});
  await assert.rejects(publishMobileSyncEnvelope.run({...input,text:'Synthetic'},{auth:{uid:'alice'}}),{code:'invalid-argument'});
  await assert.rejects(publishMobileSyncEnvelope.run(input,{auth:{uid:'alice'}}),{code:'failed-precondition'});
  await assert.rejects(getMobileSyncPublicationStatus.run(null,{auth:{uid:'alice'}}),{code:'invalid-argument'});
  await assert.rejects(cancelMobileSyncPublication.run(input,{}),{code:'unauthenticated'});
  for(const handler of [publishMobileSyncEnvelope,getMobileSyncPublicationStatus,cancelMobileSyncPublication])assert.deepEqual(handler.__endpoint.secretEnvironmentVariables||[],[]);
});
test('publication and daily quota commit once; exact recovery does not recreate missing ciphertext or require active device',async()=>{
  const f=fixture();assert.equal((await f.run('status')).status,'unknown');const first=await f.run();assert.equal(first.delivery,'queued');
  assert.equal(f.docs.get('mobileSyncBudgets/alice_1970-01-01').envelopes,1);assert.deepEqual(await f.run(),first);
  f.docs.delete('mobileSyncEnvelopes/envelope');f.docs.get('trustedDevices/phone').status='revoked';const known=await f.run();
  assert.equal(known.status,'published');assert.equal(known.delivery,'unavailable');assert.equal(f.docs.has('mobileSyncEnvelopes/envelope'),false);assert.equal(f.docs.get('mobileSyncBudgets/alice_1970-01-01').envelopes,1);
  await assert.rejects(f.run('publish',{...input,encryptedPayload:{...input.encryptedPayload,data:'C'.repeat(32)}}),{code:'permission-denied'});
});
test('new publication/cancellation receipts bind ciphertext, retain v1 recovery and reject corrupt v2 bindings',async()=>{
  const f=fixture();await f.run();const receipt=f.docs.get('mobileSyncPublications/envelope');assert.equal(receipt.v,2);assert.equal(receipt.payloadDigest,syncStateHash(input.encryptedPayload));
  await f.run('cancel');const cancelled=f.docs.get('mobileSyncPublicationCancellations/envelope');assert.equal(cancelled.v,2);assert.equal(cancelled.payloadDigest,receipt.payloadDigest);
  cancelled.payloadDigest='b'.repeat(64);await assert.rejects(f.run('status'),{code:'permission-denied'});cancelled.payloadDigest=receipt.payloadDigest;
  receipt.v=1;delete receipt.payloadDigest;cancelled.v=1;delete cancelled.payloadDigest;assert.equal((await f.run('status')).delivery,'cancelled');
});
test('cancellation before publish tombstones the ID and stops a late publish without creating envelope or budget',async()=>{
  const f=fixture();assert.equal((await f.run('cancel')).status,'cancelled');assert.equal((await f.run('status')).delivery,'cancelled');
  await assert.rejects(f.run());assert.equal(f.docs.has('mobileSyncEnvelopes/envelope'),false);assert.equal(f.docs.has('mobileSyncBudgets/alice_1970-01-01'),false);
  await assert.rejects(f.run('status',input,'bob'),{code:'permission-denied'});
});
test('a queued publication can be cancelled before import; pending/complete imports preserve progress and cannot be cancelled or recharged',async()=>{
  const f=fixture();await f.run();assert.equal((await f.run('cancel')).delivery,'cancelled');assert.equal(f.docs.get('mobileSyncEnvelopes/envelope').status,'failed');assert.equal(f.docs.get('mobileSyncBudgets/alice_1970-01-01').envelopes,1);
  for(const status of ['pending','complete']){
    const g=fixture();const request={...input,memoryCount:2};await g.run('publish',request);
    g.docs.set('mobileSyncImports/envelope',{v:1,uid:'alice',envelopeId:'envelope',deviceId:'phone',direction:input.direction,payloadDigest:syncStateHash(input.encryptedPayload),memoryCount:2,cursor:status==='complete'?2:1,status,imported:1,conflicts:0});
    assert.equal((await g.run('cancel',request)).delivery,status);assert.equal(g.docs.has('mobileSyncPublicationCancellations/envelope'),false);assert.equal(g.docs.get('mobileSyncEnvelopes/envelope').status,'queued');
  }
});
test('device/account/expiry/collisions and daily limits abort before any publication, receipt or budget change',async()=>{
  for(const reason of ['account','device','key-change','expired','far-expiry','collision','count','bytes','sender']){
    const f=fixture();let request=input;
    if(reason==='account')f.docs.set('accountDeletions/alice',{});
    if(reason==='device')f.docs.get('trustedDevices/phone').status='revoked';
    if(reason==='key-change')f.docs.get('trustedDevices/phone').publicKeyJwk={...publicKey,x:'D'.repeat(43)};
    if(reason==='expired')request={...input,expiresAt:1000};if(reason==='far-expiry')request={...input,expiresAt:1000+7*86400000+1};
    if(reason==='collision')f.docs.set('mobileSyncEnvelopes/envelope',{ownerUid:'bob'});
    if(reason==='count'||reason==='bytes')f.docs.set('mobileSyncBudgets/alice_1970-01-01',{uid:'alice',day:'1970-01-01',envelopes:reason==='count'?SYNC_DAILY_ENVELOPES:0,bytes:reason==='bytes'?SYNC_DAILY_CIPHER_BYTES:0});
    if(reason==='sender')request={...input,direction:'mobile-to-desktop',senderPublicKeyJwk:{...publicKey,x:'D'.repeat(43)}};
    await assert.rejects(f.run('publish',request));assert.equal(f.docs.has('mobileSyncPublications/envelope'),false);
    if(reason!=='collision')assert.equal(f.docs.has('mobileSyncEnvelopes/envelope'),false);
  }
});
test('status distinguishes expired ciphertext from completed receipt and rejects foreign or inconsistent import proofs',async()=>{
  const f=fixture();await f.run();f.time(100001);assert.equal((await f.run('status')).delivery,'expired');
  const progress={v:1,uid:'alice',envelopeId:'envelope',deviceId:'phone',direction:input.direction,payloadDigest:syncStateHash(input.encryptedPayload),memoryCount:1,cursor:1,status:'complete',imported:1,conflicts:0};
  f.docs.set('mobileSyncImports/envelope',progress);assert.equal((await f.run('status')).delivery,'complete');
  for(const fields of [{uid:'bob'},{deviceId:'other'},{payloadDigest:'a'.repeat(64)},{cursor:0},{imported:2}]){
    f.docs.set('mobileSyncImports/envelope',{...progress,...fields});await assert.rejects(f.run('status'),{code:'permission-denied'});
  }
});
