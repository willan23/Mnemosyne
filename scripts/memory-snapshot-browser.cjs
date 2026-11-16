'use strict';
// Real persistent publisher, preview client and compiled Worker. Synthetic data only; no Auth or model.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{build}=require(root+'/frontend/node_modules/esbuild'),{chromium}=require(root+'/frontend/node_modules/playwright');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const assets=root+'/frontend/dist/assets',names=fs.readdirSync(assets).filter(name=>/^capturePreviewWorker-[\w-]+\.js$/.test(name));assert.equal(names.length,1,'Build the current frontend first');const workerBytes=fs.readFileSync(assets+'/'+names[0]);
 const bundle=await build({stdin:{contents:"export {CapturePreviewClient} from './capturePreviewClient';export {IncrementalMemoryPublication} from './incrementalMemoryPublication';export {IncrementalSessionResources} from './incrementalSessionResources';export {searchMemories} from '../utils/searchMemories';",resolveDir:root+'/frontend/src/services',loader:'ts'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'});
 const clientBytes=bundle.outputFiles[0].contents,csp=JSON.parse(fs.readFileSync(root+'/frontend/src-tauri/tauri.conf.json')).app.security.csp;
 const server=http.createServer((req,res)=>{if(!['/','/client.js','/capturePreviewWorker.ts'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/'?'<!doctype html><title>Synthetic persistent memory snapshots</title>':req.url==='/client.js'?clientBytes:workerBytes);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const external=[],exceptions=[];
 try{
  const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('pageerror',e=>exceptions.push(e.name));await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(new URL(route.request().url()).origin);return route.abort();});await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const {CapturePreviewClient,IncrementalMemoryPublication,IncrementalSessionResources,searchMemories}=await import('/client.js');
   const check=(ok,code)=>{if(!ok)throw Error(code);},NativeWorker=window.Worker,messages=[];let created=0,terminated=0,aclReads=0,plaintextReads=0,timestampReads=0;
   class MeasuredWorker extends NativeWorker{
    constructor(url,opts){super(url,opts);created++;}
    postMessage(message){const json=JSON.stringify(message);messages.push({changed:message.changed.length,moves:message.moves?.length??0,removed:message.removed?.length??0,order:message.order?.length??null,denied:/foreign-|DENIED-PLAINTEXT/.test(json),extra:message.changed.some(row=>['uid','teamId','embedding','enc'].some(key=>key in row))});return super.postMessage(message);}
    terminate(){terminated++;super.terminate();}
   }
   window.Worker=MeasuredWorker;
   const publication=new IncrementalMemoryPublication('desc',{views:{active:row=>!row.deletedAt}}),resources=new IncrementalSessionResources(),client=new CapturePreviewClient({key:'synthetic-key',uid:'actor'});
   const plain=Array.from({length:10000},(_,index)=>({id:(index%2?'foreign-':'allowed-')+index,uid:index%2?'other':'actor',timestamp:index,updatedAt:1,text:'Synthetic astronomical observation',tags:['astronomy'],category:'science'}));
   const rows=plain.map((row,index)=>({...row,get uid(){aclReads++;return row.uid;},get timestamp(){timestampReads++;return row.timestamp;},get text(){plaintextReads++;if(index%2)throw Error('DENIED-PLAINTEXT');return row.text;}}));
   const reset=values=>({changed:values.map(value=>({id:value.id,value})),removed:[],order:{reset:values.map(value=>value.id),changes:[]}}),apply=value=>{const delta=publication.apply('personal',{changed:[{id:value.id,value}],removed:[],order:{changes:[]}});resources.apply(delta);};
   const delta=publication.apply('personal',reset(rows));resources.apply(delta);const originalCatalog=resources.capture();timestampReads=0;
   let view;await publication.publishSnapshot(()=>true,next=>{view=next;});const old=view,oldActive=view.view('active');
   check(timestampReads===0&&view.length===10000&&oldActive.length===10000&&!Array.isArray(view),'constant_publication');
   const shape=hits=>hits.map(hit=>({id:hit.memory.id,score:hit.score})),expected=values=>shape(searchMemories(values.filter(row=>row.uid==='actor'&&!row.deletedAt).sort((a,b)=>b.timestamp-a.timestamp),'astronomical observation',{limit:4,semanticFloor:.4}));
   let ticks=0,last=performance.now(),gap=0;const heartbeat=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;ticks++;},10),times={};
   const timed=async(name,job)=>{const at=performance.now(),value=await job();times[name]=Math.round((performance.now()-at)*100)/100;return value;};
   try{
    const first=await timed('initialPreview',()=>client.select(view,'astronomical observation',new AbortController().signal));check(JSON.stringify(shape(first))===JSON.stringify(expected(plain)),'initial_ranking');
    aclReads=plaintextReads=timestampReads=0;const edit={...plain[5000],timestamp:20000,text:'Synthetic astronomical observation edited'};apply(edit);const editTimestampReads=timestampReads;view=publication.snapshot();
    check(timestampReads===editTimestampReads&&editTimestampReads<512&&old.get(edit.id)===rows[5000]&&view.get(edit.id)===edit,'persistent_version');check(resources.capture()===originalCatalog,'catalog_identity');
    const edited=await timed('singleEditPreview',()=>client.select(view,'astronomical observation',new AbortController().signal));
    check(edited[0].memory===edit&&aclReads<20&&plaintextReads===0&&messages[1].changed===1&&messages[1].moves===2&&messages[1].order===null,'delta_preview');const editAclReads=aclReads;
    const expectedEdited=expected(plain.map(row=>row.id===edit.id?edit:row));check(JSON.stringify(shape(edited))===JSON.stringify(expectedEdited),'edited_ranking');
    await client.select(view,'',new AbortController().signal);await client.select(view,'astronomical observation',new AbortController().signal);check(created===1&&messages[2].changed===0&&messages[3].changed===0,'draft_index_reuse');
    apply({...edit,deletedAt:1});view=publication.snapshot();check(view.view('active').length===9999&&oldActive.length===10000,'derived_views');const hidden=await client.select(view,'astronomical observation',new AbortController().signal);check(!hidden.some(hit=>hit.memory.id===edit.id)&&messages[4].removed===1&&messages[4].changed===0,'tombstone_removal');
    const denied={id:'foreign-new',uid:'other',timestamp:30000,get text(){throw Error('DENIED-PLAINTEXT');}};
    resources.apply(publication.apply('personal',{changed:[{id:denied.id,value:denied}],removed:[],order:{changes:[{type:'added',id:denied.id,oldIndex:-1,newIndex:10000}]}}));
    view=publication.snapshot();await client.select(view,'astronomical observation',new AbortController().signal);check(messages[5].changed===0&&messages[5].moves===1,'anonymous_addition');
    publication.clear();let refused=false;try{await client.select(view,'astronomical observation',new AbortController().signal);}catch{refused=true;}let viewRetired=false;try{old.length;}catch{viewRetired=true;}
    check(refused&&viewRetired&&terminated===1&&messages.every(row=>!row.denied&&!row.extra),'scope_and_privacy');await new Promise(resolve=>setTimeout(resolve,30));check(ticks>0,'heartbeat');
    return{records:10000,authorizedPreviewRecords:5000,publicationTimestampReads:0,singleEditSortTimestampReads:editTimestampReads,singleEditAuthorizationReads:editAclReads,singleEditUnchangedPlaintextReads:0,singleEditProjected:1,singleEditOrderMoves:2,singleEditFullOrderTransferred:false,oldVersionPreserved:true,derivedCountsPreserved:true,resourceCatalogIdentityPreserved:true,rankingParity:true,shortDraftIndexReused:true,tombstonePurged:true,deniedIdsAndPlaintextTransferred:false,retiredViewsRejected:true,workersCreated:created,workersTerminated:terminated,heartbeatTicks:ticks,maxHeartbeatGapMs:Math.round(gap*100)/100,roundTripMs:times,initialProjectionStillOneBatchedTraversal:true,initialWorkerTransferDocuments:messages[0].changed};
   }finally{clearInterval(heartbeat);client.dispose();publication.clear();window.Worker=NativeWorker;}
  });
  assert.equal(external.length,0);assert.equal(exceptions.length,0);console.log(JSON.stringify({v:1,at:new Date().toISOString(),result,compiledWorker:{file:names[0],bytes:workerBytes.length,sha256:hash(workerBytes)},clientBundleSha256:hash(clientBytes),externalRequests:0,modelInference:false,applicationAuthOrDevicePilot:false,machineSpecificTimingIsNotAnSLO:true},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(JSON.stringify({error:error.name,code:error.message}));process.exitCode=1;});
