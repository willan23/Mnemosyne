'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {generateKeyPairSync,createHash}=require('node:crypto');
const {executeCommsList,listCommsPage}=require('../lib/commsLists'),contract=require('../lib/commsListContract');
const request=(kind='relay-in',after=null)=>({uid:'alice',kind,after});
const capsule=(other='bob')=>({senderId:other,recipientId:'alice',timestamp:1,status:'sent',encryptedData:Buffer.alloc(256).toString('base64'),secretExtra:'must-not-return'});
function fixture(){
  const docs=new Map(['alice','bob','carol'].map(uid=>['users/'+uid,{uid}])),users=new Map(['alice','bob','carol'].map(uid=>[uid,{uid,disabled:false,email:uid+'@example.invalid',emailVerified:true}])),queries=[];let reads=0,onAuth=()=>{};
  const ref=path=>({path,id:path.split('/').pop()}),snap=path=>({ref:ref(path),id:path.split('/').pop(),exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
  const query=(name,state={})=>({state,name,where:(field,op,value)=>query(name,{...state,filters:[...(state.filters??[]),{field,op,value}]}),orderBy:field=>query(name,{...state,order:field}),limit:limit=>query(name,{...state,limit}),startAfter:after=>query(name,{...state,after})});
  const deps={firestore:{doc:ref,collection:query,runTransaction:async work=>work({getAll:async(...refs)=>{reads+=refs.length;return refs.map(r=>snap(r.path));},get:async q=>{if(q.path)return snap(q.path);queries.push(q);const rows=[...docs].filter(([path,data])=>path.startsWith(q.name+'/')&&q.state.filters.every(filter=>data[filter.field]===filter.value)&&(!q.state.after||contract.compareCommsDocumentIds(path.split('/').pop(),q.state.after)>0)).sort(([a],[b])=>contract.compareCommsDocumentIds(a,b)).slice(0,q.state.limit).map(([path])=>snap(path));return{docs:rows,size:rows.length};}})},auth:{getUser:async uid=>{onAuth(uid);if(!users.has(uid)){const error=Error();error.code='auth/user-not-found';throw error;}return users.get(uid);}}};
  return{docs,users,deps,queries,get reads(){return reads;},onAuth:fn=>{onAuth=fn;},call:value=>executeCommsList('alice',value??request(),deps)};
}
test('Comms pages bind actor and cursor before any database/Auth call, including callable token swaps',async()=>{
  const f=fixture();for(const value of[{...request(),uid:'carol'},{...request(),limit:1000},request('other'),request('relay-in',{uid:'carol',kind:'relay-in',id:'x'}),request('relay-in',{uid:'alice',kind:'relay-out',id:'x'})])await assert.rejects(f.call(value));assert.equal(f.reads,0);await assert.rejects(listCommsPage.run(request(),{auth:{uid:'carol'}}),{code:'permission-denied'});
});
test('Comms relay pages are bounded and traverse old records with ID cursor without duplication or losing timestamp-less candidates',async()=>{
  const f=fixture();for(let i=0;i<31;i++)f.docs.set('transmissions/'+String(i).padStart(3,'0'),capsule());f.docs.set('transmissions/015x',{...capsule(),timestamp:undefined});
  const first=await f.call();assert.equal(first.scanned,25);assert.equal(first.rows.length,24);assert.equal(first.unavailable,1);assert.equal(first.next.id,'023');const second=await f.call(request('relay-in',first.next));assert.equal(second.rows.length,7);assert.equal(second.next,null);assert.equal(new Set([...first.rows,...second.rows].map(row=>row.id)).size,31);assert.equal(f.queries[0].state.limit,26);assert.equal(first.rows[0].data.secretExtra,undefined);
});
test('revoked, disabled, missing and malformed participants do not suppress valid records or leak their identities',async()=>{
  const f=fixture();f.docs.set('transmissions/a',capsule('bob'));f.docs.set('transmissions/b',capsule('carol'));f.docs.set('transmissions/c',capsule('missing'));f.docs.set('transmissions/d',{...capsule(),encryptedData:'invalid'});f.docs.set('accountDeletions/carol',{status:'complete'});
  const page=await f.call();assert.deepEqual(page.rows.map(row=>row.id),['a']);assert.equal(page.unavailable,3);assert.equal(JSON.stringify(page).includes('carol'),false);f.users.get('bob').disabled=true;assert.equal((await f.call()).rows.length,0);
});
test('late account deletion and changed row authority are revalidated after Auth awaits',async()=>{
  const f=fixture();f.docs.set('transmissions/a',capsule());f.onAuth(uid=>{if(uid==='bob')f.docs.set('accountDeletions/bob',{status:'complete'});});assert.equal((await f.call()).rows.length,0);
  f.docs.delete('accountDeletions/bob');f.onAuth(uid=>{if(uid==='bob')f.docs.set('transmissions/a',{...capsule(),recipientId:'carol'});});assert.equal((await f.call()).rows.length,0);
  f.onAuth(()=>{});f.docs.set('accountDeletions/alice',{status:'complete'});await assert.rejects(f.call(),{code:'permission-denied'});
});
test('Comms contact and incoming room pages expose only a bounded participant projection',async()=>{
  const f=fixture(),contact={fromUid:'bob',toUid:'alice',fromLabel:'Synthetic Bob',toLabel:'Synthetic Alice',status:'accepted',createdAt:1,updatedAt:2,secretExtra:'hidden'};
  f.docs.set('friendRequests/a',contact);f.docs.set('friendRequests/b',{...contact,fromUid:'alice',toUid:'carol'});f.docs.set('p2pRooms/c',{callerId:'bob',calleeId:'alice',status:'offer',offer:{type:'offer',sdp:'v=0'},privateKey:'hidden'});
  assert.deepEqual((await f.call(request('contact-in'))).rows.map(row=>row.id),['a']);assert.deepEqual((await f.call(request('contact-out'))).rows.map(row=>row.id),['b']);const room=(await f.call(request('room-in'))).rows[0];assert.equal(room.data.privateKey,undefined);assert.deepEqual(room.data.offer,{type:'offer',sdp:'v=0'});
});
test('page response bytes stop at a resumable cursor instead of truncating data or returning an oversized payload',async()=>{
  const f=fixture(),data={senderId:'bob',recipientId:'alice',timestamp:1,status:'sent',encryptedKey:Buffer.alloc(256).toString('base64'),encryptedPayload:Buffer.alloc(384*1024).toString('base64'),payloadIv:Buffer.alloc(12).toString('base64'),hasAttachment:false,attachmentName:null};for(let i=0;i<8;i++)f.docs.set('transmissions/'+i,data);
  const first=await f.call();assert.equal(first.rows.length,3);assert.equal(first.scanned,3);assert.equal(first.next.id,'2');const second=await f.call(request('relay-in',first.next));assert.equal(second.rows.length,3);assert.ok(Buffer.byteLength(JSON.stringify(first))<=contract.COMMS_LIST_MAX_RESPONSE_BYTES);
});
test('transient Auth failure fails the page and cannot be presented as an empty successful inbox',async()=>{
  const f=fixture();f.docs.set('transmissions/a',capsule());f.onAuth(uid=>{if(uid==='bob')throw Error('Synthetic outage');});await assert.rejects(f.call());
});
test('cursor accepts a long unavailable document boundary and uses Firestore UTF-8 ordering for Unicode IDs',()=>{
  const input=request(),long='z'.repeat(500);const page=contract.parseCommsListPage({uid:'alice',kind:'relay-in',rows:[],next:{uid:'alice',kind:'relay-in',id:long},unavailable:25,scanned:25},input);assert.equal(page.next.id,long);assert.ok(contract.compareCommsDocumentIds('\uE000','\u{10000}')<0);
  const before=request('relay-in',{uid:'alice',kind:'relay-in',id:'\uE000'}),data=capsule();delete data.secretExtra;assert.equal(contract.parseCommsListPage({uid:'alice',kind:'relay-in',rows:[{id:'\u{10000}',data}],next:null,unavailable:0,scanned:1},before).rows.length,1);
});

const directoryKey=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey;
const directoryPem=`-----BEGIN PUBLIC KEY-----\n${directoryKey.export({type:'spki',format:'der'}).toString('base64')}\n-----END PUBLIC KEY-----`;
function directoryFixture(count=31){
  const f=fixture();
  for(let i=0;i<count;i++){
    const peer='peer'+String(i).padStart(3,'0');f.users.set(peer,{uid:peer,disabled:false,email:peer==='peer030'?'peer@example.invalid':peer+'@example.invalid',emailVerified:true});
    f.docs.set('users/'+peer,{uid:peer,publicKeyPem:directoryPem,privateExtra:'hidden'});
    f.docs.set('publicProfiles/'+peer,{uid:peer,displayName:'Synthetic '+peer,publicKeyPem:directoryPem,email:'hidden@example.invalid'});
    f.docs.set('friendRequests/z'+String(i).padStart(3,'0'),{fromUid:i%2?peer:'alice',toUid:i%2?'alice':peer,status:'accepted',createdAt:1,updatedAt:2,publicKeyPem:'obsolete',privateExtra:'hidden'});
  }
  for(let i=0;i<100;i++)f.docs.set('friendRequests/a'+i,{fromUid:'alice',toUid:'bob',status:'pending',createdAt:1,updatedAt:2});
  f.deps.auth.getUserByEmail=async email=>{if(email!=='peer@example.invalid'){const error=Error();error.code='auth/user-not-found';throw error;}return f.users.get('peer030');};
  return f;
}
test('accepted directory merges both directions independently of pending pages and joins only the current public key',async()=>{
  const f=directoryFixture(),first=await f.call(request('contact-directory')),last=await f.call(request('contact-directory',first.next));
  assert.equal(first.rows.length,25);assert.equal(first.scanned,25);assert.equal(first.next.id,'z024');assert.equal(last.rows.length,6);assert.equal(last.next,null);
  assert.equal(new Set([...first.rows,...last.rows].map(row=>row.id)).size,31);
  assert.equal(first.rows[0].data.fingerprint,createHash('sha256').update(directoryPem).digest('hex'));
  assert.equal(first.rows[0].data.publicKeyPem,directoryPem);assert.equal(first.rows[0].data.email,undefined);assert.equal(first.rows[0].data.privateExtra,undefined);
  assert.ok(f.queries.every(query=>query.state.limit===26&&query.state.filters.some(filter=>filter.field==='status'&&filter.value==='accepted')));
});
test('directory isolates unavailable peers and rejects late relationship revocation or key/profile disagreement',async()=>{
  const f=directoryFixture(5);f.users.get('peer000').disabled=true;f.docs.set('accountDeletions/peer001',{status:'complete'});f.docs.get('publicProfiles/peer002').publicKeyPem='invalid';
  f.onAuth(uid=>{if(uid==='peer003')f.docs.get('friendRequests/z003').status='rejected';});
  const page=await f.call(request('contact-directory'));assert.equal(page.unavailable,4);assert.deepEqual(page.rows.map(row=>row.data.uid),['peer004']);
  f.docs.get('users/peer004').publicKeyPem='different';assert.equal((await f.call(request('contact-directory'))).rows.length,0);
});
test('directory does not turn an Auth outage or account deletion into a successful empty roster',async()=>{
  const f=directoryFixture(1);f.onAuth(uid=>{if(uid==='peer000')throw Error('Synthetic outage');});await assert.rejects(f.call(request('contact-directory')));
  f.onAuth(uid=>{if(uid==='peer000')f.docs.set('accountDeletions/alice',{status:'complete'});});await assert.rejects(f.call(request('contact-directory')),{code:'permission-denied'});
});
test('exact UID/email search reaches an accepted contact beyond the first page without returning outsiders',async()=>{
  const f=directoryFixture(),search=lookup=>({...request('contact-search'),lookup});
  assert.deepEqual((await f.call(search('peer030'))).rows.map(row=>row.data.uid),['peer030']);
  assert.deepEqual((await f.call(search(' PEER@EXAMPLE.INVALID '))).rows.map(row=>row.data.uid),['peer030']);
  for(const lookup of['bob','alice','missing','missing@example.invalid'])assert.equal((await f.call(search(lookup))).rows.length,0);
  assert.ok(f.queries.filter(query=>query.state.filters.length===3).every(query=>query.state.filters.some(filter=>filter.value==='peer030')||query.state.filters.some(filter=>filter.value==='bob')||query.state.filters.some(filter=>filter.value==='missing')));
});
test('search cursor binds normalized lookup and resolved email UID, including historical duplicate relationships',async()=>{
  const f=directoryFixture(1),data=f.docs.get('friendRequests/z000');for(let i=0;i<30;i++)f.docs.set('friendRequests/x'+String(i).padStart(3,'0'),data);
  f.users.get('peer000').email='same@example.invalid';f.deps.auth.getUserByEmail=async()=>f.users.get('peer000');const input={...request('contact-search'),lookup:'same@example.invalid'};
  const first=await f.call(input);assert.equal(first.next.targetUid,'peer000');assert.equal(first.next.lookup,input.lookup);
  assert.equal((await f.call({...input,after:first.next})).rows.length,6);
  await assert.rejects(f.call({...input,lookup:'other@example.invalid',after:first.next}),{code:'invalid-argument'});
  f.users.get('bob').email='same@example.invalid';f.deps.auth.getUserByEmail=async()=>f.users.get('bob');await assert.rejects(f.call({...input,after:first.next}),{code:'aborted'});
  assert.throws(()=>contract.parseCommsListRequest(request('contact-directory',first.next)));
});
test('email directory search refuses unverified and changed Auth addresses without returning an empty success or contact rows',async()=>{
  const input={...request('contact-search'),lookup:'peer@example.invalid'};
  for(const patch of [{emailVerified:false},{emailVerified:undefined},{emailVerified:'true'},{email:'other@example.invalid'}]){const f=directoryFixture();Object.assign(f.users.get('peer030'),patch);const before=JSON.stringify([...f.docs]);await assert.rejects(f.call(input),{code:'failed-precondition'});assert.equal(JSON.stringify([...f.docs]),before);}
  const f=directoryFixture();let reads=0;f.onAuth(uid=>{if(uid==='peer030'&&++reads>=2)f.users.get(uid).emailVerified=false;});await assert.rejects(f.call(input),{code:'failed-precondition'});
});
test('accepted directory manifest declares status and exact-pair composite indices for both directions',()=>{
  const indices=require('../../firestore.indexes.json').indexes.filter(index=>index.collectionGroup==='friendRequests');
  for(const fields of[['fromUid','status'],['toUid','status'],['fromUid','toUid','status']])assert.ok(indices.some(index=>index.fields.map(field=>field.fieldPath).join(',')===fields.join(',')));
});
test('accepted search rejects malformed authority before Auth and validates a single response target',async()=>{
  const f=directoryFixture(2);let authCalls=0;f.onAuth(()=>authCalls++);
  const input={...request('contact-search'),lookup:'peer000'},cursor={uid:'alice',kind:'contact-search',lookup:'peer000',targetUid:'peer000',id:'a'};
  for(const value of[{...input,lookup:'invalid/uid'},{...input,extra:true},{...input,after:{...cursor,uid:'bob'}},{...input,after:{...cursor,targetUid:'alice'}},{...input,after:{...cursor,kind:'contact-directory'}}])await assert.rejects(f.call(value),{code:'invalid-argument'});
  assert.equal(authCalls,0);assert.equal(f.queries.length,0);
  const directory=await f.call(request('contact-directory'));
  assert.throws(()=>contract.parseCommsListPage({...directory,kind:'contact-search'},input));
  assert.throws(()=>contract.parseCommsListPage({...directory,kind:'contact-search'},{...input,lookup:'peer@example.invalid'}));
});
