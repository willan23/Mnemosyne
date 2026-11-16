'use strict';
// Compiled production Worker and actual indexed client; all identities/vectors are synthetic.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{build}=require(root+'/frontend/node_modules/esbuild'),{chromium}=require(root+'/frontend/node_modules/playwright');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const assets=root+'/frontend/dist/assets',names=fs.readdirSync(assets).filter(name=>/^indexedSemanticWriteWorker-[\w-]+\.js$/.test(name));assert.equal(names.length,1,'Build the current frontend first');
 const workerBytes=fs.readFileSync(assets+'/'+names[0]);assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage|importScripts)\s*[.(]/.test(workerBytes.toString('utf8')));
 const bundle=await build({stdin:{contents:"export {IndexedSemanticWriteCorpus,selectIndexedSemanticWriteNeighbors} from './indexedSemanticWriteCorpus';export {IncrementalMemoryPublication} from './incrementalMemoryPublication';export {semanticCandidateEligibility} from './semanticWriteScope';export {CURRENT_EMBEDDING_SPACE} from './embeddingModel';export {cosineSimilarity} from './semanticConnectionBackfill';",resolveDir:root+'/frontend/src/services',loader:'ts'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'});
 const clientBytes=bundle.outputFiles[0].contents,csp=JSON.parse(fs.readFileSync(root+'/frontend/src-tauri/tauri.conf.json')).app.security.csp;
 const server=http.createServer((req,res)=>{if(!['/','/client.js','/indexedSemanticWriteWorker.ts'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/'?'<!doctype html><title>Synthetic semantic index validation</title>':req.url==='/client.js'?clientBytes:workerBytes);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const external=[],exceptions=[];
 try{
  const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>exceptions.push(e.name));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(new URL(route.request().url()).origin);return route.abort();});await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const {IndexedSemanticWriteCorpus,selectIndexedSemanticWriteNeighbors,IncrementalMemoryPublication,semanticCandidateEligibility,CURRENT_EMBEDDING_SPACE,cosineSimilarity}=await import('/client.js');
   const check=(ok,code)=>{if(!ok)throw Error(code);},NativeWorker=window.Worker,messages=[];let created=0,terminated=0,vectorReads=0,sourceIterations=0;
   class MeasuredWorker extends NativeWorker{
    constructor(url,opts){super(url,opts);created++;}
    postMessage(message){messages.push({type:message.type,changed:message.type==='patch-chunk'?message.changed.length:0,forbidden:/SYNTHETIC-ACTOR|PRIVATE-SENTINEL|CIPHER-SENTINEL|synthetic-team/.test(JSON.stringify(message)),privateField:message.type==='patch-chunk'&&message.changed.some(row=>row.value&&['uid','teamId','text','title','position','enc','attachments','semanticClusterId'].some(key=>key in row.value))});return super.postMessage(message);}
    terminate(){terminated++;super.terminate();}
   }
   window.Worker=MeasuredWorker;
   const publication=new IncrementalMemoryPublication('desc'),corpus=new IndexedSemanticWriteCorpus({uid:'SYNTHETIC-ACTOR',teamIds:new Set(['synthetic-team'])},id=>publication.get(id));
   const apply=(key,patch)=>{publication.apply(key,patch);corpus.apply(key,patch);};
   const reset=values=>({changed:values.map(value=>({id:value.id,value})),removed:[],order:{reset:values.map(value=>value.id),changes:[]}});
   const snapshot=async()=>{let values=[];await publication.publish(()=>true,next=>{values=next;});const source=new Proxy(values,{get(target,key,receiver){if(key===Symbol.iterator){sourceIterations++;throw Error('Enumerated the indexed source');}return Reflect.get(target,key,receiver);}});corpus.associate(source);return source;};
   const query=Array.from({length:384},(_,i)=>i===0?1:0),originals=Array.from({length:10000},(_,i)=>{const a=(i*17%10007)/10007*Math.PI*2,vector=Array.from({length:384},(_,d)=>d===0?Math.cos(a):d===1?Math.sin(a):0);return{id:'synthetic-'+i,uid:'SYNTHETIC-ACTOR',timestamp:i%9,embeddingModel:CURRENT_EMBEDDING_SPACE,embedding:vector};});
   const expected=[...originals].sort((a,b)=>b.timestamp-a.timestamp).map((candidate,ordinal)=>({id:candidate.id,ordinal,score:cosineSimilarity(query,candidate.embedding)})).filter(row=>row.score>=.55).sort((a,b)=>b.score-a.score).slice(0,7);
   const rows=originals.map(row=>{const embedding=row.embedding;return{...row,get embedding(){vectorReads++;return embedding;},get text(){throw Error('Read plaintext sentinel');}};});
   const denied={id:'denied',uid:'foreign-synthetic-actor',timestamp:0,get embedding(){throw Error('Read unauthorized vector');}},legacy={id:'legacy',uid:'SYNTHETIC-ACTOR',timestamp:0,embeddingModel:undefined,get embedding(){throw Error('Read legacy vector');}};
   apply('personal',reset([...rows,denied,legacy]));const source=await snapshot(),eligible=semanticCandidateEligibility('SYNTHETIC-ACTOR');
   let ticks=0,last=performance.now(),maxHeartbeatGapMs=0;const longTasks=[],start=performance.now();
   const observer=typeof PerformanceObserver==='function'?new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime>=start)longTasks.push(entry.duration);}):null;
   try{observer?.observe({type:'longtask',buffered:false});}catch{}
   const heartbeat=setInterval(()=>{const now=performance.now();maxHeartbeatGapMs=Math.max(maxHeartbeatGapMs,now-last);last=now;ticks++;},10),times={};
   const timed=async(name,job)=>{const at=performance.now(),value=await job();times[name]=Math.round((performance.now()-at)*100)/100;return value;};
   try{
    const first=await timed('initialSemanticIndex',()=>selectIndexedSemanticWriteNeighbors(query,source,{eligible}));check(first.count===10001,'eligible_count');check(JSON.stringify(first.neighbors.map(row=>({id:row.candidate.id,ordinal:row.ordinal,score:row.score})))===JSON.stringify(expected),'full_sort_parity');check(vectorReads===10000,'initial_projection');
    const marker=messages.length,again=await timed('reusedSemanticQuery',()=>selectIndexedSemanticWriteNeighbors(query,source,{eligible}));check(again.count===10001&&vectorReads===10000,'reuse_projection');check(messages.slice(marker).every(row=>row.type==='query'),'reuse_payload');
    const beforeUpdate=messages.length,changed={...originals[0],embedding:Array.from({length:384},(_,i)=>i===1?1:0)};
    await timed('singleEditIncludingPublication',async()=>{apply('personal',{changed:[{id:changed.id,value:changed}],removed:[],order:{changes:[]}});const next=await snapshot();let refused=false;try{await selectIndexedSemanticWriteNeighbors(query,source,{eligible});}catch{refused=true;}check(refused,'stale_publication');return selectIndexedSemanticWriteNeighbors(query,next,{eligible});});
    check(messages.slice(beforeUpdate).reduce((n,row)=>n+row.changed,0)===1,'single_delta');check(vectorReads===10000,'unchanged_vector_reads');
    apply('team',reset([{...originals[1],id:'team-memory',teamId:'synthetic-team'}]));const mixed=await snapshot(),team=await selectIndexedSemanticWriteNeighbors(query,mixed,{eligible:semanticCandidateEligibility('SYNTHETIC-ACTOR','synthetic-team')});check(team.count===1,'team_partition');
    const withoutTeamStart=messages.length;publication.removeSource('team');corpus.removeSource('team');const withoutTeam=await snapshot(),removed=await selectIndexedSemanticWriteNeighbors(query,withoutTeam,{eligible:semanticCandidateEligibility('SYNTHETIC-ACTOR','synthetic-team')});check(removed.count===0&&removed.neighbors.length===0,'removed_team');check(messages.slice(withoutTeamStart).every(row=>row.changed===0),'remove_projection');
    corpus.clear();let retired=false;try{await selectIndexedSemanticWriteNeighbors(query,withoutTeam,{eligible});}catch{retired=true;}check(retired&&created===1&&terminated===1,'retirement');
    await new Promise(resolve=>setTimeout(resolve,30));check(sourceIterations===0&&ticks>0&&messages.every(row=>!row.forbidden&&!row.privateField),'privacy_and_responsiveness');
    return{records:10000,dimensions:384,eligibleWithLegacy:10001,initialProjected:10000,reusedProjected:0,singleEditProjected:1,sourceIterations,fullSortParity:true,staleRevisionRefused:true,teamPartitionsVerified:true,removedTeamEmpty:true,retiredScopeRefused:true,maxTransferRecords:Math.max(...messages.map(row=>row.changed)),workersCreated:created,workersTerminated:terminated,heartbeatTicks:ticks,maxHeartbeatGapMs:Math.round(maxHeartbeatGapMs*100)/100,longTasksMs:longTasks,roundTripMs:times,publicationStillMaterializesArrays:true};
   }finally{clearInterval(heartbeat);observer?.disconnect();corpus.clear();window.Worker=NativeWorker;}
  });
  assert.equal(external.length,0);assert.equal(exceptions.length,0);assert(result.maxTransferRecords<=128);
  console.log(JSON.stringify({v:1,at:new Date().toISOString(),result,compiledWorker:{file:names[0],bytes:workerBytes.length,sha256:hash(workerBytes)},clientBundleSha256:hash(clientBytes),externalRequests:0,originalMemoryContentTransferred:false,modelInference:false,applicationAuthOrDevicePilot:false,machineSpecificTimingIsNotAnSLO:true},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(JSON.stringify({error:error.name,code:error.message}));process.exitCode=1;});
