const assert=require('node:assert/strict'),test=require('node:test');
const {randomUUID}=require('node:crypto');
const {canonicalSyncState}=require('../lib/mobileSyncImportContract');
const hash=value=>require('node:crypto').createHash('sha256').update(canonicalSyncState(value)).digest('hex');
const {syncEnvelopePurgeEligible,purgeTerminalSyncEnvelope,runMobileSyncRetentionPage,MOBILE_SYNC_RETENTION_MS}=require('../lib/mobileSyncRetention');
const day=86400000,now=100*day;
const envelope=()=>({ownerUid:'alice',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-delta',status:'pulled',senderPublicKeyJwk:{kty:'EC'},
  encryptedPayload:{iv:'A'.repeat(16),data:'B'.repeat(32)},memoryCount:1,tombstoneIds:['note'],expiresAt:3*day,createdAt:day,updatedAt:2*day,pulledAt:2*day});
const progress=(id='env',env=envelope())=>({v:1,uid:'alice',deviceId:'phone',direction:'desktop-to-mobile',envelopeId:id,payloadDigest:hash(env.encryptedPayload),
  memoryCount:1,cursor:1,imported:1,conflicts:0,status:'complete',startedAt:day,updatedAt:2*day});
const publication=(id='env',env=envelope())=>({v:2,uid:'alice',envelopeId:id,deviceId:'phone',direction:'desktop-to-mobile',payloadDigest:hash(env.encryptedPayload),digest:'a'.repeat(64),createdAt:day});
test('requires a matching completed import and retains legacy pulled/failed flags, pending and unknown ciphertext',()=>{
  assert(syncEnvelopePurgeEligible('env',envelope(),{progress:progress()},now));
  for(const changed of [{status:'queued'},{status:'failed',error:'expired'},{status:'failed',error:'cancelled'}])assert.equal(syncEnvelopePurgeEligible('env',{...envelope(),...changed},{progress:progress()},now),false);
  assert.equal(syncEnvelopePurgeEligible('env',envelope(),{},now),false);
  for(const changed of [{status:'pending'},{cursor:0},{uid:'bob'},{deviceId:'other'},{direction:'mobile-to-desktop'},{payloadDigest:'b'.repeat(64)},{memoryCount:2},{updatedAt:now},{imported:2},{startedAt:3*day}])
    assert.equal(syncEnvelopePurgeEligible('env',envelope(),{progress:{...progress(),...changed}},now),false);
});
test('retains recently expired or recently completed envelopes, malformed metadata and changed ciphertext',()=>{
  for(const changed of [{expiresAt:now-MOBILE_SYNC_RETENTION_MS},{updatedAt:now},{pulledAt:now},{createdAt:-1},{ownerUid:'bob'},{encryptedPayload:{iv:'A'.repeat(16),data:'C'.repeat(32)}},{unexpectedArchive:{preserve:true}}])
    assert.equal(syncEnvelopePurgeEligible('env',{...envelope(),...changed},{progress:progress()},now),false);
  assert.equal(syncEnvelopePurgeEligible('bad/id',envelope(),{progress:progress()},now),false);
});
test('cancelled envelopes need two v2 receipts bound to the current payload; old v1 receipts remain usable but cannot authorize purge',()=>{
  const env={...envelope(),status:'failed',error:'cancelled'},pub=publication(),cancel={...pub,createdAt:2*day};delete env.pulledAt;
  assert(syncEnvelopePurgeEligible('env',env,{publication:pub,cancellation:cancel},now));
  for(const changed of [{v:1},{uid:'bob'},{payloadDigest:'b'.repeat(64)},{digest:'b'.repeat(64)},{createdAt:now},{createdAt:1}])
    assert.equal(syncEnvelopePurgeEligible('env',env,{publication:pub,cancellation:{...cancel,...changed}},now),false);
  assert.equal(syncEnvelopePurgeEligible('env',env,{publication:pub,cancellation:cancel,progress:progress()},now),false);
});
function fixture(count=1){
  const docs=new Map([['users/alice',{}],['sessions/note',{uid:'alice',deletedAt:day,enc:{preserved:true}}],['sessions/note/versions/v1',{preserved:true}]]),deleted=[];
  for(let i=0;i<count;i++){const id='e'+String(i).padStart(3,'0'),env=envelope();docs.set('mobileSyncEnvelopes/'+id,env);docs.set('mobileSyncImports/'+id,progress(id,env));}
  const snap=ref=>({ref,id:ref.id,exists:docs.has(ref.path),data:()=>docs.get(ref.path)});
  const doc=path=>({path,id:path.split('/').at(-1),get:async()=>snap(doc(path))});
  let race=null;
  const db={doc,collection:name=>{assert.equal(name,'mobileSyncEnvelopes');const make=(after=null,limit=Infinity)=>({where:()=>make(after,limit),orderBy:()=>make(after,limit),select:()=>make(after,limit),limit:n=>make(after,n),startAfter:(at,id)=>make({at,id},limit),get:async()=>{
    const values=[...docs].filter(([path,value])=>path.startsWith(name+'/')&&path.split('/').length===2&&value.expiresAt>0&&value.expiresAt<now-MOBILE_SYNC_RETENTION_MS)
      .sort((a,b)=>a[1].expiresAt-b[1].expiresAt||a[0].localeCompare(b[0])).filter(([path,value])=>!after||value.expiresAt>after.at||value.expiresAt===after.at&&path.split('/').at(-1)>after.id).slice(0,limit);
    const rows=values.map(([path,value])=>({id:doc(path).id,ref:doc(path),data:()=>({expiresAt:value.expiresAt})}));return{docs:rows,size:rows.length};}});return make();},runTransaction:async work=>{
    const writes=[],get=async ref=>{assert.equal(writes.length,0);if(ref.path==='mobileSyncCleanup/state'&&race){const invoke=race;race=null;invoke();}return snap(ref);};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),delete:ref=>writes.push({ref,remove:true}),set:(ref,data)=>writes.push({ref,data})});
    for(const write of writes){if(write.remove){deleted.push(write.ref.path);docs.delete(write.ref.path);}else docs.set(write.ref.path,write.data);}return result;
  }};
  return{docs,deleted,db,deps:{firestore:db,now:()=>now,id:randomUUID},race:callback=>{race=callback;}};
}
test('purges only a current receipt-backed envelope, preserves all memory/history/receipts and is idempotent',async()=>{
  const f=fixture();assert.equal(await purgeTerminalSyncEnvelope('e000',f.deps),true);assert.equal(await purgeTerminalSyncEnvelope('e000',f.deps),false);
  assert.deepEqual(f.deleted,['mobileSyncEnvelopes/e000']);for(const path of ['sessions/note','sessions/note/versions/v1','mobileSyncImports/e000','users/alice'])assert(f.docs.has(path));
});
test('revalidates current state and refuses changed/queued data or an account deletion marker',async()=>{
  const f=fixture();f.docs.get('mobileSyncEnvelopes/e000').status='queued';assert.equal(await purgeTerminalSyncEnvelope('e000',f.deps),false);
  f.docs.get('mobileSyncEnvelopes/e000').status='pulled';f.docs.set('accountDeletions/alice',{status:'deleting'});assert.equal(await purgeTerminalSyncEnvelope('e000',f.deps),false);assert.equal(f.deleted.length,0);
});
test('durable pages pass retained rows and resume without resetting to the beginning or deleting memory tombstones',async()=>{
  const f=fixture(60);for(let i=0;i<50;i++)f.docs.get('mobileSyncEnvelopes/e'+String(i).padStart(3,'0')).status='queued';
  const first=await runMobileSyncRetentionPage(f.deps);assert.deepEqual(first,{scanned:50,deleted:0,retained:50,failed:0,more:true,cursorAdvanced:true,tombstonesDeleted:0});
  const second=await runMobileSyncRetentionPage(f.deps);assert.equal(second.scanned,10);assert.equal(second.deleted,10);assert.equal(second.more,false);assert.equal(f.docs.get('mobileSyncCleanup/state').after,null);
  assert(f.docs.has('sessions/note'));assert(f.deleted.every(path=>path.startsWith('mobileSyncEnvelopes/')));
});
test('overlapping scans cannot rewind a cursor after another run advances it',async()=>{
  const f=fixture(51),current={v:1,after:{expiresAt:3*day,id:'e049'},updatedAt:now,revision:randomUUID()};
  f.race(()=>f.docs.set('mobileSyncCleanup/state',current));const result=await runMobileSyncRetentionPage(f.deps);assert.equal(result.cursorAdvanced,false);assert.deepEqual(f.docs.get('mobileSyncCleanup/state'),current);
});
test('invalid/future cursor state fails before scanning and never silently resets progress',async()=>{
  const f=fixture();f.docs.set('mobileSyncCleanup/state',{v:1,after:null,updatedAt:now+1,revision:randomUUID()});await assert.rejects(runMobileSyncRetentionPage(f.deps));assert.equal(f.deleted.length,0);
});
