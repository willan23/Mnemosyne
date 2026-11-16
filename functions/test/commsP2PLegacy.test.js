'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const admin=require('firebase-admin'),api=require('../lib/commsP2PLegacy'),contract=require('../lib/commsP2PLegacyContract');
const projectId='demo-mnemosyne-rules',cutoverId='11111111-1111-4111-8111-111111111111',planId='22222222-2222-4222-8222-222222222222';
const policy={projectId,rulesSha256:'a'.repeat(64),rulesetName:`projects/${projectId}/rulesets/synthetic-v1`,releaseUpdateTime:'2026-10-12T00:00:00Z'};
function fixture(){
  const docs=new Map(),versions=new Map(),reads=[];let now=1000,queue=Promise.resolve(),enabled=true,observedPolicy=policy,policyCalls=0;
  const timestamp=()=>admin.firestore.Timestamp.fromMillis(now);
  const clone=value=>value instanceof admin.firestore.Timestamp?new admin.firestore.Timestamp(value.seconds,value.nanoseconds):Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
  const masked=(value,mask)=>mask?Object.fromEntries(mask.filter(key=>Object.hasOwn(value,key)).map(key=>[key,clone(value[key])])):clone(value);
  const query=(collection,group=false,limit=Infinity,mask=null,after=null)=>({collection,group,maximum:limit,mask,after,
    orderBy:()=>query(collection,group,limit,mask,after),select:(...fields)=>query(collection,group,limit,fields,after),limit:n=>query(collection,group,n,mask,after),startAfter:ref=>query(collection,group,limit,mask,ref.path),get:async()=>get(query(collection,group,limit,mask,after)),doc:id=>ref(collection+'/'+id)});
  const ref=path=>({path,id:path.split('/').at(-1),collection:side=>query(path+'/'+side),get:async()=>get(ref(path))});
  const snap=(path,mask)=>({exists:docs.has(path),id:path.split('/').at(-1),ref:ref(path),updateTime:versions.get(path),readTime:timestamp(),data:()=>docs.has(path)?masked(docs.get(path),mask):undefined});
  const get=async(input,mask)=>{reads.push({path:input.path??input.collection,mask:input.mask??mask??null});if(typeof input.collection==='string'){const paths=[...docs.keys()].filter(path=>input.group?path.split('/').at(-2)===input.collection:path.startsWith(input.collection+'/')&&path.split('/').length===input.collection.split('/').length+1).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).filter(path=>!input.after||Buffer.compare(Buffer.from(path),Buffer.from(input.after))>0).slice(0,input.maximum),rows=paths.map(path=>snap(path,input.mask));return{docs:rows,size:rows.length,empty:rows.length===0};}return snap(input.path,mask);};
  const store=(path,data)=>{docs.set(path,clone(data));versions.set(path,timestamp());};
  const db={projectId,databaseId:'(default)',doc:ref,collection:path=>query(path),collectionGroup:path=>query(path,true),getAll:(...values)=>{const tail=values.at(-1),mask=tail?.fieldMask?values.pop().fieldMask:null;return Promise.all(values.map(value=>get(value,mask)));},runTransaction:work=>{
    const pending=queue.then(async()=>{const writes=[],read=(input,mask)=>{assert.equal(writes.length,0,'all reads must precede writes');return get(input,mask);};const tx={get:read,getAll:(...values)=>{const tail=values.at(-1),mask=tail?.fieldMask?values.pop().fieldMask:null;return Promise.all(values.map(value=>read(value,mask)));},create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push({path:r.path,data});},update:(r,data)=>{assert.equal(docs.has(r.path),true);writes.push({path:r.path,data,merge:true});},delete:r=>writes.push({path:r.path,remove:true})};const result=await work(tx);
      if(writes.length)now++;
      for(const write of writes){if(write.remove){docs.delete(write.path);versions.delete(write.path);continue;}const next=write.merge?clone(docs.get(write.path)):{};for(const[key,value]of Object.entries(write.data)){if(value instanceof admin.firestore.FieldValue&&value.isEqual(admin.firestore.FieldValue.delete()))delete next[key];else if(value instanceof admin.firestore.FieldValue&&value.isEqual(admin.firestore.FieldValue.serverTimestamp()))next[key]=timestamp();else next[key]=clone(value);}store(write.path,next);}return result;});queue=pending.catch(()=>{});return pending;
  }};
  const deps={projectId,firestore:db,enabled:()=>enabled,verifyRules:async()=>{policyCalls++;return clone(observedPolicy);}};
  const seed=(path,data)=>{now++;store(path,data);},room='p2pRooms/SyntheticLegacyRoom01';
  seed(room,{callerId:'alice',calleeId:'bob',status:'active',createdAt:999999999999999,updatedAt:-1,offer:{type:'offer',sdp:'Synthetic private network offer'},answer:{type:'answer',sdp:'Synthetic private network answer'},callerLabel:'Synthetic private display',custom:{retained:true}});
  const activate=async()=>{await api.recordCommsP2PLegacyCutover(cutoverId,deps);now+=600000;};
  const prepare=(path=room,kind='room',id=planId)=>api.prepareCommsP2PLegacyPlan({projectId,planId:id,cutoverId,kind,path},deps);
  return{docs,versions,reads,db,deps,room,seed,activate,prepare,setNow:value=>{now=value;},advance:ms=>{now+=ms;},setEnabled:value=>{enabled=value;},setPolicy:value=>{observedPolicy=value;},get policyCalls(){return policyCalls;}};
}
test('inventory pages metadata only, detects orphan/foreign namespaces, and never returns signal/label/UID values',async()=>{
  const f=fixture();f.seed('p2pRooms/ModernRoom',{v:2,callerId:'alice',calleeId:'bob',status:'active'});f.seed('p2pRooms/missing/callerCandidates/item',{uid:'carol',candidate:{candidate:'Synthetic private network ICE'},createdAt:2});f.seed('other/x/callerCandidates/y',{uid:'alice'});
  const roots=await api.inventoryCommsP2PLegacyPage({source:'rooms',afterPath:null,limit:1},f.deps);assert.equal(roots.rows[0].kind,'modern');assert.equal(roots.exhausted,false);
  const next=await api.inventoryCommsP2PLegacyPage({source:'rooms',afterPath:roots.nextAfterPath,limit:1},f.deps);assert.equal(next.rows[0].kind,'legacy');assert.equal(next.exhausted,true);
  const children=await api.inventoryCommsP2PLegacyPage({source:'callerCandidates',afterPath:null,limit:50},f.deps);assert.deepEqual(children.rows.map(row=>row.kind),['unsupported','orphan']);
  const text=JSON.stringify([roots,next,children]);for(const word of ['alice','bob','carol','Synthetic private','offer','candidate:'])assert.equal(text.includes(word),false);
  assert.ok(f.reads.filter(row=>row.path==='p2pRooms').every(row=>row.mask&&!row.mask.includes('offer')&&!row.mask.includes('answer')));
  await assert.rejects(api.inventoryCommsP2PLegacyPage({source:'rooms',afterPath:'other/path',limit:1},f.deps));await assert.rejects(api.inventoryCommsP2PLegacyPage({source:'rooms',afterPath:null,limit:51},f.deps));
});
test('cutover uses server activation/read timestamps and is idempotent; client legacy dates never authorize cleanup',async()=>{
  const f=fixture();await api.recordCommsP2PLegacyCutover(cutoverId,f.deps);await assert.rejects(f.prepare());
  const activated=f.docs.get('commsP2PLegacyCutovers/'+cutoverId).activatedAt;
  f.advance(600000);const again=await api.recordCommsP2PLegacyCutover(cutoverId,f.deps);assert.equal(again.activatedAt.seconds,activated.seconds);assert.equal(again.activatedAt.nanoseconds,activated.nanoseconds);
  assert.equal((await f.prepare()).kind,'room');assert.equal(f.policyCalls,6);
});
test('legacy signal fields/candidates and receipt are atomic; unknown fields, quotas and stable retries survive',async()=>{
  const f=fixture();f.seed(f.room+'/callerCandidates/a',{uid:'alice',createdAt:1,candidate:{candidate:'Synthetic private ICE'}});f.seed(f.room+'/calleeCandidates/b',{uid:'bob',createdAt:1,candidate:{candidate:'Synthetic private ICE'}});f.seed('commsDeliveryBudgets/project',{requests:5,bytes:100});await f.activate();
  const plan=await f.prepare(),out=await api.applyCommsP2PLegacyPlan(plan,f.deps);assert.deepEqual(out,{planId,status:'applied',deletedCandidates:2,remainingChildren:false});
  const room=f.docs.get(f.room);assert.equal(room.offer,undefined);assert.equal(room.answer,undefined);assert.equal(room.callerLabel,undefined);assert.deepEqual(room.custom,{retained:true});assert.equal(room.createdAt,999999999999999);assert.equal(room.status,'closed');assert.deepEqual(f.docs.get('commsDeliveryBudgets/project'),{requests:5,bytes:100});
  assert.deepEqual(await Promise.all(Array.from({length:4},()=>api.applyCommsP2PLegacyPlan(plan,f.deps))),Array(4).fill(out));assert.equal([...f.docs.keys()].filter(path=>path.startsWith('commsP2PLegacyReceipts/')).length,1);
  const inventory=await api.inventoryCommsP2PLegacyPage({source:'rooms',afterPath:null,limit:50},f.deps);assert.equal(inventory.rows[0].kind,'reconciled');f.setEnabled(false);assert.deepEqual(await api.getCommsP2PLegacyPlanStatus(plan,f.deps),out);
});
test('changes to unprojected SDP or ICE are caught by server versions before any mutation',async()=>{
  const f=fixture();f.seed(f.room+'/callerCandidates/a',{uid:'alice',createdAt:1,candidate:{candidate:'Synthetic private ICE'}});await f.activate();const plan=await f.prepare();
  f.seed(f.room,{...f.docs.get(f.room),offer:{type:'offer',sdp:'Synthetic changed offer'}});await assert.rejects(api.applyCommsP2PLegacyPlan(plan,f.deps));assert.equal(f.docs.has(f.room+'/callerCandidates/a'),true);assert.equal(f.docs.has('commsP2PLegacyReceipts/'+planId),false);
  const other=fixture();other.seed(other.room+'/callerCandidates/a',{uid:'alice',createdAt:1,candidate:{candidate:'Synthetic private ICE'}});await other.activate();const original=await other.prepare();other.seed(other.room+'/callerCandidates/a',{uid:'alice',createdAt:1,candidate:{candidate:'Synthetic changed ICE'}});await assert.rejects(api.applyCommsP2PLegacyPlan(original,other.deps));assert.ok(other.docs.get(other.room).offer);
});
test('large legacy collections use bounded plans with private continuation receipts instead of trusting a rewritten timestamp',async()=>{
  const f=fixture();for(const side of ['callerCandidates','calleeCandidates'])for(let i=0;i<70;i++)f.seed(f.room+'/'+side+'/'+String(i).padStart(3,'0'),{uid:side==='callerCandidates'?'alice':'bob',createdAt:1});await f.activate();
  for(let i=0;i<3;i++){const id=['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'][i],plan=await f.prepare(f.room,'room',id);assert.ok(plan.children.length<=64);const result=await api.applyCommsP2PLegacyPlan(plan,f.deps);assert.equal(result.remainingChildren,i<2);}
  assert.equal([...f.docs.keys()].some(path=>path.startsWith(f.room+'/')),false);
  const second=fixture();for(let i=0;i<33;i++)second.seed(second.room+'/callerCandidates/'+i,{uid:'alice'});await second.activate();await api.applyCommsP2PLegacyPlan(await second.prepare(),second.deps);second.seed(second.room,{...second.docs.get(second.room),custom:{changed:true}});await assert.rejects(second.prepare(second.room,'room','33333333-3333-4333-8333-333333333333'));
});
test('orphan cleanup rereads parent absence; parent recreation and changed candidate generation abort',async()=>{
  const f=fixture(),path='p2pRooms/missing/callerCandidates/a';f.seed(path,{uid:'alice',candidate:{candidate:'Synthetic orphan ICE'}});await f.activate();const plan=await f.prepare(path,'orphan');f.seed('p2pRooms/missing',{v:2,callerId:'alice',calleeId:'bob',status:'active'});await assert.rejects(api.applyCommsP2PLegacyPlan(plan,f.deps));assert.equal(f.docs.has(path),true);
  f.docs.delete('p2pRooms/missing');f.seed(path,{uid:'alice',candidate:{candidate:'Synthetic new orphan ICE'}});await assert.rejects(api.applyCommsP2PLegacyPlan(plan,f.deps));await assert.rejects(f.prepare(path,'orphan'));
  const clean=fixture();clean.seed(path,{uid:'alice'});await clean.activate();assert.equal((await api.applyCommsP2PLegacyPlan(await clean.prepare(path,'orphan'),clean.deps)).deletedCandidates,1);assert.equal(clean.docs.has(path),false);
});
test('modern rooms, unknown namespaces, changed policy, wrong projects and closed gates cannot be adopted',async()=>{
  const f=fixture();f.seed('p2pRooms/modern',{v:2,callerId:'alice',calleeId:'bob',status:'active'});await f.activate();await assert.rejects(f.prepare('p2pRooms/modern'));await assert.rejects(f.prepare('other/x/callerCandidates/a','orphan'));const plan=await f.prepare();
  f.setPolicy({...policy,rulesetName:`projects/${projectId}/rulesets/synthetic-v2`});await assert.rejects(api.applyCommsP2PLegacyPlan(plan,f.deps));assert.ok(f.docs.get(f.room).offer);f.setPolicy(policy);f.setEnabled(false);const before=f.policyCalls;await assert.rejects(api.applyCommsP2PLegacyPlan(plan,f.deps));await assert.rejects(api.recordCommsP2PLegacyCutover('33333333-3333-4333-8333-333333333333',f.deps));assert.equal(f.policyCalls,before);
  await assert.rejects(api.inventoryCommsP2PLegacyPage({source:'rooms',afterPath:null,limit:1},{...f.deps,projectId:'another-project'}));
  f.db.databaseId='another-database';await assert.rejects(api.inventoryCommsP2PLegacyPage({source:'rooms',afterPath:null,limit:1},f.deps));
});
test('account deletion markers suppress new participant references in cleanup receipts',async()=>{
  const f=fixture();await f.activate();const plan=await f.prepare();f.seed('accountDeletions/alice',{status:'complete'});await api.applyCommsP2PLegacyPlan(plan,f.deps);const receipt=f.docs.get('commsP2PLegacyReceipts/'+planId);assert.equal(receipt.callerUid,null);assert.equal(receipt.calleeUid,'bob');
  const second=fixture(),path='p2pRooms/missing/calleeCandidates/a';second.seed(path,{uid:'alice'});await second.activate();const pending=await second.prepare(path,'orphan');second.seed('accountDeletions/alice',{status:'complete'});await api.applyCommsP2PLegacyPlan(pending,second.deps);assert.equal(second.docs.get('commsP2PLegacyReceipts/'+planId).ownerUid,null);
});
test('policy changes between cutover observations leave an inactive marker and never start cleanup',async()=>{
  const f=fixture();let calls=0;f.deps.verifyRules=async()=>++calls===1?policy:{...policy,rulesSha256:'b'.repeat(64)};await assert.rejects(api.recordCommsP2PLegacyCutover(cutoverId,f.deps));assert.equal(f.docs.get('commsP2PLegacyCutovers/'+cutoverId).status,'pending');assert.ok(f.docs.get(f.room).offer);
});
test('plan schema enforces exact names, namespaces, versions, sorted unique child paths and batch limits',async()=>{
  const f=fixture();f.seed(f.room+'/callerCandidates/a',{uid:'alice'});await f.activate();const plan=await f.prepare();assert.deepEqual(contract.parseCommsP2PLegacyPlan(plan),plan);
  for(const value of[{...plan,extra:'untrusted'},{...plan,subject:{...plan.subject,path:'users/alice'}},{...plan,children:[...plan.children,...plan.children]},{...plan,children:[{...plan.children[0],path:'p2pRooms/other/callerCandidates/a'}]},{...plan,subject:{...plan.subject,version:{seconds:1,nanoseconds:1e9}}}])assert.throws(()=>contract.parseCommsP2PLegacyPlan(value));
});
