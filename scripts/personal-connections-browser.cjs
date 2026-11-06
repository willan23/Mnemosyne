'use strict';
/** Real browser vault cipher, localStorage and cross-tab Web Locks; RPC is synthetic localhost only. */
const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');
const frontend=path.resolve(__dirname,'../frontend');
const {parsePersonalConnectionPair,parsePersonalConnectionRequest,personalConnectionRequestBytes}=require('../functions/lib/personalConnectionContract');
let phase='runtime';
async function main(){
  if(process.versions.node.split('.')[0]!=='22')throw Error();
  const {build}=require(path.join(frontend,'node_modules/esbuild'));const {chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const source=`import * as graph from './src/services/personalConnections';import * as vault from './src/services/memoryCrypto';
    import {withClipCaptureLock} from './src/services/clipCaptureService';
    const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];vault.setMemoryCryptoMnemonic(words);
    window.graphTest={graph,vault,reset:()=>vault.setMemoryCryptoMnemonic(words),enabled:true,
      deps:uid=>({enabled:()=>window.graphTest.enabled,storage:localStorage,exclusive:withClipCaptureLock,id:()=>crypto.randomUUID(),
        encryptJournal:vault.encryptMemoryFields,decryptJournal:vault.decryptMemoryEnvelope,
        mutation:{uid:()=>uid,ready:vault.isMemoryCryptoReady,subscribe:vault.onMemoryCryptoChanged},
        call:async(mode,request)=>{const response=await fetch('/rpc/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
          if(!response.ok)throw Error('Synthetic refusal');return response.json();}})};`;
  phase='bundle';const bundled=await build({stdin:{contents:source,resolveDir:frontend,loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',plugins:[{name:'synthetic-app',setup(builder){
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'stub',namespace:'stub'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db={};export const auth={currentUser:null};export default {};',loader:'js'}));
  }}]});
  const receipts=new Map();const plans=[];let loseApplyAck=true;let failStatus=false;let externalRequests=0;let browser;
  const counts={prepare:0,status:0,apply:0,cancel:0};
  const server=http.createServer(async(request,response)=>{
    if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Synthetic graph test</title><script src="/bundle.js"></script>');return;}
    if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundled.outputFiles[0].text);return;}
    const match=/^\/rpc\/(prepare|status|apply|cancel)$/.exec(request.url||'');if(!match||request.method!=='POST'){response.writeHead(404);response.end();return;}
    try{
      let raw='';for await(const bytes of request){raw+=bytes;if(raw.length>4096)throw Error();}
      const mode=match[1];counts[mode]++;const input=mode==='prepare'?parsePersonalConnectionPair(JSON.parse(raw)):parsePersonalConnectionRequest(JSON.parse(raw));
      if(mode==='status'&&failStatus){response.writeHead(503);response.end('{}');return;}
      let reply;if(mode==='prepare')reply={...input,sourceHash:'a'.repeat(64),targetHash:'b'.repeat(64)};
      else{
        const digest=createHash('sha256').update(personalConnectionRequestBytes(input)).digest('hex');
        let known=receipts.get(input.operationId);
        if(known&&known.digest!==digest)throw Error();
        if(mode==='apply'||mode==='cancel'){
          if(!known){known={operationId:input.operationId,digest,status:mode==='apply'?'committed':'cancelled',changed:mode==='apply',createdAt:1000};receipts.set(input.operationId,known);plans.push(input);}
          if(mode==='apply'&&known.status==='cancelled')throw Error();
        }
        reply=known||{operationId:input.operationId,digest,status:'unknown',changed:false,createdAt:null};
        if(mode==='apply'&&loseApplyAck){loseApplyAck=false;response.writeHead(200,{'Content-Type':'application/json'});response.end('{');return;}
      }
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(reply));
    }catch{response.writeHead(400);response.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext();
    await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){externalRequests++;return route.abort();}return route.continue();});
    const first=await context.newPage();const second=await context.newPage();await first.goto(origin);await second.goto(origin);await first.waitForFunction(()=>window.graphTest);await second.waitForFunction(()=>window.graphTest);
    phase='lost-ack';const failed=await first.evaluate(async()=>{try{const api=window.graphTest;await api.graph.changePersonalConnection('alice','source','target','link',undefined,api.deps('alice'));return false;}catch{return true;}});assert.equal(failed,true);assert.equal(counts.apply,1);
    const checkpoint=await first.evaluate(()=>localStorage.getItem(window.graphTest.graph.personalConnectionCheckpointKey('alice')));assert.ok(checkpoint);assert.equal(checkpoint.includes('source'),false);assert.equal(checkpoint.includes('alice'),false);
    phase='other-tab-recovery';const recovered=await second.evaluate(async()=>{const api=window.graphTest;api.enabled=false;const result=await api.graph.recoverPendingPersonalConnection('alice',api.deps('alice'));return{status:result.status,pending:localStorage.getItem(api.graph.personalConnectionCheckpointKey('alice'))};});
    assert.deepEqual(recovered,{status:'committed',pending:null});assert.equal(counts.apply,1);assert.equal(counts.prepare,1);assert.equal(plans.length,1);
    phase='cancel-unknown';failStatus=true;
    await first.evaluate(async()=>{const api=window.graphTest;try{await api.graph.changePersonalConnection('alice','source','target','unlink',undefined,api.deps('alice'));}catch{}});failStatus=false;
    const cancelled=await second.evaluate(async()=>{const api=window.graphTest;const result=await api.graph.cancelPendingPersonalConnection('alice',api.deps('alice'));return{status:result.status,pending:localStorage.getItem(api.graph.personalConnectionCheckpointKey('alice'))};});
    assert.deepEqual(cancelled,{status:'cancelled',pending:null});assert.equal(counts.cancel,1);assert.equal(plans.length,2);
    phase='owner-and-vault';failStatus=true;
    await first.evaluate(async()=>{const api=window.graphTest;try{await api.graph.changePersonalConnection('alice','source','target','link',undefined,api.deps('alice'));}catch{}});failStatus=false;
    const beforeInvalid={...counts};const invalid=await second.evaluate(async()=>{
      const api=window.graphTest;const raw=localStorage.getItem(api.graph.personalConnectionCheckpointKey('alice'));localStorage.setItem(api.graph.personalConnectionCheckpointKey('bob'),raw);
      let owner=false,vault=false,tamper=false;
      try{await api.graph.recoverPendingPersonalConnection('bob',api.deps('bob'));}catch{owner=true;}
      api.vault.setMemoryCryptoMnemonic(['accident','access','abuse','absurd','abstract','absorb','absent','above','about','able','ability','abandon']);
      try{await api.graph.recoverPendingPersonalConnection('alice',api.deps('alice'));}catch{vault=true;}api.reset();
      const cipher=JSON.parse(raw);cipher.ct=(cipher.ct[0]==='A'?'B':'A')+cipher.ct.slice(1);localStorage.setItem(api.graph.personalConnectionCheckpointKey('alice'),JSON.stringify(cipher));
      try{await api.graph.recoverPendingPersonalConnection('alice',api.deps('alice'));}catch{tamper=true;}localStorage.setItem(api.graph.personalConnectionCheckpointKey('alice'),raw);
      return{owner,vault,tamper};
    });assert.deepEqual(invalid,{owner:true,vault:true,tamper:true});assert.deepEqual(counts,beforeInvalid);
    phase='web-lock';await first.evaluate(()=>{window.graphLockHolding=false;navigator.locks.request(window.graphTest.graph.personalConnectionCheckpointKey('alice'),async()=>{window.graphLockHolding=true;await new Promise(resolve=>{window.releaseGraphLock=resolve;});});});await first.waitForFunction(()=>window.graphLockHolding===true);
    const beforeLock={...counts};const busy=await second.evaluate(async()=>{const api=window.graphTest;try{await api.graph.recoverPendingPersonalConnection('alice',api.deps('alice'));return false;}catch{return true;}});assert.equal(busy,true);assert.deepEqual(counts,beforeLock);await first.evaluate(()=>window.releaseGraphLock());
    phase='unknown-retry';await second.evaluate(()=>{window.graphTest.enabled=true;});const retried=await second.evaluate(async()=>{const api=window.graphTest;return(await api.graph.recoverPendingPersonalConnection('alice',api.deps('alice'))).status;});assert.equal(retried,'committed');assert.equal(counts.prepare,3);assert.equal(plans.length,3);assert.equal(counts.apply,2);assert.equal(externalRequests,0);
    process.stdout.write(JSON.stringify({v:1,browser:'Chromium',realVaultCrypto:true,realLocalStorage:true,realWebLocks:true,lostAckRecoveredInAnotherTab:true,closedGateConfirmation:true,originalRequestRetry:true,cancelBeforeApply:true,wrongVaultRejected:true,transplantedOwnerRejected:true,cipherTamperRejected:true,concurrentTabRejectedBeforeNetwork:true,externalRequests,productionMutations:0})+'\n');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'synthetic_personal_connections_browser_failed',phase,errorType:error?.name||'Error'})+'\n');process.exitCode=1;});
