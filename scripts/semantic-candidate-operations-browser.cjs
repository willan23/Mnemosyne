'use strict';
// Actual operation core and production Worker. Synthetic pre-captured metadata, no Auth or inference.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{build}=require(root+'/frontend/node_modules/esbuild'),{chromium}=require(root+'/frontend/node_modules/playwright');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const assets=root+'/frontend/dist/assets',names=fs.readdirSync(assets).filter(name=>/^indexedSemanticWriteWorker-[\w-]+\.js$/.test(name));assert.equal(names.length,1,'Build the current frontend first');
 const workerBytes=fs.readFileSync(assets+'/'+names[0]);
 const bundle=await build({stdin:{contents:"export {createSemanticCandidateOperation} from './semanticCandidateOperationIndex';export {selectIndexedSemanticWriteNeighbors} from './indexedSemanticWriteCorpus';export {CURRENT_EMBEDDING_SPACE} from './embeddingModel';export {cosineSimilarity} from './semanticConnectionBackfill';",resolveDir:root+'/frontend/src/services',loader:'ts'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'});
 const clientBytes=bundle.outputFiles[0].contents,csp=JSON.parse(fs.readFileSync(root+'/frontend/src-tauri/tauri.conf.json')).app.security.csp;
 const server=http.createServer((req,res)=>{if(!['/','/client.js','/indexedSemanticWriteWorker.ts'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/'?'<!doctype html><title>Synthetic batch semantic validation</title>':req.url==='/client.js'?clientBytes:workerBytes);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const external=[],exceptions=[];
 try{
  const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>exceptions.push(e.name));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(new URL(route.request().url()).origin);return route.abort();});await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const {createSemanticCandidateOperation,selectIndexedSemanticWriteNeighbors:select,CURRENT_EMBEDDING_SPACE,cosineSimilarity}=await import('/client.js');
   const check=(ok,code)=>{if(!ok)throw Error(code);},NativeWorker=window.Worker,messages=[];let created=0,terminated=0,retired=false;
   class MeasuredWorker extends NativeWorker{
    constructor(url,opts){super(url,opts);created++;}
    postMessage(message){messages.push({type:message.type,changed:message.type==='patch-chunk'?message.changed.length:0,private:message.type==='patch-chunk'&&message.changed.some(row=>row.value&&['uid','teamId','text','title','position','enc','attachments'].some(key=>key in row.value)),actor:JSON.stringify(message).includes('SYNTHETIC-ACTOR')});return super.postMessage(message);}
    terminate(){terminated++;super.terminate();}
   }
   window.Worker=MeasuredWorker;
   const query=Array.from({length:384},(_,i)=>i===0?1:0),captured=Array.from({length:10000},(_,i)=>{const a=(i*17%10007)/10007*Math.PI*2;return{id:'synthetic-'+i,uid:'SYNTHETIC-ACTOR',embeddingModel:CURRENT_EMBEDDING_SPACE,embedding:Array.from({length:384},(_,d)=>d===0?Math.cos(a):d===1?Math.sin(a):0),celestialType:i===0?'sun':'planet',position:[1,2,3]};});
   const expected=captured.map((candidate,ordinal)=>({id:candidate.id,ordinal,score:cosineSimilarity(query,candidate.embedding)})).filter(row=>row.score>=.55).sort((a,b)=>b.score-a.score).slice(0,7);
   let last=performance.now(),ticks=0,maxHeartbeatGapMs=0;const longTasks=[],times={},start=performance.now();
   const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime>=start)longTasks.push(entry.duration);});observer.observe({type:'longtask'});
   const heartbeat=setInterval(()=>{const now=performance.now();maxHeartbeatGapMs=Math.max(maxHeartbeatGapMs,now-last);last=now;ticks++;},10);
   const timed=async(name,job)=>{const at=performance.now(),value=await job();times[name]=Math.round((performance.now()-at)*100)/100;return value;};
   const operation=createSemanticCandidateOperation(captured,{scope:{uid:'SYNTHETIC-ACTOR'},assertCurrent(){if(retired)throw Error('retired');},captureAppend:async value=>({...value,embedding:value.embedding?.slice(),position:value.position?.slice()})});
   try{
    const base=operation.prefix();const first=await timed('initialQuery',()=>select(query,base,{}));check(first.count===10000,'initial_count');check(JSON.stringify(first.neighbors.map(row=>({id:row.candidate.id,ordinal:row.ordinal,score:row.score})))===JSON.stringify(expected),'full_sort_parity');
    const initialProjected=messages.reduce((n,row)=>n+row.changed,0),repeatMarker=messages.length;
    await timed('twentyDocumentQueries',async()=>{for(let i=0;i<20;i++){check(operation.prefix()===base,'stable_document_prefix');const result=await select(query,operation.prefix(),{});check(result.count===10000,'document_count');}});
    check(messages.slice(repeatMarker).every(row=>row.type==='query'),'document_reprojection');const documentProjected=messages.slice(repeatMarker).reduce((n,row)=>n+row.changed,0),capsuleMarker=messages.length;
    const prefixSizes=[];
    await timed('twentyCapsuleAppendQueries',async()=>{for(let i=0;i<20;i++){const value={id:'added-'+i,uid:'SYNTHETIC-ACTOR',embeddingModel:CURRENT_EMBEDDING_SPACE,embedding:[...query],position:[i,0,0]};await operation.append(value);value.embedding[0]=-1;value.position[0]=999;const selected=await select(query,operation.prefix(),{});check(selected.count===10001+i,'capsule_count');prefixSizes.push(selected.count);}});
    check([...base].length===10000,'fixed_old_prefix');let stale=false;try{await select(query,base,{});}catch{stale=true;}check(stale,'stale_prefix');
    const capsuleProjected=messages.slice(capsuleMarker).reduce((n,row)=>n+row.changed,0);check(capsuleProjected===20,'capsule_projection');
    const positions=operation.sunPositions();positions[0][0]=99;check(operation.sunPositions()[0][0]===1,'independent_sun_positions');
    const saved=operation.prefix();retired=true;operation.dispose();let refused=false;try{await select(query,saved,{});}catch{refused=true;}check(refused&&created===1&&terminated===1,'retirement');
    await new Promise(resolve=>setTimeout(resolve,30));check(initialProjected===10000&&documentProjected===0&&messages.every(row=>!row.private&&!row.actor)&&ticks>0,'privacy_and_reuse');
    return{records:10000,dimensions:384,documentQueries:20,documentAdditionalProjected:documentProjected,capsuleAdditions:20,capsuleAdditionalProjected:capsuleProjected,prefixSizes,initialProjected,fullSortParity:true,fixedOldPrefix:true,stalePrefixRefused:true,independentSunPositions:true,retiredScopeRefused:true,workersCreated:created,workersTerminated:terminated,maxTransferRecords:Math.max(...messages.map(row=>row.changed)),heartbeatTicks:ticks,maxHeartbeatGapMs:Math.round(maxHeartbeatGapMs*100)/100,longTasksMs:longTasks,roundTripMs:times};
   }finally{clearInterval(heartbeat);observer.disconnect();operation.dispose();window.Worker=NativeWorker;}
  });
  assert.equal(external.length,0);assert.equal(exceptions.length,0);assert(result.maxTransferRecords<=128);
  console.log(JSON.stringify({v:1,at:new Date().toISOString(),result,compiledWorker:{file:names[0],bytes:workerBytes.length,sha256:hash(workerBytes)},clientBundleSha256:hash(clientBytes),externalRequests:0,preCapturedSyntheticMetadata:true,outerCaptureValidatedByUnitTests:true,originalMemoryContentTransferred:false,modelInference:false,applicationAuthOrDevicePilot:false,machineSpecificTimingIsNotAnSLO:true},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(JSON.stringify({error:error.name,code:error.message}));process.exitCode=1;});
