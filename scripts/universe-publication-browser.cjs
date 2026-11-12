'use strict';
// Real store/controller and compiled Worker under desktop CSP; synthetic data, no Auth/model.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{build}=require(root+'/frontend/node_modules/esbuild'),{chromium}=require(root+'/frontend/node_modules/playwright');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const names=fs.readdirSync(root+'/frontend/dist/assets').filter(name=>/^indexedSemanticWriteWorker-[\w-]+\.js$/.test(name));assert.equal(names.length,1,'Build frontend first');
 const workerBytes=fs.readFileSync(root+'/frontend/dist/assets/'+names[0]);
 const bundle=await build({stdin:{contents:"export {useUniverseStore} from '../store/universeStore';export {UniverseMemoryPublication} from './universeMemoryPublication';export {IncrementalMemoryPublication} from './incrementalMemoryPublication';export {IndexedSemanticWriteCorpus,selectIndexedSemanticWriteNeighbors} from './indexedSemanticWriteCorpus';export {semanticCandidateEligibility} from './semanticWriteScope';export {CURRENT_EMBEDDING_SPACE} from './embeddingModel';export {memorySnapshotDelta} from './memorySnapshot';",resolveDir:root+'/frontend/src/services',loader:'ts'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'});
 const clientBytes=bundle.outputFiles[0].contents,csp=JSON.parse(fs.readFileSync(root+'/frontend/src-tauri/tauri.conf.json')).app.security.csp;
 const server=http.createServer((req,res)=>{if(!['/','/client.js','/indexedSemanticWriteWorker.ts'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/'?'<!doctype html><title>Synthetic Universe publication</title>':req.url==='/client.js'?clientBytes:workerBytes);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const external=[],exceptions=[];
 try{
  const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('pageerror',error=>exceptions.push(error.name));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(new URL(route.request().url()).origin);return route.abort();});await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const {useUniverseStore,UniverseMemoryPublication,IncrementalMemoryPublication,IndexedSemanticWriteCorpus,selectIndexedSemanticWriteNeighbors,semanticCandidateEligibility,CURRENT_EMBEDDING_SPACE,memorySnapshotDelta}=await import('/client.js');
   const check=(ok,code)=>{if(!ok)throw Error(code);},NativeWorker=window.Worker,messages=[];let created=0,terminated=0,vectorReads=0,sourceIterations=0,current=true,sequence=0,deniedReads=0;
   class MeasuredWorker extends NativeWorker{
    constructor(url,options){super(url,options);created++;}
    postMessage(message){const json=JSON.stringify(message);check(!/Synthetic plaintext|DENIED-PLAINTEXT/.test(json),'plaintext_in_worker');messages.push({type:message.type,records:message.type==='patch-chunk'?message.changed.length:0});super.postMessage(message);}
    terminate(){terminated++;super.terminate();}
   }
   window.Worker=MeasuredWorker;
   const publication=new IncrementalMemoryPublication('asc',{sourceBase:2}),semantic=new IndexedSemanticWriteCorpus({uid:'actor',teamIds:new Set()},id=>publication.get(id),undefined,{direction:'asc',sourceBase:2});
   const ordered=publication.orderedValues.bind(publication);publication.orderedValues=(...args)=>{sourceIterations++;return ordered(...args);};
   const owner=new UniverseMemoryPublication({uid:'actor',publication,semantic,isCurrent:()=>current,teams:()=>new Set(),changed:()=>{},tombstones:new Set(),deletions:new Map()});
   const publish=()=>{const view=owner.snapshot();useUniverseStore.getState().loadMemories(view);return view;};
   const apply=(key,patch)=>{owner.observedSnapshot(key,++sequence);owner.apply(key,patch,new Map(patch.changed.map(({id,value})=>[id,{memory:value,tombstone:!value,revision:value?.persistedUpdatedAt??20}])),sequence);return publish();};
   const row=(id,timestamp,revision=10)=>({id,uid:'actor',text:'Synthetic plaintext',timestamp,updatedAt:revision,persistedUpdatedAt:revision,persistedStateDigest:'a'.repeat(64),persistedTitle:null,celestialType:'planet',position:[0,0,0],importance:.5,connections:[],embeddingModel:CURRENT_EMBEDDING_SPACE,get embedding(){vectorReads++;return Array.from({length:384},(_,i)=>i===0?1:0);}});
   const query=()=>{const result=selectIndexedSemanticWriteNeighbors([1,...Array(383).fill(0)],useUniverseStore.getState().memories,{eligible:semanticCandidateEligibility('actor')});check(result,'missing_index_binding');return result;};
   const times={},timed=async(name,job)=>{const at=performance.now(),result=await job();times[name]=Math.round((performance.now()-at)*100)/100;return result;};
   let ticks=0,last=performance.now(),gap=0;const heartbeat=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;ticks++;},10);
   try{
    const values=Array.from({length:10000},(_,index)=>row('row'+index,index));
    const initial=apply('personal',{changed:values.map(value=>({id:value.id,value})),removed:[],order:{reset:values.map(value=>value.id),changes:[]}});
    check(!Array.isArray(initial)&&initial.length===10000,'persistent_store');check((await timed('initialQuery',query)).count===10000&&vectorReads===10000,'initial_index');
    const changed=row('row5000',20000),edited=apply('personal',{changed:[{id:changed.id,value:changed}],removed:[],order:{changes:[]}});
    check(initial.get(changed.id)===values[5000]&&edited.get(changed.id)===changed,'immutable_roots');check(memorySnapshotDelta(initial,edited).changed.length===1,'single_delta');
    const at=vectorReads;check((await timed('editQuery',query)).count===10000&&vectorReads-at===1,'single_projection');
    const creation=owner.created(row('placeholder',30000),'confirmed');useUniverseStore.getState().addMemory(row('confirmed',30000),creation);
    check((await timed('creationQuery',query)).count===10001,'creation_binding');
    const confirmed=row('confirmed',30000);apply('personal',{changed:[{id:confirmed.id,value:confirmed}],removed:[],order:{changes:[{id:confirmed.id,type:'added',oldIndex:-1,newIndex:10000}]}});
    const value=useUniverseStore.getState().memories.get('row5000'),deletion=owner.deleted(value,20);
    check(useUniverseStore.getState().startDeletion(value.id,'supernova',deletion),'animation_started');check(useUniverseStore.getState().memories.get(value.id).pendingDeletion,'animation_marker');
    check((await timed('stagedDeletionQuery',query)).count===10000,'animation_not_candidate');
    useUniverseStore.getState().removeMemory(value.id,deletion);
    apply('personal',{changed:[{id:value.id,value:row(value.id,20000,19)}],removed:[],order:{changes:[]}});
    check(!useUniverseStore.getState().memories.get(value.id)&&(await query()).count===10000,'stale_sdk_hidden');
    apply('personal',{changed:[{id:value.id,value:row(value.id,20000,21)}],removed:[],order:{changes:[]}});
    check(useUniverseStore.getState().memories.get(value.id).persistedUpdatedAt===21&&(await query()).count===10001,'newer_restore');
    useUniverseStore.getState().removeMemory(value.id,deletion);check(useUniverseStore.getState().memories.get(value.id),'old_receipt_rejected');
    const denied={...row('foreign',40000),uid:'other',get embedding(){deniedReads++;throw Error('DENIED-PLAINTEXT');}};
    apply('foreign',{changed:[{id:denied.id,value:denied}],removed:[],order:{reset:[denied.id],changes:[]}});check((await query()).count===10001&&deniedReads===0,'acl_before_vector');
    check(sourceIterations===0,'dense_source_iteration');check(Math.max(...messages.map(message=>message.records))<=128,'bounded_transfer');const retired=useUniverseStore.getState().memories;useUniverseStore.getState().loadMemories([]);current=false;owner.clear();publication.clear();semantic.clear();let rejected=false;try{retired.length;}catch{rejected=true;}check(rejected,'retired_roots');
    check(created===1&&terminated===1,'worker_lifetime');check(!localStorage.getItem('mnemosyne-universe-preferences').includes('Synthetic plaintext'),'plaintext_persisted');
    return{records:10000,dimensions:384,persistentStore:true,immutableRoots:true,creationBinding:true,deleteBinding:true,staleSdkHidden:true,newerRestoreAccepted:true,oldReceiptRejected:true,retiredRootsRejected:true,singleEditProjected:1,sourceIterations,deniedVectorReads:deniedReads,workersCreated:created,workersTerminated:terminated,maxTransferRecords:Math.max(0,...messages.map(message=>message.records)),heartbeatTicks:ticks,maxHeartbeatGapMs:Math.round(gap*100)/100,times};
   }finally{clearInterval(heartbeat);useUniverseStore.getState().loadMemories([]);owner.clear();publication.clear();semantic.clear();window.Worker=NativeWorker;}
  });
  assert.equal(external.length,0);assert.equal(exceptions.length,0);console.log(JSON.stringify({complete:true,result,externalRequests:external.length,pageErrors:exceptions.length,compiledWorker:{path:'frontend/dist/assets/'+names[0],sha256:hash(workerBytes)},clientBundleSha256:hash(clientBytes),cspSha256:hash(csp)}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
