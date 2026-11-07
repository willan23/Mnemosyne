const { test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { executeCapsulePublication, CAPSULE_PUBLICATION_LIMITS } = require('../lib/capsulePublication');
const { captureCapsulePublication, CAPSULE_MAX_LIFETIME_MS } = require('../lib/capsulePublicationContract');
const { executeGetPublicCapsule } = require('../lib/publicCapsules');
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
function fixture() {
  const state = { now: 1000000, enabled: true, authReads: 0, disabled: false, authUid: null };
  const docs = new Map([['users/alice',{}],['users/bob',{}]]);
  for(const name of ['a','b']) docs.set('sessions/'+name,{ uid:'alice',teamId:null,text:'',title:null,enc:{v:1,iv:'A'.repeat(16),ct:'B'.repeat(32)},timestamp:100,updatedAt:100 });
  const ref = path => ({path}), snapshot = ref => ({exists:docs.has(ref.path),createTime:new admin.firestore.Timestamp(1,1),data:()=>structuredClone(docs.get(ref.path))});
  let tail = Promise.resolve();
  const db = { doc:ref, runTransaction: body => {
    const result=tail.then(async()=>{const writes=[],tx={get:async ref=>snapshot(ref),getAll:async(...refs)=>refs.map(snapshot),
      set:(ref,data)=>writes.push(['set',ref.path,data]),create:(ref,data)=>writes.push(['create',ref.path,data])};
      const result=await body(tx);for(const[mode,path]of writes)if(mode==='create')assert(!docs.has(path));for(const[,path,data]of writes)docs.set(path,data);return result;});
    tail=result.catch(()=>{});return result;
  }};
  const deps = {firestore:db,now:()=>state.now,enabled:()=>state.enabled,auth:{getUser:async uid=>{state.authReads++;return{uid:state.authUid||uid,disabled:state.disabled};}}};
  const request = index => ({v:1,actorUid:'alice',publicationId:id(index??1),sources:[{sessionId:'a',teamId:null,revision:100},{sessionId:'b',teamId:null,revision:100}],
    ciphertext:{v:1,alg:'AES-GCM-PBKDF2',salt:'A'.repeat(22)+'==',iv:'A'.repeat(16),data:'A'.repeat(43)+'='},expiresAt:state.now+86400000});
  return {state,docs,db,deps,request,call:(value,mode='publish',uid='alice')=>executeCapsulePublication(uid,value,mode,deps),dump:()=>JSON.stringify([...docs])};
}
test('publication contract rejects plaintext, duplicate IDs, mixed scopes, invalid ciphers and excess sources before Auth',async()=>{
  const f=fixture();for(const mutate of [value=>({...value,text:'SYNTHETIC_PRIVATE_TEXT'}),value=>({...value,ciphertext:{...value.ciphertext,extra:true}}),
    value=>({...value,sources:[value.sources[0],value.sources[0]]}),value=>({...value,sources:[value.sources[0],{...value.sources[1],teamId:'crew'}]}),
    value=>({...value,sources:Array.from({length:14},(_,index)=>({...value.sources[0],sessionId:'m'+index}))}),value=>({...value,publicationId:'not-a-uuid'})])
    await assert.rejects(f.call(mutate(f.request())),{code:'invalid-argument'});
  await assert.rejects(f.call({...f.request(),actorUid:'bob'}),{code:'permission-denied'});assert.equal(f.state.authReads,0);
});
test('publication copies the command before Auth and stores only cipher with bounded receipt and cleanup timestamps',async()=>{
  const f=fixture(),input=f.request(),captured=structuredClone(input);f.deps.auth.getUser=async uid=>{input.sources[0].revision=900;input.ciphertext.data='B'.repeat(43)+'=';return{uid,disabled:false};};
  const outcome=await f.call(input),share=f.docs.get('shares/'+captured.publicationId),receipt=f.docs.get('capsulePublications/'+captured.publicationId);
  assert.equal(outcome.status,'committed');assert.deepEqual(share.ciphertext,captured.ciphertext);assert.deepEqual(share.sourceIds,['a','b']);assert.equal(share.itemCount,2);
  for(const field of['text','title','titleHint','passphrase'])assert(!(field in share));assert.equal(share.views,0);assert.equal(share.importCount,0);
  assert.equal(receipt.expiresAt.toMillis(),captured.expiresAt+86400000);assert.equal(share.retireAt.toMillis(),captured.expiresAt+2*86400000);
  const budget=f.docs.get('capsulePublicationBudgets/alice_0');assert.equal(budget.operations,1);assert.equal(budget.publications,1);
  const source=await executeGetPublicCapsule({v:1,shareId:captured.publicationId},{...f.deps,admit:async()=>true,admitRevoke:async()=>true});
  assert.deepEqual(source.ciphertext,captured.ciphertext);assert(!('uid'in source));assert(!('sessionId'in source));
});
test('a lost publication response and concurrent identical retries charge once and never rewrite committed data',async()=>{
  const f=fixture(),input=f.request();const outcomes=await Promise.all([f.call(input),f.call(input),f.call(input)]);assert(outcomes.every(row=>row.status==='committed'));
  const before=f.dump();f.state.enabled=false;f.state.now+=100;assert.equal((await f.call(input)).status,'committed');assert.equal(f.dump(),before);
  assert.equal(f.docs.get('capsulePublicationBudgets/alice_0').publications,1);assert.equal([...f.docs.keys()].filter(path=>path.startsWith('shares/')).length,1);
});
test('withdrawn, expired and removed publications are never recreated by the original request',async()=>{
  for(const condition of['removed','revoked','expired']){const f=fixture(),input=f.request();await f.call(input);const ref='shares/'+input.publicationId;
    if(condition==='removed')f.docs.delete(ref);if(condition==='revoked')f.docs.get(ref).revokedAt=f.state.now;if(condition==='expired')f.state.now=input.expiresAt;
    const before=f.dump();assert.equal((await f.call(input)).status,condition==='expired'?'expired':'withdrawn');assert.equal(f.dump(),before);
  }
  const f=fixture(),input=f.request();await f.call(input);f.docs.delete('shares/'+input.publicationId);f.docs.delete('capsulePublications/'+input.publicationId);f.state.now=input.expiresAt+86400000;
  const before=f.dump();assert.equal((await f.call(input)).status,'expired');assert.equal(f.dump(),before);
});
test('cancellation before publication remains terminal with gates closed and status never creates records',async()=>{
  const f=fixture(),input=f.request();f.state.enabled=false;const before=f.dump();assert.equal((await f.call(input,'status')).status,'unknown');assert.equal(f.dump(),before);
  f.docs.delete('sessions/a');assert.equal((await f.call(input,'cancel')).status,'cancelled');const cancelled=f.dump();f.state.enabled=true;
  assert.equal((await f.call(input)).status,'cancelled');assert.equal(f.dump(),cancelled);assert.equal(f.docs.get('capsulePublicationBudgets/alice_0').publications,0);
  f.docs.set('shares/'+input.publicationId,{uid:'alice'});await assert.rejects(f.call(input,'status'),{code:'failed-precondition'});
});
test('source rights, every pack member revision, gate and lifetime fail without a partial share or budget',async()=>{
  for(const reason of['foreign','deleted','revision','plaintext','missing','closed','long-life']){const f=fixture(),input=f.request(),source=f.docs.get('sessions/b');
    if(reason==='foreign')source.uid='bob';if(reason==='deleted')source.deletedAt=2;if(reason==='revision')source.updatedAt=101;if(reason==='plaintext')source.text='SYNTHETIC_PRIVATE_TEXT';
    if(reason==='missing')f.docs.delete('sessions/b');if(reason==='closed')f.state.enabled=false;if(reason==='long-life')input.expiresAt=f.state.now+CAPSULE_MAX_LIFETIME_MS+1;
    const before=f.dump();await assert.rejects(f.call(input));assert.equal(f.dump(),before);
  }
});
test('team publication requires live membership, active epoch, wrap and author account for every source',async()=>{
  for(const reason of['active','removed','rotation','wrap','owner-deleted','team-deleted','author-deleted']){const f=fixture(),input=f.request();input.sources=input.sources.map(row=>({...row,teamId:'crew'}));
    f.docs.set('users/owner',{});f.docs.set('teams/crew',{ownerUid:'owner',memberUids:['owner','alice'],keyRotationStatus:'active',activeKeyEpoch:2,activeKeyId:id(2),wrappedKeys:{alice:{}}});
    f.docs.set('teams/crew/keyEpochs/2',{epoch:2,keyId:id(2),status:'active',memberUids:['owner','alice'],wrappedKeys:{alice:{}}});
    for(const key of['a','b'])Object.assign(f.docs.get('sessions/'+key),{uid:'bob',teamId:'crew',enc:{v:2,iv:'A'.repeat(16),ct:'B'.repeat(32)},keyEpoch:2,keyId:id(2)});
    if(reason==='removed')f.docs.get('teams/crew').memberUids=['owner'];if(reason==='rotation')f.docs.get('teams/crew').pendingRotationId=id(3);
    if(reason==='wrap')f.docs.get('teams/crew/keyEpochs/2').wrappedKeys={};if(reason==='owner-deleted')f.docs.set('accountDeletions/owner',{status:'complete'});
    if(reason==='team-deleted')f.docs.set('teamDeletions/crew',{});if(reason==='author-deleted')f.docs.set('accountDeletions/bob',{status:'complete'});
    if(reason==='active')assert.equal((await f.call(input)).status,'committed');else{const before=f.dump();await assert.rejects(f.call(input));assert.equal(f.dump(),before);}
  }
});
test('daily creation quota is shared across publication IDs while known retries still recover at the limit',async()=>{
  const f=fixture(),outcomes=await Promise.allSettled(Array.from({length:CAPSULE_PUBLICATION_LIMITS.publications+1},(_,index)=>f.call(f.request(index+1))));
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,20);assert.equal(outcomes.filter(row=>row.status==='rejected').length,1);
  const before=f.dump();assert.equal((await f.call(f.request(1),'status')).status,'committed');assert.equal(f.dump(),before);
});
test('changed commands, occupied IDs and unavailable actors cannot take ownership or mutate an existing publication',async()=>{
  const f=fixture(),input=f.request();await f.call(input);let before=f.dump();await assert.rejects(f.call({...input,expiresAt:input.expiresAt+1}));assert.equal(f.dump(),before);
  await assert.rejects(f.call({...input,actorUid:'bob'},'status','bob'),{code:'permission-denied'});assert.equal(f.dump(),before);
  for(const reason of['disabled','auth-mismatch','marker','profile-missing']){const g=fixture();if(reason==='disabled')g.state.disabled=true;if(reason==='auth-mismatch')g.state.authUid='bob';
    if(reason==='marker')g.docs.set('accountDeletions/alice',{});if(reason==='profile-missing')g.docs.delete('users/alice');before=g.dump();await assert.rejects(g.call(g.request()));assert.equal(g.dump(),before);}
  const g=fixture(),occupied=g.request();g.docs.set('shares/'+occupied.publicationId,{uid:'bob'});before=g.dump();await assert.rejects(g.call(occupied),{code:'already-exists'});assert.equal(g.dump(),before);
});
