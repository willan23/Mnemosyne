'use strict';
// Synthetic local browser policy check; does not certify a Tauri/WebView2 build or model pipeline.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{chromium}=require('../frontend/node_modules/playwright');
const configBytes=fs.readFileSync(path.join(root,'frontend/src-tauri/tauri.conf.json')),policy=JSON.parse(configBytes).app.security.csp;
assert.equal(typeof policy,'string');assert(policy.includes("script-src 'self' 'wasm-unsafe-eval'"));assert(!policy.includes("'unsafe-eval'"));
const original=policy.replace(" 'wasm-unsafe-eval'",'');
const compile="async function compile(){try{await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));return{compiled:true};}catch(error){return{compiled:false,policyRefusal:/Content Security Policy|unsafe-eval|wasm-unsafe-eval/i.test(error.message)};}}";
const server=http.createServer((req,res)=>{
  const without=req.url.startsWith('/without-wasm'),csp=without?original:policy;
  res.setHeader('Content-Security-Policy',csp);
  if(req.url.endsWith('/worker.js')){res.setHeader('Content-Type','text/javascript');res.end(compile+'compile().then(result=>self.postMessage(result));');return;}
  if(req.url.endsWith('/probe.js')){res.setHeader('Content-Type','text/javascript');res.end(compile+"(async()=>{let evalBlocked=false;try{new Function('return 1')();}catch{evalBlocked=true;}const workerResult=new Promise((resolve,reject)=>{const worker=new Worker('./worker.js');worker.onmessage=event=>{worker.terminate();resolve(event.data);};worker.onerror=reject;});window.probeResult={main:await compile(),worker:await workerResult,evalBlocked,inlineBlocked:window.inlineRan!==true};})();");return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><body><script>window.inlineRan=true;</script><script src="./probe.js"></script></body></html>');
});
async function run(){
  const args=process.argv.slice(2);assert(args.length===0||args.length===2&&args[0]==='--out'&&path.isAbsolute(args[1]));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  let browser;const cases=[],requests=[];
  try{
    browser=await chromium.launch({headless:true});
    for(const [name,target]of [['configured','/configured/'],['without_wasm_control','/without-wasm/']]){
      const context=await browser.newContext();await context.route('**/*',route=>{const request=route.request(),local=new URL(request.url()).origin===origin;requests.push({local,method:request.method()});return local?route.continue():route.abort();});
      const page=await context.newPage();await page.goto(origin+target);await page.waitForFunction(()=>window.probeResult!==undefined,undefined,{timeout:10000});
      cases.push({name,...await page.evaluate(()=>window.probeResult)});await context.close();
    }
    assert(cases[0].main.compiled&&cases[0].worker.compiled);assert(!cases[1].main.compiled&&!cases[1].worker.compiled);
    assert(cases[1].main.policyRefusal&&cases[1].worker.policyRefusal);assert(cases.every(row=>row.evalBlocked&&row.inlineBlocked));assert(requests.every(row=>row.local&&row.method==='GET'));
    const result={v:1,generatedAt:new Date().toISOString(),configSha256:crypto.createHash('sha256').update(configBytes).digest('hex'),cases,passed:true,
      externalRequests:0,productionMutations:0,credentialReads:0,realUserDataUsed:false,nativeWebViewOrModelPipelineTested:false};
    if(args.length)fs.writeFileSync(args[1],JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(()=>{console.error('Desktop CSP local browser validation failed.');process.exitCode=1;});
