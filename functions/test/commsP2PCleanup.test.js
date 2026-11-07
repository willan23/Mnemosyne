'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,id,other,third}=require('./fixtures/commsP2PFixture');
const {cleanupExpiredCommsP2PRoom}=require('../lib/commsP2PCleanup');

test('expired signaling is deleted atomically with both candidate collections while receipts and quotas survive',async()=>{
  const f=fixture();await f.apply();await f.apply(f.request('answer','bob'));await f.apply(f.request('candidate','alice',third));
  const before=JSON.stringify([...f.docs].filter(([name])=>!name.startsWith('p2pRooms/')));f.setNow(601000);
  assert.equal(await cleanupExpiredCommsP2PRoom(id,f.deps),true);assert.equal([...f.docs.keys()].some(name=>name.startsWith('p2pRooms/')),false);
  assert.equal(JSON.stringify([...f.docs].filter(([name])=>!name.startsWith('p2pRooms/'))),before);
  const status=await f.status();assert.equal(status.status,'applied');assert.equal(status.roomStatus,'unknown');
  assert.equal((await f.read()).status,'unknown');assert.equal(await cleanupExpiredCommsP2PRoom(id,f.deps),false);
});
test('expiry boundary and overlapping retries cannot purge a live room',async()=>{
  const f=fixture();await f.apply();f.setNow(600999);assert.equal(await cleanupExpiredCommsP2PRoom(id,f.deps),false);assert.equal(f.docs.has('p2pRooms/'+id),true);
  f.setNow(601000);assert.deepEqual(await Promise.all(Array.from({length:4},()=>cleanupExpiredCommsP2PRoom(id,f.deps))),[true,false,false,false]);
});
test('malformed metadata and unknown legacy rooms are retained without partially deleting candidates',async()=>{
  const f=fixture();await f.apply();await f.apply(f.request('candidate'));f.setNow(601000);const ref='p2pRooms/'+id,row=f.docs.get(ref);f.docs.set(ref,{...row,expiresAt:5000});
  const before=JSON.stringify([...f.docs]);await assert.rejects(cleanupExpiredCommsP2PRoom(id,f.deps));assert.equal(JSON.stringify([...f.docs]),before);
  f.docs.set(ref,{...row,v:1});assert.equal(await cleanupExpiredCommsP2PRoom(id,f.deps),false);assert.equal(f.docs.has(ref+'/callerCandidates/'+other),true);
});
test('candidate overflow aborts root and child deletion and invalid clocks fail closed',async()=>{
  const f=fixture();await f.apply();f.setNow(601000);for(let i=0;i<65;i++)f.docs.set('p2pRooms/'+id+'/callerCandidates/'+i,{candidate:'Synthetic retained'});
  const before=JSON.stringify([...f.docs]);await assert.rejects(cleanupExpiredCommsP2PRoom(id,f.deps));assert.equal(JSON.stringify([...f.docs]),before);
  f.setNow(NaN);await assert.rejects(cleanupExpiredCommsP2PRoom(id,f.deps));assert.equal(await cleanupExpiredCommsP2PRoom('../outside',f.deps),false);
});
