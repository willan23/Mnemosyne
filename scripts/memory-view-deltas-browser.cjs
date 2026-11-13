'use strict';
// Real client, persistent snapshots and compiled Worker. Synthetic metadata only; no application Auth/model.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{build}=require(root+'/frontend/node_modules/esbuild'),{chromium}=require(root+'/frontend/node_modules/playwright');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
(async()=>{
 const names=fs.readdirSync(root+'/frontend/dist/assets').filter(name=>/^memoryViewWorker-[\w-]+\.js$/.test(name));assert.equal(names.length,1,'Build current frontend first');
 const workerBytes=fs.readFileSync(root+'/frontend/dist/assets/'+names[0]);assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage|importScripts)\s*[.(]/.test(workerBytes.toString('utf8')));
 const bundle=await build({stdin:{contents:"export {MemoryViewClient} from './memoryViewClient';export {IncrementalMemoryPublication} from './incrementalMemoryPublication';export {rankMemoriesForRender,getUniverseRenderBudget} from '../engines/celestialLayout';",resolveDir:root+'/frontend/src/services',loader:'ts'},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent'});
 const clientBytes=bundle.outputFiles[0].contents,csp=JSON.parse(fs.readFileSync(root+'/frontend/src-tauri/tauri.conf.json')).app.security.csp;
 const server=http.createServer((req,res)=>{if(!['/','/client.js','/memoryViewWorker.ts'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/'?'<!doctype html><title>Synthetic incremental memory views</title>':req.url==='/client.js'?clientBytes:workerBytes);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const external=[],exceptions=[];
 try{
  const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('pageerror',error=>exceptions.push(error.name));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(new URL(route.request().url()).origin);return route.abort();});await page.goto(origin);
  const result=await page.evaluate(async()=>{
   const {MemoryViewClient,IncrementalMemoryPublication,rankMemoriesForRender,getUniverseRenderBudget}=await import('/client.js');
   const check=(ok,code)=>{if(!ok)throw Error(code);},NativeWorker=window.Worker,messages=[],workers=[];let terminated=0,plaintextReads=0,iterations=0,forbidText=false,forbidIteration=false;
   class MeasuredWorker extends NativeWorker{
    constructor(url,options){super(url,options);this.holdNext=false;this.held=null;workers.push(this);this.addEventListener('message',event=>{if(this.held?.id===event.data?.id){this.held.data=event.data;event.stopImmediatePropagation();}});}
    postMessage(message){
     const frame=message.type==='patch-chunk'?message.frame:{},json=JSON.stringify(message);check(!/SYNTHETIC-ACTOR|LOCKED-CONTENT/.test(json),'private_metadata_transfer');
     messages.push({type:message.type,changed:frame.changed?.length??0,order:frame.order?.length??0,moves:frame.moves?.length??0,removed:frame.removed?.length??0,filter:message.type==='filter-chunk'?message.ids.length:0,reset:message.reset??null,reuse:message.reuseFilter??null});
     if(message.type==='query-start'&&message.options.mode==='scene')check(message.options.filteredIds===null,'large_filter_header');
     if(this.holdNext&&message.type==='patch-chunk'){this.holdNext=false;this.held={id:message.id,data:null};}super.postMessage(message);
    }
    terminate(){terminated++;super.terminate();}
   }
   window.Worker=MeasuredWorker;
   const now=1700000000000,realNow=Date.now;Date.now=()=>now;
   const make=(id,index,extra={})=>({id,uid:'SYNTHETIC-ACTOR',timestamp:index,updatedAt:now-(index%250)*86400000,importance:(index%17)/17,taxonomyLane:index%2?'work':'personal',celestialType:'planet',position:[0,0,0],connections:index===50003?['m50004','m77777']:[],encLocked:index===42,
    get title(){if(index===42)throw Error('Locked title read');return 'Synthetic '+id;},get text(){if(index===42)throw Error('Locked text read');plaintextReads++;if(forbidText)throw Error('Historical text read');return 'Synthetic observation';},get embedding(){throw Error('Vector read by a view');},...extra});
   const raw=Array.from({length:100000},(_,index)=>make('m'+index,index)),publisher=new IncrementalMemoryPublication('asc');
   publisher.apply('personal',{changed:raw.map(value=>({id:value.id,value})),removed:[],order:{reset:raw.map(row=>row.id),changes:[]}});
   const first=publisher.snapshot(),prototype=Object.getPrototypeOf(first),originalIterator=prototype[Symbol.iterator];prototype[Symbol.iterator]=function(...args){iterations++;if(forbidIteration)throw Error('Enumerated warm snapshot');return originalIterator.apply(this,args);};
   const list=new MemoryViewClient('list'),scene=new MemoryViewClient('scene'),options={mode:'list',query:'',locale:'en',limit:100};
   let active=false,last=performance.now(),ticks=0,gap=0;const times={},timer=setInterval(()=>{const stamp=performance.now();if(active){gap=Math.max(gap,stamp-last);ticks++;}last=stamp;},10);
   const timed=async(name,job)=>{last=performance.now();gap=0;ticks=0;active=true;const at=performance.now();try{return await job();}finally{active=false;times[name]={elapsedMs:Math.round((performance.now()-at)*100)/100,heartbeatTicks:ticks,maxHeartbeatGapMs:Math.round(gap*100)/100};}};
   try{
    const topIds=count=>Array.from({length:count},(_,i)=>'m'+(99999-i));
    const initial=await timed('cold100k',()=>list.select(first,options,new AbortController().signal));check(initial.count===100000&&JSON.stringify(initial.memories.map(row=>row.id))===JSON.stringify(topIds(100)),'cold_ranking');check(plaintextReads===99999,'cold_projection');const coldIterations=iterations;
    forbidText=forbidIteration=true;const changed=make('m0',200000,{text:'Synthetic edited'});publisher.apply('personal',{changed:[{id:changed.id,value:changed}],removed:[],order:{changes:[]}});
    const at=messages.length,oldLookup=initial.lookup;
    const edited=await timed('singleEdit100k',()=>{const warm=list.select(publisher.snapshot(),options,new AbortController().signal);check(oldLookup.size===0,'old_lookup_not_withdrawn');return warm;}),delta=messages.slice(at);check(edited.memories[0]===changed&&edited.count===100000&&JSON.stringify(edited.memories.map(row=>row.id))===JSON.stringify(['m0',...topIds(99)]),'edited_ranking');
    check(iterations===coldIterations&&delta.reduce((n,row)=>n+row.changed,0)===1&&delta.reduce((n,row)=>n+row.order,0)===0&&delta.reduce((n,row)=>n+row.moves,0)===2,'warm_delta_only');
    const beforeQuery=messages.length;await list.select(publisher.snapshot(),{...options,query:'edited'},new AbortController().signal);check(messages.slice(beforeQuery).every(row=>row.type==='query-start'||row.type==='query-end'),'query_reuse');
    publisher.apply('personal',{changed:[],removed:['m0'],order:{changes:[{id:'m0',type:'removed',oldIndex:0,newIndex:-1}]}});
    const removed=await list.select(publisher.snapshot(),options,new AbortController().signal);check(removed.count===99999&&removed.memories[0].id==='m99999'&&!removed.lookup.has('m0'),'removal_delta');
    const extra=make('extra',200001,{text:'Synthetic extra'});publisher.apply('personal',{changed:[{id:extra.id,value:extra}],removed:[],order:{changes:[{id:extra.id,type:'added',oldIndex:-1,newIndex:99999}]}});
    check((await list.select(publisher.snapshot(),options,new AbortController().signal)).memories[0].id==='extra','addition_delta');
    const filteredIds=Array.from({length:50000},(_,i)=>'m'+(50000+i)),allowed=new Set(filteredIds),sceneOptions={mode:'scene',activeId:'m50003',taxonomy:'work',filteredIds};
    const oracle=()=>{const values=raw.filter(row=>allowed.has(row.id)&&row.taxonomyLane==='work');return rankMemoriesForRender(values,sceneOptions.activeId,getUniverseRenderBudget(values.length).maxObjects).map(row=>row.id);};
    const expected=oracle();forbidIteration=false;const sceneInitial=await timed('sceneCold100k',()=>scene.select(publisher.snapshot(),sceneOptions,new AbortController().signal));
    check(sceneInitial.count===25000&&JSON.stringify(sceneInitial.memories.map(row=>row.id))===JSON.stringify(expected),'scene_oracle');
    forbidIteration=true;const sceneEdit=make('m50003',50003,{importance:1});raw[50003]=sceneEdit;publisher.apply('personal',{changed:[{id:sceneEdit.id,value:sceneEdit}],removed:[],order:{changes:[]}});
    const expectedEdited=oracle(),beforeScene=messages.length,beforeSceneIterations=iterations;
    const sceneResult=await timed('sceneWarm100k',()=>scene.select(publisher.snapshot(),sceneOptions,new AbortController().signal));check(JSON.stringify(sceneResult.memories.map(row=>row.id))===JSON.stringify(expectedEdited),'scene_edit_oracle');
    const sceneDelta=messages.slice(beforeScene);check(iterations===beforeSceneIterations&&sceneDelta.reduce((n,row)=>n+row.changed,0)===1&&sceneDelta.every(row=>row.filter===0),'scene_filter_reuse');
    // More than 64 publication revisions evict the old journal. One replacement stream uses current roots.
    for(let i=0;i<70;i++)publisher.apply('personal',{changed:[{id:'extra',value:make('extra',200001,{text:'Synthetic revision '+i})}],removed:[],order:{changes:[]}});
    forbidText=forbidIteration=false;const beforeRecovery=messages.length,recovered=await timed('journalRecovery100k',()=>list.select(publisher.snapshot(),{...options,query:'revision 69'},new AbortController().signal));
    check(recovered.count===1&&recovered.memories[0].id==='extra'&&messages.slice(beforeRecovery).some(row=>row.type==='patch-start'&&row.reset),'current_root_recovery');
    // Hold an ACK from a real Worker after it has processed a metadata frame.
    let created=0;const paused=new MemoryViewClient('list',{createWorker:()=>{const worker=new MeasuredWorker(new URL('/memoryViewWorker.ts',location.href),{type:'module'});if(created++===0)worker.holdNext=true;return worker;}}),controller=new AbortController();
    try{
     const pending=paused.select(raw.slice(1,1001),options,controller.signal),rejected=pending.then(()=>false,()=>true);
     const deadline=performance.now()+10000;let old;while(!(old=workers.find(worker=>worker.held?.data))){check(performance.now()<deadline,'ack_hold_timeout');await new Promise(resolve=>setTimeout(resolve,5));}
     const heldAt=messages.length;await new Promise(resolve=>setTimeout(resolve,20));check(messages.length===heldAt,'more_than_one_frame_in_flight');controller.abort();check(await rejected,'abort_not_rejected');
     const current=await paused.select([make('current',1,{text:'Synthetic current'})],options,new AbortController().signal);old.onmessage?.(new MessageEvent('message',{data:old.held.data}));check(current.lookup.get('current')?.id==='current','late_ack_retired_new_transport');
     const tied=await paused.select([make('b',1,{text:'Synthetic tie'}),make('a',1,{text:'Synthetic tie'})],options,new AbortController().signal);check(tied.memories.map(row=>row.id).join(',')==='b,a','stable_tie_order');
    }finally{paused.dispose();}
    const finalLookup=sceneResult.lookup;publisher.clear();check(finalLookup.size===0,'closed_scope_lookup');list.dispose();scene.dispose();
    const max=key=>Math.max(0,...messages.map(row=>row[key]));check(['changed','order','moves','removed','filter'].every(key=>max(key)<=128),'unbounded_frame');check(workers.length===terminated,'worker_lifetime');
    return{records:100000,coldSnapshotIterations:coldIterations,warmSnapshotIterations:0,singleEditProjected:1,warmOrderIds:0,maxChanged:max('changed'),maxOrder:max('order'),maxMoves:max('moves'),maxRemoved:max('removed'),maxFilterIds:max('filter'),sceneParity:true,stableListAndDeltaParity:true,filterSetReused:true,journalRecovery:true,realAckHeld:true,lateAckIgnored:true,retiredLookupsEmpty:true,workersCreated:workers.length,workersTerminated:terminated,times,applicationAuthOrDevicePilot:false,machineSpecificTimingIsNotAnSLO:true};
   }finally{clearInterval(timer);prototype[Symbol.iterator]=originalIterator;Date.now=realNow;list.dispose();scene.dispose();publisher.clear();window.Worker=NativeWorker;}
  });
  assert.equal(external.length,0);assert.equal(exceptions.length,0);console.log(JSON.stringify({complete:true,result,externalRequests:0,pageErrors:0,compiledWorker:{path:'frontend/dist/assets/'+names[0],sha256:hash(workerBytes)},clientBundleSha256:hash(clientBytes),cspSha256:hash(csp)}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
