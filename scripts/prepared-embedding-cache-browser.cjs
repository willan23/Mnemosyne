'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend');
const {build}=require(path.join(frontend,'node_modules/esbuild')),{chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
const source=`
import {PreparedEmbeddingSearchCache} from './src/services/preparedEmbeddingSearchCache';
import {searchSelectedEmbeddingProfile} from './src/services/selectedEmbeddingSearch';
import {embeddingReindexStore as store} from './src/services/embeddingReindexStore';
import {embeddingProfileSpace} from './src/services/embeddingProfile';
import {encryptMemoryFields,setMemoryCryptoKeyForTests} from './src/services/memoryCrypto';
import {writeEmbeddingSelection,onEmbeddingSelectionChanged} from './src/services/embeddingSelection';
const key=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(7),'AES-GCM',false,['encrypt','decrypt']);
setMemoryCryptoKeyForTests(key);
const profile='multilingualCandidate',space=embeddingProfileSpace(profile),signal=()=>new AbortController().signal;
let memories=Array.from({length:64},(_,i)=>({id:'synthetic-'+i,uid:'alice',text:'Synthetic private memory '+i,timestamp:1,updatedAt:1}));
const put=async memory=>{const bytes=new TextEncoder().encode(JSON.stringify([memory.text,memory.title??null,memory.updatedAt]));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 await store.put(['alice',space,memory.id],await encryptMemoryFields({text:JSON.stringify({version:1,uid:'alice',memoryId:memory.id,space,sourceDigest:digest,vector:Array(384).fill(.25)})}));};
for(const memory of memories)await put(memory);
const cache=new PreparedEmbeddingSearchCache();let reads=0,selectionEvents=0;
const originalGet=store.get.bind(store);store.get=async key=>{reads++;return originalGet(key);};
const stop=onEmbeddingSelectionChanged('alice',()=>selectionEvents++);
const search=async text=>{const start=reads,t=performance.now();const result=await searchSelectedEmbeddingProfile('alice',profile,memories,text,signal(),
 async request=>new Map(request.candidates.map(item=>[item.id,.8])),cache);return{reads:reads-start,results:result.size,elapsedMs:Math.round((performance.now()-t)*100)/100};};
window.probe={search,selectionEvents:()=>selectionEvents,edit:async()=>{memories=[{...memories[0],text:'Edited synthetic private memory',updatedAt:2},...memories.slice(1)];await put(memories[0]);},
 aba:()=>{setMemoryCryptoKeyForTests(null);setMemoryCryptoKeyForTests(key);},
 missingThenPrepared:async()=>{const m={...memories[0],id:'later'};const first=await cache.read('alice',profile,m,signal());await put(m);const second=await cache.read('alice',profile,m,signal());return first===null&&second?.memoryId==='later';},
 foreignAndProfile:async()=>{const start=reads;const foreign=await cache.read('bob',profile,{...memories[0],uid:'bob'},signal());const other=await cache.read('alice','englishPinned',memories[0],signal());const own=await cache.read('alice',profile,memories[0],signal());return{isolated:foreign===null&&other===null&&own?.memoryId===memories[0].id,reads:reads-start};},
 ineligible:async()=>{for(const m of [{...memories[0],teamId:'crew'},{...memories[0],sharedWithIds:['bob']},{...memories[0],deletedAt:2},{...memories[0],encLocked:true}])if(await cache.read('alice',profile,m,signal())!==null)return false;return true;},
 pendingABA:async()=>{const m={...memories[0]};let release;const gate=new Promise(resolve=>release=resolve);let entered;
 const ready=new Promise(resolve=>entered=resolve);store.get=async k=>{store.get=async k=>{reads++;return originalGet(k);};reads++;const v=await originalGet(k);entered();await gate;return v;};
 const pending=cache.read('alice',profile,m,signal()).then(()=>false,()=>true);await ready;writeEmbeddingSelection('alice',null);writeEmbeddingSelection('alice',profile);release();return await pending;},
 corruptThenRepair:async()=>{const m={...memories[0],id:'corrupt'};await store.put(['alice',space,m.id],{v:1,iv:'synthetic-invalid',ct:'synthetic-invalid'});
 let refused=false;try{await cache.read('alice',profile,m,signal());}catch{refused=true;}await put(m);return refused&&(await cache.read('alice',profile,m,signal()))?.memoryId==='corrupt';},
 dispose:()=>{cache.dispose();stop();},
 rawPrivateContentAbsent:async()=>{const envelope=await originalGet(['alice',space,memories[0].id]);return !JSON.stringify(envelope).includes('private memory');}};
`;
async function main(){
  const bundle=await build({stdin:{contents:source,resolveDir:frontend,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent',plugins:[{name:'synthetic-auth-and-query-model-only',setup(b){
    b.onResolve({filter:/.*/},args=>{if(!args.path.startsWith('.'))return;const p=path.resolve(args.resolveDir,args.path).replaceAll('\\','/');
      if(p===path.join(frontend,'src/firebase').replaceAll('\\','/'))return{path:'firebase',namespace:'fixture'};
      if(p===path.join(frontend,'src/services/embeddingService').replaceAll('\\','/'))return{path:'embedding',namespace:'fixture'};});
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='firebase'?'export const db={};export const auth={currentUser:{uid:"alice"}};export default{};':
      'const service={getEmbedding:async()=>Array(384).fill(.25),clearCache:()=>{}};export const embeddingService=service;export const embeddingServiceForProfile=()=>service;'}));
  }}]});
  const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic checkpoint cache</title>'+(req.url==='/'?'<script type="module" src="/bundle.js"></script>':''));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,externalRequests=0;
  try{
    const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const context=await browser.newContext();
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){externalRequests++;return route.abort();}return route.continue();});
    const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>Boolean(window.probe));
    const first=await page.evaluate(()=>window.probe.search('first synthetic query'));assert.equal(first.reads,64);assert.equal(first.results,64);
    const repeated=await page.evaluate(()=>window.probe.search('different synthetic query'));assert.equal(repeated.reads,0);assert.equal(repeated.results,64);
    await page.evaluate(()=>window.probe.edit());const edited=await page.evaluate(()=>window.probe.search('edited query'));assert.equal(edited.reads,1);assert.equal(edited.results,64);
    assert.equal(await page.evaluate(()=>window.probe.missingThenPrepared()),true);assert.equal(await page.evaluate(()=>window.probe.ineligible()),true);
    assert.equal(await page.evaluate(()=>window.probe.corruptThenRepair()),true);
    await page.evaluate(()=>window.probe.aba());const vaultChanged=await page.evaluate(()=>window.probe.search('after vault ABA'));assert.equal(vaultChanged.reads,64);
    const other=await context.newPage();await other.goto(origin+'/other');const before=await page.evaluate(()=>window.probe.selectionEvents());
    await other.evaluate(()=>localStorage.setItem('mnemosyne.embedding.selection.v1.alice',JSON.stringify({generation:crypto.randomUUID()})));
    await page.waitForFunction(previous=>window.probe.selectionEvents()>previous,before);
    const crossTab=await page.evaluate(()=>window.probe.search('after cross tab change'));assert.equal(crossTab.reads,64);
    assert.equal(await page.evaluate(()=>window.probe.pendingABA()),true);
    const scopes=await page.evaluate(()=>window.probe.foreignAndProfile());assert.equal(scopes.isolated,true);assert.equal(scopes.reads,3);
    assert.equal(await page.evaluate(()=>window.probe.rawPrivateContentAbsent()),true);
    await page.evaluate(()=>window.probe.dispose());await page.reload();await page.waitForFunction(()=>Boolean(window.probe));
    const reload=await page.evaluate(()=>window.probe.search('after reload'));assert.equal(reload.reads,64);assert.equal(reload.results,64);
    await page.evaluate(()=>window.probe.dispose());assert.equal(externalRequests,0);await context.close();
    console.log(JSON.stringify({v:1,passed:true,records:64,actualAESGCM:true,actualIndexedDB:true,actualSelectedSearchAndCache:true,syntheticAuthQueryVectorsAndRanking:true,
      reads:{first:first.reads,repeated:repeated.reads,oneEdit:edited.reads,vaultABA:vaultChanged.reads,crossTab:crossTab.reads,reload:reload.reads},
      timingsMs:{first:first.elapsedMs,repeated:repeated.elapsedMs,oneEdit:edited.elapsedMs},missingReadNotCached:true,corruptReadRefusedAndRepairable:true,
      teamSharedLockedDeletedExcluded:true,pendingSelectionABARefused:true,accountAndProfileIsolation:true,cacheNotPersistedAcrossReload:true,
      externalRequests,productionMutations:0,generativeProviderCalls:0,secretPayloadReads:0}));
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(JSON.stringify({error:'prepared_cache_browser_failed',type:error?.name,diagnostic:error?.message?.slice(0,240)}));process.exitCode=1;});
