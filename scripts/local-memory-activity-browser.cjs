'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend');
const {build}=require(path.join(frontend,'node_modules/esbuild')),{chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
const source=`import React from 'react';import{createRoot}from'react-dom/client';
import*as api from'./src/services/localMemoryActivity';import{localMemoryActivityStore as store}from'./src/services/localMemoryActivityStore';
import*as vault from'./src/services/memoryCrypto';import{LocalMemoryActivityPanel}from'./src/components/LocalMemoryActivityPanel';import{useUniverseStore}from'./src/store/universeStore';
useUniverseStore.setState({language:'en'});const key=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(7),{name:'AES-GCM'},false,['encrypt','decrypt']);vault.setMemoryCryptoKeyForTests(key);
let now=Date.now(),release=null,held=false,pending=null,rendered=null;const deps={store,encrypt:vault.encryptMemoryFields,decrypt:vault.decryptMemoryEnvelope,now:()=>now,id:()=>crypto.randomUUID()};
const row=(n)=>({id:crypto.randomUUID(),kind:'retrieve',operation:'search',at:now,resultCount:n});
const actor=uid=>{window.testAuth.uid=uid;for(const change of [...window.testAuth.observers])change({uid});if(rendered)rendered.render(React.createElement(LocalMemoryActivityPanel,{uid,key:uid}));};
window.activity={api,store,deps,row,append:async n=>api.appendLocalMemoryActivity(window.testAuth.uid,[row(n)],deps),load:()=>api.loadLocalMemoryActivity(window.testAuth.uid,deps),
raw:async uid=>JSON.stringify(await store.get(uid)),body:async uid=>{const value=await store.get(uid);return value?JSON.parse((await vault.decryptMemoryEnvelope(value.enc)).text):null;},
actor,mount:()=>{rendered=createRoot(document.getElementById('root'));rendered.render(React.createElement(LocalMemoryActivityPanel,{uid:window.testAuth.uid}));},
hold:()=>{held=false;const original=deps.encrypt;deps.encrypt=async value=>{deps.encrypt=original;held=true;await new Promise(resolve=>{release=resolve;});return original(value);};},
start:()=>{pending=api.appendLocalMemoryActivity(window.testAuth.uid,[row(9)],deps).then(()=>true,()=>false);},held:()=>held,release:async()=>{release();return pending;},
vaultABA:()=>{vault.setMemoryCryptoKeyForTests(null);vault.setMemoryCryptoKeyForTests(key);},lock:()=>vault.setMemoryCryptoKeyForTests(null),advance:()=>{now+=api.LOCAL_ACTIVITY_RETENTION_MS+1;},
lostAck:async()=>{const value=row(3),original=store.compareExchange;store.compareExchange=async(...args)=>{store.compareExchange=original;await original(...args);throw Error('Synthetic lost ACK');};let failed=false;try{await api.appendLocalMemoryActivity(window.testAuth.uid,[value],deps);}catch{failed=true;}await api.appendLocalMemoryActivity(window.testAuth.uid,[value],deps);return failed;},
holdRead:()=>{held=false;const original=store.get;store.get=async uid=>{store.get=original;const value=await original(uid);held=true;await new Promise(resolve=>{release=resolve;});return value;};},
releaseRead:()=>release(),observers:()=>window.testAuth.observers.size};`;
async function main(){
  const bundle=await build({stdin:{contents:source,resolveDir:frontend,loader:'tsx'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',logLevel:'silent',plugins:[{name:'synthetic-auth',setup(b){
    b.onResolve({filter:/.*/},args=>{if(args.path==='firebase/auth')return{path:'auth',namespace:'fixture'};
      if(args.path.startsWith('.')&&path.resolve(args.resolveDir,args.path).replaceAll('\\','/')===path.join(frontend,'src/firebase').replaceAll('\\','/'))return{path:'firebase',namespace:'fixture'};});
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='firebase'?`export const auth={get currentUser(){return{uid:window.testAuth.uid};}};export const db={};export default{};`:
      `export function onAuthStateChanged(auth,callback){window.testAuth.observers.add(callback);queueMicrotask(()=>callback(auth.currentUser));return()=>window.testAuth.observers.delete(callback);}`}));
  }}]});
  const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><script>window.testAuth={uid:"alice",observers:new Set()};</script><script type="module" src="/bundle.js"></script>');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,externalRequests=0;
  try{
    const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const context=await browser.newContext({acceptDownloads:true});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){externalRequests++;return route.abort();}return route.continue();});
    const page=await context.newPage(),other=await context.newPage();for(const p of [page,other]){await p.goto(origin);await p.waitForFunction(()=>Boolean(window.activity));}
    await page.evaluate(()=>window.activity.append(1));let stored=await page.evaluate(()=>window.activity.raw('alice'));
    assert(!stored.includes('retrieve')&&!stored.includes('resultCount')&&!stored.includes('operation'));
    assert.deepEqual(Object.keys(JSON.parse(stored)).sort(),['enc','reset','revision','uid','v']);
    await page.reload();await page.waitForFunction(()=>Boolean(window.activity));assert.equal((await page.evaluate(()=>window.activity.load())).length,1);
    await Promise.all([page.evaluate(()=>window.activity.append(2)),other.evaluate(()=>window.activity.append(4))]);assert.equal((await page.evaluate(()=>window.activity.load())).length,3);
    assert.equal(await page.evaluate(()=>window.activity.lostAck()),true);assert.equal((await page.evaluate(()=>window.activity.load())).length,4);
    await page.evaluate(()=>{window.activity.hold();window.activity.start();});await page.waitForFunction(()=>window.activity.held());
    await other.evaluate(()=>window.activity.api.clearLocalMemoryActivity('alice',window.activity.deps));assert.equal(await page.evaluate(()=>window.activity.release()),false);assert.equal((await page.evaluate(()=>window.activity.load())).length,0);
    for(const change of ['account','vault']){await page.evaluate(()=>{window.activity.hold();window.activity.start();});await page.waitForFunction(()=>window.activity.held());
      await page.evaluate(mode=>{if(mode==='account'){window.activity.actor('bob');window.activity.actor('alice');}else window.activity.vaultABA();},change);
      assert.equal(await page.evaluate(()=>window.activity.release()),false);assert.equal((await page.evaluate(()=>window.activity.load())).length,0);
    }
    await page.evaluate(()=>window.activity.append(7));await page.evaluate(()=>window.activity.mount());await page.getByRole('button',{name:'View activity',exact:true}).click();await page.getByText('Search: 7 result(s)',{exact:false}).waitFor();
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export records',exact:true}).click();const download=await downloadPromise,stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const exported=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(exported.events.length,1);assert.deepEqual(Object.keys(exported.events[0]).sort(),['id','kind','operation','at','resultCount'].sort());
    let downloads=0;page.on('download',()=>downloads++);await page.getByRole('button',{name:'Export records',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>!document.querySelector('button[disabled]'));
    await page.evaluate(()=>window.activity.holdRead());await page.getByRole('button',{name:'Export records',exact:true}).click();await page.waitForFunction(()=>window.activity.held());
    await page.evaluate(()=>{window.activity.actor('bob');window.activity.actor('alice');window.activity.releaseRead();});
    await page.waitForFunction(()=>window.activity.observers()===1);assert.equal(downloads,0);
    await page.evaluate(()=>{window.activity.actor('bob');});await page.evaluate(()=>window.activity.append(8));const bob=await page.evaluate(()=>window.activity.raw('bob'));
    assert.equal(await page.evaluate(async()=>{window.activity.actor('alice');const original=await window.activity.store.get('alice'),foreign=await window.activity.store.get('bob'),copy={...foreign,uid:'alice'};
      await window.activity.store.compareExchange('alice',JSON.stringify(original),copy,()=>{});let rejected=false;try{await window.activity.load();}catch{rejected=true;}
      const unchanged=await window.activity.raw('alice')===JSON.stringify(copy);await window.activity.store.compareExchange('alice',JSON.stringify(copy),original,()=>{});return rejected&&unchanged;}),true);
    await page.evaluate(()=>window.activity.advance());assert.equal((await page.evaluate(()=>window.activity.load())).length,0);assert.equal((await page.evaluate(()=>window.activity.body('alice'))).events.length,0);
    await page.evaluate(()=>{window.activity.lock();return window.activity.store.remove('alice',()=>{if(window.testAuth.uid!=='alice')throw Error('actor');});});assert.equal(await page.evaluate(()=>window.activity.raw('alice')),undefined);assert.equal(await page.evaluate(()=>window.activity.raw('bob')),bob);
    assert.equal(externalRequests,0);await context.close();console.log(JSON.stringify({v:1,actualAESGCM:true,actualIndexedDB:true,actualPanelAndDownload:true,
      reloadPersistence:true,crossTabCASMerge:true,lostAckDedupe:true,clearFencesPendingAppend:true,accountAndVaultABARefuse:true,lateExportCannotDownload:true,
      expiredRecordsPruned:true,foreignUidCiphertextRefusedWithoutOverwrite:true,ownDeletionPreservesOtherAccount:true,syntheticAuthAndKeyOnly:true,externalRequests,productionMutations:0,generativeProviderCalls:0,secretPayloadReads:0}));
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(JSON.stringify({error:'local_activity_browser_failed',type:error?.name,diagnostic:error?.message?.slice(0,240)}));process.exitCode=1;});
