'use strict';
// Local protocol/CORS/WebCrypto rehearsal. Auth and persistence are synthetic;
// real Firestore transactions and rules are verified separately by the emulator.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),front=path.join(root,'frontend'),activeServers=[];let phase='bundle';
async function main(){
  const {build}=require(path.join(front,'node_modules/esbuild')),{chromium}=require(path.join(front,'node_modules/@playwright/test'));
  const functionRequire=require('node:module').createRequire(path.join(root,'functions/package.json'));
  const admin=functionRequire('firebase-admin'),functions=functionRequire('firebase-functions/v1'),express=functionRequire('express');
  const {executeGetPublicCapsule,executeRecordCapsuleOpening,executeRevokePublicCapsule,capsuleOwnerSourceToken,consumePublicCapsuleBudget}=require(path.join(root,'functions/lib/publicCapsules'));
  const state={now:Date.now(),enabled:true,admissions:0},docs=new Map([['users/synthetic-owner',{uid:'synthetic-owner'}]]),requests=[];
  const reference=value=>({path:value}),snapshot=ref=>({exists:docs.has(ref.path),createTime:new admin.firestore.Timestamp(1,0),data:()=>structuredClone(docs.get(ref.path))});
  let tail=Promise.resolve();const db={doc:reference,runTransaction:body=>{
    const result=tail.then(async()=>{const writes=[],tx={get:async ref=>snapshot(ref),getAll:async(...refs)=>refs.map(snapshot),set:(ref,data)=>writes.push(['set',ref.path,data]),
      create:(ref,data)=>writes.push(['create',ref.path,data]),update:(ref,data)=>writes.push(['update',ref.path,data])};const output=await body(tx);
      for(const[mode,key]of writes){if(mode==='create')assert(!docs.has(key));if(mode==='update')assert(docs.has(key));}
      for(const[mode,key,data]of writes)docs.set(key,mode==='update'?{...docs.get(key),...data}:data);return output;});tail=result.catch(()=>{});return result;
  }};
  const deps={firestore:db,now:()=>state.now,enabled:()=>state.enabled,auth:{getUser:async uid=>({uid,disabled:false})},admitRevoke:async()=>true,
    admit:async()=>{state.admissions++;return consumePublicCapsuleBudget(db,'synthetic-network',state.now);}};
  const api=express();api.use(express.json({limit:'2mb'}));api.use((req,_res,next)=>{requests.push({method:req.method,path:req.path,headers:req.headers,body:req.body});next();});
  api.all('/getPublicCapsule',functions.https.onCall(data=>executeGetPublicCapsule(data,deps)));
  api.all('/recordCapsuleOpening',functions.https.onCall(data=>executeRecordCapsuleOpening(data,deps)));
  const rpc=http.createServer(api);activeServers.push(rpc);await new Promise(resolve=>rpc.listen(0,'127.0.0.1',resolve));const rpcOrigin=`http://127.0.0.1:${rpc.address().port}`;
  const source=`import{callPublicCapsule,createPublicCapsuleService}from'./src/services/publicCapsuleService';import{encryptSharePayload,decryptSharePayload}from'./src/utils/encryptedShare';
    const pass='SYNTHETIC_LOCAL_PASSPHRASE',plain='SYNTHETIC_PRIVATE_CAPSULE_TEXT';let lose=false;const rpc=${JSON.stringify(rpcOrigin)};
    const request=async(url,options)=>{const target=new URL(url);if(target.origin!=='https://europe-west1-demo-mnemosyne-rules.cloudfunctions.net')throw Error('Unexpected origin');
      const response=await fetch(rpc+target.pathname,options);if(lose&&target.pathname==='/recordCapsuleOpening'&&response.ok){lose=false;await response.arrayBuffer();throw TypeError('Synthetic lost response');}return response;};
    const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
    const service=createPublicCapsuleService({call:(name,value)=>callPublicCapsule(name,value,request),hash});
    window.capsuleTest={cipher:()=>encryptSharePayload(plain,pass),read:()=>service.read('capsule'),decrypt:async value=>(await decryptSharePayload(value.ciphertext,pass))===plain,
      wrong:async value=>{try{await decryptSharePayload(value.ciphertext,'SYNTHETIC_WRONG_PASSPHRASE');return false;}catch{return true;}},
      opening:async value=>{lose=true;return service.opening({v:1,shareId:'capsule',openingId:crypto.randomUUID(),sourceDigest:value.sourceDigest,viewDeadline:value.viewDeadline});},
      reject:async()=>{try{await service.read('capsule');return false;}catch(error){return error.message==='Não foi possível carregar a cápsula. Tenta novamente mais tarde.';}},
      extra:async()=>{try{await callPublicCapsule('getPublicCapsule',{v:1,shareId:'capsule',passphrase:pass},request);return false;}catch{return true;}}};`;
  const stub=`export const auth={currentUser:null};export default{options:{projectId:'demo-mnemosyne-rules'}};`;
  const bundle=await build({stdin:{contents:source,resolveDir:front,sourcefile:'public-capsule-browser.ts'},bundle:true,format:'iife',platform:'browser',write:false,logLevel:'silent',plugins:[{
    name:'synthetic-firebase-only',setup(builder){builder.onResolve({filter:/firebase\/auth$|firebase\/functions$|(?:^|\/)firebase$/},args=>({path:args.path,namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='firebase/auth'?'export const onAuthStateChanged=()=>{throw Error("Unexpected authenticated RPC")};':args.path==='firebase/functions'?'export const getFunctions=()=>{throw Error("Unexpected authenticated RPC")};export const httpsCallable=getFunctions;':stub,loader:'js'}));}
  }]});
  const web=http.createServer((req,res)=>{res.setHeader('Content-Security-Policy',`default-src 'self'; connect-src ${rpcOrigin}`);if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><script src="/app.js"></script>');}});
  activeServers.push(web);await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${web.address().port}`;let browser,externalRequests=0;
  try{
    phase='real-callable-cors-and-local-crypto';browser=await chromium.launch({headless:true});const context=await browser.newContext();
    // Request interception can suppress browser preflights. CSP bounds network
    // access while leaving Chromium's CORS implementation in the actual path.
    context.on('request',request=>{if(![origin,rpcOrigin].includes(new URL(request.url()).origin))externalRequests++;});
    await context.addCookies([{name:'synthetic_private_cookie',value:'SYNTHETIC_COOKIE',url:origin}]);const page=await context.newPage();await page.goto(origin+'/capsule#k=SYNTHETIC_FRAGMENT_KEY');await page.waitForFunction(()=>window.capsuleTest);
    const ciphertext=await page.evaluate(()=>window.capsuleTest.cipher());docs.set('shares/capsule',{uid:'synthetic-owner',sessionId:'synthetic-private-session',titleHint:'SYNTHETIC_PRIVATE_TITLE',
      text:'SYNTHETIC_PRIVATE_LEGACY_TEXT',encrypted:true,ciphertext,createdAt:state.now,expiresAt:null,views:0});
    const initial=await page.evaluate(()=>window.capsuleTest.read());assert(await page.evaluate(value=>window.capsuleTest.decrypt(value),initial));
    const requestCount=requests.length;assert(await page.evaluate(value=>window.capsuleTest.wrong(value),initial));assert.equal(requests.length,requestCount);
    assert.equal(await page.evaluate(value=>window.capsuleTest.opening(value),initial),1);assert.equal(docs.get('shares/capsule').views,1);
    const openings=requests.filter(row=>row.method==='POST'&&row.path==='/recordCapsuleOpening');assert.equal(openings.length,2);assert.deepEqual(openings[0].body,openings[1].body);
    assert.equal([...docs.keys()].filter(key=>key.includes('/capsuleOpenings/')).length,1);
    const repeated=await page.evaluate(()=>window.capsuleTest.read());assert.equal(repeated.views,1);assert.equal(repeated.sourceDigest,initial.sourceDigest);
    const beforeExtra=requests.length;assert(await page.evaluate(()=>window.capsuleTest.extra()));assert.equal(requests.length,beforeExtra);
    phase='withdrawal-and-closed-gate';await executeRevokePublicCapsule('synthetic-owner',{v:2,actorUid:'synthetic-owner',shareId:'capsule',sourceToken:capsuleOwnerSourceToken('capsule',snapshot(reference('shares/capsule')))},deps);assert(await page.evaluate(()=>window.capsuleTest.reject()));
    const beforeGate=state.admissions;state.enabled=false;assert(await page.evaluate(()=>window.capsuleTest.reject()));assert.equal(state.admissions,beforeGate);
    phase='privacy-assertions';process.stdout.write(JSON.stringify({requestMethods:requests.map(row=>row.method),headerPresence:requests.map(row=>({method:row.method,auth:!!row.headers.authorization,cookie:!!row.headers.cookie,referrer:!!row.headers.referer}))})+'\n');assert(requests.some(row=>row.method==='OPTIONS'));for(const row of requests){assert(!row.headers.authorization);assert(!row.headers.cookie);assert(!row.headers.referer);
      const serialized=JSON.stringify(row);for(const canary of['SYNTHETIC_LOCAL_PASSPHRASE','SYNTHETIC_PRIVATE_CAPSULE_TEXT','SYNTHETIC_FRAGMENT_KEY','synthetic-owner','synthetic-private-session'])assert(!serialized.includes(canary));}
    for(const value of[initial,repeated])for(const key of['uid','sessionId','titleHint','text'])assert(!(key in value));assert.equal(externalRequests,0);
    await context.close();process.stdout.write(JSON.stringify({v:1,realCallableProtocol:true,realCrossOriginPreflight:true,realClientTransport:true,realWebCrypto:true,lostResponseExactRetryCountsOnce:true,
      noAuthCookiesReferrerOrFragmentInRpc:true,noPrivateSourceFieldsInPublicResponse:true,localWrongKeyNoRpc:true,withdrawalAndClosedGateRefused:true,syntheticAuthAndStore:true,
      realFirestoreCoveredSeparately:true,nativeHardwareAcceptance:false,externalRequests,productionMutations:0,postRequests:requests.filter(row=>row.method==='POST').length})+'\n');
  }finally{if(browser)await browser.close();for(const server of[web,rpc]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
}
main().catch(error=>{for(const server of activeServers){server.closeAllConnections();server.close();}process.stderr.write(JSON.stringify({error:'public_capsule_browser_failed',phase,errorType:error?.name||'Error',buildDiagnostics:phase==='bundle'&&error.errors?error.errors.map(item=>({text:item.text,file:item.location?.file,line:item.location?.line})):undefined})+'\n');process.exitCode=1;});
