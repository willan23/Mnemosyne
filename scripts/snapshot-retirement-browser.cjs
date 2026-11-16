'use strict';
// Real mapping queue/cache; synthetic blocked documents. No Firebase or models.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),frontend=root+'/frontend',{build}=require(frontend+'/node_modules/esbuild'),{chromium}=require(frontend+'/node_modules/playwright'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const files=['incrementalSessionSnapshot.ts','snapshotMappingQueue.ts','cognitiveAnalysisYield.ts'];
 const sources=files.map(file=>({path:'frontend/src/services/'+file,sha256:hash(fs.readFileSync(frontend+'/src/services/'+file))}));
 const built=await build({stdin:{contents:"export {IncrementalSessionSnapshot} from './incrementalSessionSnapshot';export {SnapshotMappingQueue,readSnapshotMapping,SNAPSHOT_MAPPING_LIMITS} from './snapshotMappingQueue';",resolveDir:frontend+'/src/services',loader:'ts'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'}),client=built.outputFiles[0].contents,csp=JSON.parse(fs.readFileSync(frontend+'/src-tauri/tauri.conf.json')).app.security.csp;
 const server=http.createServer((req,res)=>{if(!['/','/client.js'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/'?'<!doctype html><title>Synthetic snapshot retirement</title>':client);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const external=[],errors=[];
 try{
  browser=await chromium.launch({headless:true,args:['--enable-precise-memory-info']});const page=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(new URL(route.request().url()).origin);return route.abort();});await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const {IncrementalSessionSnapshot,SnapshotMappingQueue,readSnapshotMapping,SNAPSHOT_MAPPING_LIMITS}=await import('/client.js');
   const check=(value,code)=>{if(!value)throw Error(code);},deferred=()=>{let resolve;const promise=new Promise(finish=>{resolve=finish;});return{promise,resolve};},turn=()=>new Promise(resolve=>setTimeout(resolve,0));
   const runs=[];
   for(const records of [1000,100000]){
    const hold=deferred(),cache=new IncrementalSessionSnapshot();let reads=0,lateReads=0,retired=false;
    const docs=Array.from({length:records},(_,at)=>({id:'old'+at,data(){reads++;if(retired)lateReads++;return 'Synthetic private '+at;}}));
    const before=performance.now(),pending=cache.prepare({docs,docChanges(){throw Error('initial_delta');}},async doc=>{const value=doc.data();await hold.promise;return value;}).then(()=>({rejected:false}),()=>({rejected:true})),captureReturnedMs=performance.now()-before;
    check(reads===SNAPSHOT_MAPPING_LIMITS.concurrency,'initial_concurrency');
    const at=performance.now();retired=true;cache.reset();const resetReturnedMs=performance.now()-at;
    const old=await pending;check(old.rejected,'retired_lease');
    const fresh=await cache.prepare({docs:[{id:'fresh'}],docChanges:()=>[]},async doc=>'Synthetic new '+doc.id);check(fresh.commit()&&fresh.changed.length===1&&fresh.changed[0].value==='Synthetic new fresh','fresh_generation');
    hold.resolve();await turn();await turn();check(reads===8&&lateReads===0,'retired_reads');check((await cache.prepare({get docs(){throw Error('fresh_scan');},docChanges:()=>[]},async()=>{throw Error('fresh_remap');})).changed.length===0,'late_work_corrupted_new_scope');cache.reset();
    runs.push({records,captureReturnedMs,resetReturnedMs,startedReads:reads,lateQueuedReads:lateReads,freshGenerationPreserved:true});
   }
   const hold=deferred(),queue=new SnapshotMappingQueue();let started=0,nextReads=0;
   const jobs=Array.from({length:100000},(_,at)=>queue.enqueue('q'+at,async()=>{started++;await hold.promise;return at;},()=>{throw Error('retired_failure_callback');}));
   const observed=readSnapshotMapping(jobs[99999]).then(()=>false,()=>true),head=jobs[8],next=head.next;
   Object.defineProperty(head,'next',{get(){nextReads++;return next;},set(){}});
   const at=performance.now();queue.retire();const retireReturnedMs=performance.now()-at;check(nextReads===0,'retirement_walked_queue');check(await observed,'observed_queue_not_rejected');check(await readSnapshotMapping(jobs[99998]).then(()=>false,()=>true),'unobserved_queue_not_rejected');hold.resolve();await turn();check(started===8,'retired_queue_started');
   return{runs,queue:{records:jobs.length,retireReturnedMs,nextReads,started,observedWaiterRejected:true,unobservedLateWaiterRejected:true},realMappingCache:true,syntheticSdkInputs:true,noSdkDeviceOrFullAppAcceptance:true,machineSpecificTimingIsNotAnSLO:true};
  });
  assert.equal(external.length+errors.length,0);console.log(JSON.stringify({v:1,at:new Date().toISOString(),complete:true,result,sources,bundleSha256:hash(client),externalRequests:0,pageErrors:0,productionMutations:0,modelInference:false},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(JSON.stringify({error:error.name,code:error.message}));process.exitCode=1;});
