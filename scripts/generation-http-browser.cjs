'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend');
const {build}=require(path.join(frontend,'node_modules/esbuild')),{chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function main(){
  const timers=new Set(),observed={preflights:0,posts:0,authorizationMissing:0,cookiesReceived:0,redirectFollowed:0,bodyStallCancelled:false,headerStallCancelled:false,longCompleted:false};
  const later=(callback,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);callback();},ms);timers.add(timer);};
  const backend=http.createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Cache-Control','no-store');
    if(req.method==='OPTIONS'){observed.preflights++;res.writeHead(204);res.end();return;}
    if(req.url==='/forbidden'){observed.redirectFollowed++;res.end('{}');return;}
    if(req.method!=='POST'||req.url!=='/demo-mnemosyne-rules/europe-west1/generateImage'){res.writeHead(404);res.end();return;}
    observed.posts++;if(req.headers.authorization!=='Bearer synthetic-credential')observed.authorizationMissing++;
    if(req.headers.cookie)observed.cookiesReceived++;
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>4096)req.destroy();});
    req.on('end',()=>{
      let scenario;try{scenario=JSON.parse(body).scenario;}catch{res.writeHead(400);res.end();return;}
      body='';res.setHeader('Content-Type','application/json');
      if(scenario==='long'){later(()=>{if(!res.destroyed){observed.longCompleted=true;res.end(JSON.stringify({image_base64:'c3ludGhldGlj',provider:'synthetic',model:'synthetic'}));}},62000);return;}
      if(scenario==='headers-stall'){res.on('close',()=>{if(!res.writableEnded)observed.headerStallCancelled=true;});return;}
      if(scenario==='body-stall'){res.writeHead(200);res.write('{"image_base64":');res.on('close',()=>{if(!res.writableEnded)observed.bodyStallCancelled=true;});return;}
      if(scenario==='redirect'){res.writeHead(307,{Location:'/forbidden'});res.end();return;}
      if(scenario==='declared-large'){res.writeHead(200,{'Content-Length':'4096'});res.end('x'.repeat(4096));return;}
      if(scenario==='streamed-large'){res.writeHead(200);res.write('x'.repeat(2048));res.end('x'.repeat(2048));return;}
      if(scenario==='gzip-large'){const bytes=zlib.gzipSync(Buffer.from('x'.repeat(4096)));res.writeHead(200,{'Content-Encoding':'gzip','Content-Length':bytes.length});res.end(bytes);return;}
      if(scenario==='upstream-error'){res.writeHead(503);res.end('SYNTHETIC-UPSTREAM-BODY');return;}
      res.end('{"ok":true}');
    });
  });
  await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));const backendOrigin='http://127.0.0.1:'+backend.address().port;
  let server,blockingProxy,browser,externalRequests=0,externalProxyRequests=0;
  try{
    const bundle=await build({stdin:{contents:"export {requestGenerationJson} from './src/services/aiGenerationTransport'; export {generationBackendUrl} from './src/services/generationEndpoints'; export {GENERATION_HTTP_POLICY} from '../functions/src/generationHttpPolicy';",resolveDir:frontend,loader:'ts'},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',logLevel:'silent',
      define:{'import.meta.env':'{}','import.meta.env.DEV':'true','import.meta.env.VITE_FIREBASE_PROJECT_ID':'"demo-mnemosyne-rules"','import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_ORIGIN':'window.generationEmulatorOrigin'}});
    server=http.createServer((req,res)=>{if(req.url==='/client.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Synthetic generation HTTP</title><script>window.generationEmulatorOrigin='+JSON.stringify(backendOrigin)+'</script>');}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
    // Do not intercept allowed traffic: this probe must observe native CORS preflight.
    // All non-loopback destinations instead terminate at this non-forwarding proxy.
    blockingProxy=http.createServer((_req,res)=>{externalProxyRequests++;res.writeHead(502);res.end();});
    blockingProxy.on('connect',(_req,socket)=>{externalProxyRequests++;socket.destroy();});
    await new Promise(resolve=>blockingProxy.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,proxy:{server:'http://127.0.0.1:'+blockingProxy.address().port,bypass:'127.0.0.1,localhost,[::1]'}});const context=await browser.newContext();
    await context.addCookies([{url:backendOrigin,name:'synthetic-session',value:'synthetic-cookie'}]);
    context.on('request',request=>{if(![origin,backendOrigin].includes(new URL(request.url()).origin))externalRequests++;});
    const page=await context.newPage();await page.goto(origin);
    const faults=await page.evaluate(async()=>{
      const {requestGenerationJson,generationBackendUrl}=await import('/client.js');
      const endpoint=generationBackendUrl('image'),headers=async()=>({Authorization:'Bearer synthetic-credential','Content-Type':'application/json'}),signal=()=>new AbortController().signal;
      if(new URL(endpoint).pathname!=='/demo-mnemosyne-rules/europe-west1/generateImage')throw Error('endpoint_contract');
      const refused={};
      for(const scenario of ['headers-stall','body-stall','redirect','declared-large','streamed-large','gzip-large']){
        try{await requestGenerationJson('image',endpoint,{scenario},signal(),headers,{timeoutMs:350,maxBytes:128});refused[scenario]=false;}
        catch{refused[scenario]=true;}
      }
      let safeHttpError=false;
      try{await requestGenerationJson('image',endpoint,{scenario:'upstream-error'},signal(),headers,{timeoutMs:1000,maxBytes:1024});}
      catch(error){safeHttpError=error.status===503&&!String(error).includes('SYNTHETIC')&&!JSON.stringify(error).includes('SYNTHETIC');}
      const controller=new AbortController();const pending=requestGenerationJson('image',endpoint,{scenario:'body-stall'},controller.signal,headers);
      const aborted=pending.then(()=>false,()=>true);setTimeout(()=>controller.abort(),100);
      return{refused,safeHttpError,contextAbortRefused:await aborted};
    });
    assert(Object.values(faults.refused).every(Boolean));assert(faults.safeHttpError&&faults.contextAbortRefused);
    assert(observed.preflights>0);
    console.log(JSON.stringify({stage:'long_request_started',syntheticResponseDelayMs:62000,productionClientDeadlineMs:180000}));
    const long=await page.evaluate(async()=>{
      const {requestGenerationJson,generationBackendUrl,GENERATION_HTTP_POLICY}=await import('/client.js');const start=performance.now();
      const result=await requestGenerationJson('image',generationBackendUrl('image'),{scenario:'long'},new AbortController().signal,
        async()=>({Authorization:'Bearer synthetic-credential','Content-Type':'application/json'}));
      return{elapsedMs:Math.round(performance.now()-start),complete:result.provider==='synthetic'&&result.image_base64==='c3ludGhldGlj',deadlineMs:GENERATION_HTTP_POLICY.image.clientTimeoutMs};
    });
    assert(long.complete&&long.elapsedMs>=60000&&long.elapsedMs<long.deadlineMs);assert(observed.longCompleted&&observed.bodyStallCancelled&&observed.headerStallCancelled);
    assert(observed.preflights>0);assert.equal(observed.authorizationMissing,0);assert.equal(observed.cookiesReceived,0);assert.equal(observed.redirectFollowed,0);assert.equal(externalRequests,0);
    await context.close();
    console.log(JSON.stringify({v:1,passed:true,actualChromiumCrossOriginFetch:true,actualPreflightAndBearerHeader:true,syntheticAuthAndResponse:true,realFirebaseOrProviderTested:false,
      faults,long,observed,externalRequests,externalProxyRequests,nonLoopbackProxyNeverForwards:true,allowedTrafficNotIntercepted:true,lowerLimitsUsedOnlyForFaultCases:true,productionClientDeadlineUsedForLongCase:true,productionMutations:0,generativeProviderCalls:0,secretPayloadReads:0,
      sources:['functions/src/generationHttpPolicy.ts','frontend/src/services/generationEndpoints.ts','frontend/src/services/aiGenerationTransport.ts'].map(p=>({path:path.join(root,p),sha256:hash(fs.readFileSync(path.join(root,p)))}))}));
  }finally{
    await browser?.close();for(const timer of timers)clearTimeout(timer);
    for(const service of [server,backend,blockingProxy])if(service){service.closeAllConnections();await new Promise(resolve=>service.close(resolve));}
  }
}
main().catch(error=>{console.error(JSON.stringify({error:'generation_http_browser_failed',type:error?.name,diagnostic:error?.message?.slice(0,240)}));process.exitCode=1;});
