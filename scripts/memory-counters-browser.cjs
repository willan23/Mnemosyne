'use strict';
// Authorized synthetic snapshots in Chromium; this is a counter/index harness, not an Auth/device pilot.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),{build}=require(root+'/frontend/node_modules/esbuild'),{chromium}=require(root+'/frontend/node_modules/playwright');
(async()=>{
 const bundle=await build({stdin:{contents:"export {IncrementalMemoryPublication} from './incrementalMemoryPublication';export {memoryConnectionReferences,memoryById} from './memorySnapshot';",resolveDir:root+'/frontend/src/services',loader:'ts'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'});
 const bytes=bundle.outputFiles[0].contents,csp=JSON.parse(fs.readFileSync(root+'/frontend/src-tauri/tauri.conf.json')).app.security.csp;
 const server=http.createServer((req,res)=>{if(!['/','/counters.js'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/'?'<!doctype html><title>Synthetic memory counters</title><output id="count"></output>':bytes);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const external=[],exceptions=[];
 try{
  const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('pageerror',error=>exceptions.push(error.name));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(new URL(route.request().url()).origin);return route.abort();});await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const {IncrementalMemoryPublication,memoryConnectionReferences,memoryById}=await import('/counters.js');
   const check=(ok,code)=>{if(!ok)throw Error(code);};let reads=0,allowReads=true;
   const make=(index,count=4)=>({id:'m'+index,timestamp:index,deleted:index%10===0,
    get connections(){reads++;if(!allowReads)throw Error('Historical connections read');return Array.from({length:count},()=> 'outside');},
    get text(){throw Error('Counter read plaintext');},get embedding(){throw Error('Counter read vectors');}});
   const publisher=new IncrementalMemoryPublication('asc',{views:{active:row=>!row.deleted}}),rows=Array.from({length:100000},(_,index)=>make(index));
   // Initial construction is deliberately outside the warm-operation timings.
   publisher.apply('source',{changed:rows.map(value=>({id:value.id,value})),removed:[],order:{reset:rows.map(row=>row.id),changes:[]}});
   const old=publisher.snapshot(),oldActive=old.view('active'),prototype=Object.getPrototypeOf(old),originalIterator=prototype[Symbol.iterator],originalAt=prototype.at;
   prototype[Symbol.iterator]=function(){throw Error('Enumerated counter source');};prototype.at=function(){throw Error('Indexed traversal for counter');};
   let ticks=0,gap=0,last=performance.now();const heartbeat=setInterval(()=>{const now=performance.now();gap=Math.max(gap,now-last);last=now;ticks++;},5);
   try{
    reads=0;allowReads=false;await new Promise(resolve=>setTimeout(resolve,20));const start=performance.now();
    for(let render=0;render<1000;render++){check(memoryConnectionReferences(old)===400000,'initial_sum');check(memoryConnectionReferences(oldActive)===360000,'active_sum');check(memoryById(old,'m99999')===rows[99999],'indexed_lookup');}
    const thousandReadsMs=performance.now()-start;check(reads===0,'counter_historical_reads');
    const changed=make(50001,9);allowReads=true;const updateStart=performance.now();publisher.apply('source',{changed:[{id:changed.id,value:changed}],removed:[],order:{changes:[]}});const singleEditMs=performance.now()-updateStart;
    check(reads===2,'single_dto_only');allowReads=false;const next=publisher.snapshot();
    check(memoryConnectionReferences(next)===400005,'updated_sum');check(memoryConnectionReferences(next.view('active'))===360005,'updated_active_sum');
    check(memoryConnectionReferences(old)===400000&&memoryConnectionReferences(oldActive)===360000,'old_revision_changed');
    document.querySelector('#count').textContent=String(memoryConnectionReferences(next)/2);check(document.querySelector('#count').textContent==='200002.5','display_formula_changed');
    publisher.clear();let retired=false;try{memoryConnectionReferences(next);}catch{retired=true;}check(retired,'retired_counter_exposed');
    check(memoryConnectionReferences(publisher.snapshot())===0,'new_scope_nonempty');await new Promise(resolve=>setTimeout(resolve,20));
    return {records:100000,counterAndLookupReads:1000,historicalConnectionReads:0,changedDtoConnectionReads:reads,thousandReadsMs,singleEditMs,oldRevisionStable:true,filteredViews:true,duplicateAndOutsideReferencesRetained:true,scopeRetired:true,heartbeatTicks:ticks,maxHeartbeatGapMs:gap};
   }finally{clearInterval(heartbeat);prototype[Symbol.iterator]=originalIterator;prototype.at=originalAt;publisher.clear();}
  });
  assert.equal(external.length,0);assert.equal(exceptions.length,0);
  console.log(JSON.stringify({v:1,at:new Date().toISOString(),complete:true,result,bundleSha256:crypto.createHash('sha256').update(bytes).digest('hex'),nativeDesktopCsp:true,externalRequests:0,pageErrors:0,modelInference:false,initialConstructionIncludedInTiming:false,applicationAuthOrDevicePilot:false,machineSpecificTimingIsNotAnSLO:true},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(JSON.stringify({error:error.name,code:error.message}));process.exitCode=1;});
