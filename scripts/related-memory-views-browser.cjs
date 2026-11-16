'use strict';
// Real ID-only client/publisher and compiled Worker; synthetic cofre, without Auth or inference.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),{build}=require(root+'/frontend/node_modules/esbuild'),{chromium}=require(root+'/frontend/node_modules/playwright'),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const names=fs.readdirSync(root+'/frontend/dist/assets').filter(name=>/^memoryViewWorker-[\w-]+\.js$/.test(name));assert.equal(names.length,1);const workerBytes=fs.readFileSync(root+'/frontend/dist/assets/'+names[0]);
 const bundle=await build({stdin:{contents:"export {MemoryViewClient} from './memoryViewClient';export {IncrementalMemoryPublication} from './incrementalMemoryPublication';",resolveDir:root+'/frontend/src/services',loader:'ts'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'}),bytes=bundle.outputFiles[0].contents;
 const csp=JSON.parse(fs.readFileSync(root+'/frontend/src-tauri/tauri.conf.json')).app.security.csp;
 const server=http.createServer((req,res)=>{if(!['/','/client.js','/memoryViewWorker.ts'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/'?'<!doctype html><title>Synthetic ordered related memories</title>':req.url==='/client.js'?bytes:workerBytes);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const external=[],errors=[];
 try{
  const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.name));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(new URL(route.request().url()).origin);return route.abort();});await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const {MemoryViewClient,IncrementalMemoryPublication}=await import('/client.js'),check=(ok,code)=>{if(!ok)throw Error(code);},NativeWorker=window.Worker,messages=[];let terminated=0,created=0,iterations=0,forbidIteration=false;
   class MeasuredWorker extends NativeWorker{constructor(url,options){super(url,options);created++;}postMessage(message){if(message.type==='patch-chunk'&&message.frame.changed)for(const row of message.frame.changed)check(row.fields.length===0&&row.connections.length===0&&row.timestamp===0&&row.updatedAt===0&&row.taxonomyLane===null,'non_id_projection');messages.push(message);super.postMessage(message);}terminate(){terminated++;super.terminate();}}
   window.Worker=MeasuredWorker;
   const make=(id,index)=>({id,timestamp:Math.floor(index/3),updatedAt:1,importance:.5,connections:[],
    get title(){throw Error('Related projection read title');},get text(){throw Error('Related projection read text');},get uid(){throw Error('Related projection read actor');},get embedding(){throw Error('Related projection read vector');}});
   const raw=Array.from({length:100000},(_,index)=>make('m'+index,index)),publisher=new IncrementalMemoryPublication('asc');
   publisher.apply('base',{changed:raw.map(value=>({id:value.id,value})),removed:[],order:{reset:raw.map(row=>row.id),changes:[]}},0);
   publisher.apply('overlay',{changed:[{id:'m98000',value:make('m98000',500000)}],removed:[],order:{reset:['m98000'],changes:[]}},10);
   let snapshot=publisher.snapshot();const filters=Array.from({length:2500},(_,index)=>'m'+(99999-index));filters.push('m99999','missing');const membership=new Set(filters);
   // Initial construction and reference-oracle traversal are excluded from timings.
   const oracle=()=>[...publisher.snapshot()].filter(row=>membership.has(row.id)).map(row=>row.id);const before=oracle(),prototype=Object.getPrototypeOf(snapshot),iterate=prototype[Symbol.iterator];
   prototype[Symbol.iterator]=function(...args){iterations++;if(forbidIteration)throw Error('Enumerated warm related source');return iterate.apply(this,args);};
   let ticks=0,last=performance.now(),gap=0;const heartbeat=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;ticks++;},5),client=new MemoryViewClient('related'),signal=()=>new AbortController().signal;
   const times={};const select=async(label,limit=8)=>{const start=performance.now(),result=await client.select(snapshot,{mode:'related',filteredIds:filters,limit},signal());times[label]=Math.round((performance.now()-start)*10)/10;return result;};
   try{
    const first=await select('cold100k');check(first.count===before.length&&JSON.stringify(first.memories.map(row=>row.id))===JSON.stringify(before.slice(0,8)),'cold_order_or_limit');
    const coldIterations=iterations;forbidIteration=true;messages.length=0;const ten=await select('limitChange',10);check(JSON.stringify(ten.memories.map(row=>row.id))===JSON.stringify(before.slice(0,10)),'sidebar_limit');check(messages.every(message=>!['patch-start','filter-chunk'].includes(message.type)),'unchanged_subset_retransmitted');
    const changed=make('m99999',-10);publisher.apply('base',{changed:[{id:changed.id,value:changed}],removed:[],order:{changes:[]}});snapshot=publisher.snapshot();messages.length=0;const priorIterations=iterations;
    const warm=await select('singleEdit100k',2500),warmIterations=iterations-priorIterations;check(warmIterations===0,'warm_source_iteration');check(warm.memories[0]===changed,'warm_current_object');
    const projected=messages.filter(message=>message.type==='patch-chunk').flatMap(message=>message.frame.changed??[]);check(projected.length===1&&projected[0].id===changed.id,'warm_projection');check(messages.every(message=>message.type!=='patch-chunk'||!message.frame.order),'warm_full_order');check(messages.every(message=>message.type!=='filter-chunk'),'warm_filter_reuse');
    const warmIds=warm.memories.map(row=>row.id);forbidIteration=false;check(JSON.stringify(warmIds)===JSON.stringify(oracle()),'warm_order_oracle');forbidIteration=true;
    const oldLookup=warm.lookup,pending=client.select(snapshot,{mode:'related',filteredIds:['m2','m1'],limit:10},signal());check(oldLookup.size===0,'old_subset_lookup_live');const changedSubset=await pending;check(JSON.stringify(changedSubset.memories.map(row=>row.id))===JSON.stringify(['m1','m2']),'changed_subset_order');
    const currentLookup=changedSubset.lookup;publisher.clear();check(currentLookup.size===0,'retired_scope_lookup');
    return {records:100000,subsetIds:filters.length,relatedCount:warm.count,coldSourceIterations:coldIterations,warmSourceIterations:warmIterations,singleEditProjected:projected.length,publishedOrderAndSourcePrecedence:true,limitsEightAndTen:true,filterReused:true,idOnlyProjection:true,scopeRetired:true,times,heartbeatTicks:ticks,maxHeartbeatGapMs:Math.round(gap*10)/10};
   }finally{clearInterval(heartbeat);client.dispose();publisher.clear();prototype[Symbol.iterator]=iterate;window.Worker=NativeWorker;check(created===terminated,'Worker_leak');}
  });
  assert.equal(external.length,0);assert.equal(errors.length,0);console.log(JSON.stringify({v:1,complete:true,at:new Date().toISOString(),result,compiledWorker:{path:'frontend/dist/assets/'+names[0],sha256:hash(workerBytes)},clientBundleSha256:hash(bytes),nativeDesktopCsp:true,externalRequests:0,pageErrors:0,modelInference:false,initialConstructionAndOracleIncludedInTiming:false,applicationAuthOrDevicePilot:false,machineSpecificTimingIsNotAnSLO:true},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(JSON.stringify({error:error.name,code:error.message}));process.exitCode=1;});
