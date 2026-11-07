const {test}=require('node:test'),assert=require('node:assert/strict'),admin=require('firebase-admin');
const {executeGetOwnedCapsules,CAPSULE_OWNER_READS_PER_DAY}=require('../lib/capsuleOwner');
function fixture(count=45){
  const state={now:1000000,disabled:false,queryFields:[],queryReads:0,generation:1},docs=new Map([['users/alice',{}]]);
  for(let index=0;index<count;index++)docs.set(`shares/a${String(index).padStart(3,'0')}`,{uid:'alice',createdAt:1,expiresAt:2e6,views:0,importCount:0,itemCount:1,ciphertext:{private:'SYNTHETIC_PRIVATE_CIPHER'},titleHint:'SYNTHETIC_PRIVATE_TITLE'});
  docs.set('shares/foreign',{uid:'bob',titleHint:'SYNTHETIC_FOREIGN_TITLE'});
  const ref=path=>({path}),snapshot=(ref,fields)=>({id:ref.path.split('/').at(-1),exists:docs.has(ref.path),createTime:new admin.firestore.Timestamp(1,state.generation),data:()=>{
    const value=docs.get(ref.path);return !value?undefined:fields?Object.fromEntries(fields.filter(key=>key in value).map(key=>[key,structuredClone(value[key])])):structuredClone(value);
  }});
  function query(){const result={kind:'query',owner:null,after:null,fields:null,max:0,where(field,operator,value){assert.equal(field,'uid');assert.equal(operator,'==');this.owner=value;return this;},orderBy(){return this;},select(...fields){this.fields=fields;return this;},startAfter(value){this.after=value;return this;},limit(value){this.max=value;return this;}};return result;}
  let tail=Promise.resolve();const db={doc:ref,collection:name=>{assert.equal(name,'shares');return query();},runTransaction:body=>{
    const result=tail.then(async()=>{const writes=[],tx={get:async value=>{if(value.kind==='query'){
      state.queryReads++;state.queryFields.push(value.fields);assert.equal(value.max,41);
      return{docs:[...docs].filter(([path,data])=>path.startsWith('shares/')&&data.uid===value.owner&&(!value.after||path.split('/').at(-1)>value.after)).sort(([a],[b])=>a<b?-1:1).slice(0,value.max).map(([path])=>snapshot(ref(path),value.fields))};}
      return snapshot(value);},getAll:async(...values)=>values.map(value=>snapshot(value)),set:(ref,data)=>writes.push([ref.path,data])};const output=await body(tx);for(const[path,data]of writes)docs.set(path,data);return output;});tail=result.catch(()=>{});return result;
  }};
  const deps={firestore:db,now:()=>state.now,auth:{getUser:async uid=>({uid,disabled:state.disabled})}},request=(extra={})=>({v:1,actorUid:'alice',shareId:null,after:null,...extra});
  return{state,docs,deps,request,call:input=>executeGetOwnedCapsules('alice',input,deps),dump:()=>JSON.stringify([...docs])};
}
test('owner pages are projected, bounded, complete across cursors and expose no foreign data or ciphertext',async()=>{
  const f=fixture(),first=await f.call(f.request());assert.equal(first.rows.length,40);assert.equal(first.nextAfter,'a039');
  const second=await f.call(f.request({after:first.nextAfter}));assert.equal(second.rows.length,5);assert.equal(second.nextAfter,null);
  assert.equal(new Set([...first.rows,...second.rows].map(row=>row.shareId)).size,45);assert(!JSON.stringify([first,second]).includes('SYNTHETIC_'));
  assert(f.state.queryFields.every(fields=>!fields.includes('ciphertext')&&!fields.includes('titleHint')));
  assert.equal((await f.call(f.request({shareId:'foreign'}))).rows.length,0);assert.equal((await f.call(f.request({shareId:'absent'}))).rows.length,0);
});
test('owner source tokens change on recreation while legacy counters and dates remain unknown',async()=>{
  const f=fixture(1),first=(await f.call(f.request({shareId:'a000'}))).rows[0];
  f.state.generation++;Object.assign(f.docs.get('shares/a000'),{views:'unknown',createdAt:'unknown',expiresAt:'unknown',itemCount:-1,revokedAt:'unknown'});
  const second=(await f.call(f.request({shareId:'a000'}))).rows[0];assert.notEqual(second.sourceToken,first.sourceToken);
  assert.equal(second.views,null);assert.equal(second.createdAt,null);assert.equal(second.expiresAt,null);assert.equal(second.itemCount,null);assert.equal(second.revoked,true);assert.equal(second.revokedAt,null);
});
test('owner read budget serializes its final slot and refuses malformed counters before reading a page',async()=>{
  const f=fixture(1),path='capsuleOwnerReadBudgets/alice_0';f.docs.set(path,{v:1,uid:'alice',day:0,reads:CAPSULE_OWNER_READS_PER_DAY-1});
  const outcomes=await Promise.allSettled([f.call(f.request()),f.call(f.request())]);assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(f.docs.get(path).reads,200);assert.equal(f.state.queryReads,1);
  f.docs.set(path,{v:1,uid:'bob',day:0,reads:0});const before=f.dump();await assert.rejects(f.call(f.request()),{code:'resource-exhausted'});assert.equal(f.dump(),before);assert.equal(f.state.queryReads,1);
});
test('owner queries bind actor, refuse extra fields and never release metadata after account revocation',async()=>{
  for(const reason of['actor','extra','marker','disabled']){const f=fixture(1),input=f.request();if(reason==='actor')input.actorUid='bob';if(reason==='extra')input.limit=999;
    if(reason==='marker')f.docs.set('accountDeletions/alice',{});if(reason==='disabled')f.state.disabled=true;
    const before=f.dump();await assert.rejects(f.call(input));assert.equal(f.dump(),before);assert.equal(f.state.queryReads,0);
  }
  const f=fixture(1);f.docs.delete('users/alice');assert.equal((await f.call(f.request())).rows.length,1);
});
