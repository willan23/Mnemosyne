'use strict';
/** Actual browser parsing, vault cipher, immutable journal and cross-tab lock; synthetic localhost RPC only. */
const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');
const frontend=path.resolve(__dirname,'../frontend');
const {parseObsidianImportPlan,parseObsidianImportIdentity,parseObsidianImportBatch,obsidianPlanBytes,obsidianPlanBatches,obsidianBatchBytes}=require('../functions/lib/obsidianImportContract');
const hash=value=>createHash('sha256').update(value).digest('hex');let phase='runtime';
async function main(){
  if(process.versions.node.split('.')[0]!=='22')throw Error();
  const {build}=require(path.join(frontend,'node_modules/esbuild'));const {chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const source=`import * as recovery from './src/services/obsidianImportRecovery';import * as vault from './src/services/memoryCrypto';
    import {buildObsidianImportPlan} from './src/services/obsidianVaultImport';import {parseObsidianFiles} from './src/services/obsidianVaultParse';import {withClipCaptureLock} from './src/services/clipCaptureService';
    const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];vault.setMemoryCryptoMnemonic(words);
    window.importTest={recovery,vault,reset:()=>vault.setMemoryCryptoMnemonic(words),enabled:true,sealCount:0,replace:false,
      prepare:async(guard,count=13)=>{const files=Array.from({length:count},(_,index)=>{const f=new File(['SYNTHETIC_PRIVATE_VAULT_BODY_503 á漢🙂 '+index+(index+1<count?' [[Note-'+(index+1)+']]':'')],'Note-'+index+'.md');Object.defineProperty(f,'webkitRelativePath',{value:'A_Diario/Note-'+index+'.md'});return f;});
        const parsed=await parseObsidianFiles(files,guard);guard();return buildObsidianImportPlan(parsed.notes,{},guard);},
      deps:uid=>({enabled:()=>window.importTest.enabled,blocked:()=>false,storage:localStorage,exclusive:withClipCaptureLock,
        encryptJournal:async value=>{window.importTest.sealCount++;return vault.encryptMemoryFields(value);},decryptJournal:vault.decryptMemoryEnvelope,
        mutation:{uid:()=>uid,ready:vault.isMemoryCryptoReady,subscribe:vault.onMemoryCryptoChanged},
        call:async(mode,request)=>{const response=await fetch('/rpc/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
          if(!response.ok)throw Error('Synthetic refusal');const result=await response.json();if(window.importTest.replace){window.importTest.replace=false;localStorage.setItem(recovery.obsidianImportCheckpointKey(uid),'replacement');}return result;}})};`;
  phase='bundle';const bundled=await build({stdin:{contents:source,resolveDir:frontend,loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',plugins:[{name:'synthetic-app',setup(builder){
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'stub',namespace:'stub'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db={};export const auth={currentUser:null};export default {};',loader:'js'}));
  }}]});
  const records=new Map();const created=new Map();const applied=[];let loseAck='create';let failStatus=false;let externalRequests=0;let browser;
  const counts={begin:0,status:0,apply:0,cancel:0};
  const server=http.createServer(async(request,response)=>{
    if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Synthetic import test</title><script src="/bundle.js"></script>');return;}
    if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundled.outputFiles[0].text);return;}
    const match=/^\/rpc\/(begin|status|apply|cancel)$/.exec(request.url||'');if(!match||request.method!=='POST'){response.writeHead(404);response.end();return;}
    try{
      let raw='';for await(const bytes of request){raw+=bytes;if(Buffer.byteLength(raw)>4_100_000)throw Error();}assert.equal(raw.includes('SYNTHETIC_PRIVATE_VAULT_BODY_503'),false);
      const mode=match[1];counts[mode]++;const input=mode==='begin'?parseObsidianImportPlan(JSON.parse(raw)):mode==='apply'?parseObsidianImportBatch(JSON.parse(raw)):parseObsidianImportIdentity(JSON.parse(raw));
      if(mode==='status'&&failStatus){response.writeHead(503);response.end('{}');return;}
      const identity={importId:input.importId,planDigest:mode==='begin'?hash(obsidianPlanBytes(input)):input.planDigest};let record=records.get(identity.importId);
      if(record)assert.equal(record.state.planDigest,identity.planDigest);
      if(mode==='begin'&&!record){record={plan:input,batches:obsidianPlanBatches(input),state:{...identity,status:'pending',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:input.memories.length,edgeCount:input.edges.length}};records.set(identity.importId,record);}
      if(mode==='apply'){
        assert.ok(record);assert.equal(record.state.status,'pending');assert.equal(input.batchIndex,record.state.nextBatch);assert.equal(obsidianBatchBytes(input),obsidianBatchBytes(record.batches[input.batchIndex]));
        for(const memory of input.memories){assert.equal(created.has(memory.sessionId),false);created.set(memory.sessionId,memory.enc);}applied.push({importId:input.importId,index:input.batchIndex,phase:input.phase});
        record.state={...record.state,nextBatch:input.batchIndex+1,createdCount:record.state.createdCount+input.memories.length,linkedCount:record.state.linkedCount+input.edges.length,status:input.batchIndex+1===record.batches.length?'complete':'pending'};
        if(loseAck===input.phase){loseAck=null;response.writeHead(200,{'Content-Type':'application/json'});response.end('{');return;}
      }
      if(mode==='cancel'){
        if(!record){record={state:{...identity,status:'cancelled',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:0,edgeCount:0}};records.set(identity.importId,record);}
        else if(record.state.status!=='complete')record.state={...record.state,status:'cancelled'};
      }
      const reply=record?.state||{...identity,status:'unknown',nextBatch:0,createdCount:0,linkedCount:0,memoryCount:0,edgeCount:0};response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(reply));
    }catch{response.writeHead(400);response.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){externalRequests++;return route.abort();}return route.continue();});
    const first=await context.newPage();const second=await context.newPage();await first.goto(origin);await second.goto(origin);await first.waitForFunction(()=>window.importTest);await second.waitForFunction(()=>window.importTest);
    const start=async(count=13)=>first.evaluate(async count=>{const api=window.importTest;try{return{ok:true,result:await api.recovery.startCapturedObsidianImport('alice',guard=>api.prepare(guard,count),undefined,undefined,api.deps('alice'))};}catch{return{ok:false};}},count);
    phase='lost-create-ack';assert.equal((await start()).ok,false);assert.equal(created.size,10);const firstRecord=[...records.values()][0];const ids=firstRecord.plan.memories.map(memory=>memory.sessionId);const ciphers=firstRecord.plan.memories.map(memory=>memory.enc);
    const checkpoint=await first.evaluate(()=>localStorage.getItem(window.importTest.recovery.obsidianImportCheckpointKey('alice')));assert.ok(checkpoint);assert.equal(checkpoint.includes('SYNTHETIC_PRIVATE_VAULT_BODY_503'),false);assert.equal(checkpoint.includes('alice'),false);
    phase='other-tab-resume';const resumed=await second.evaluate(async()=>{const api=window.importTest;const value=await api.recovery.recoverPendingObsidianImport('alice',api.deps('alice'));return{status:value.status.status,notes:value.importedConfirmed,links:value.linksConfirmed,pending:api.recovery.hasPendingObsidianImport('alice')};});
    assert.deepEqual(resumed,{status:'complete',notes:13,links:12,pending:false});assert.equal(created.size,14);assert.deepEqual(firstRecord.plan.memories.map(memory=>memory.sessionId),ids);assert.deepEqual(ids.map(id=>created.get(id)),ciphers);assert.deepEqual(applied.map(item=>item.index),[0,1,2]);assert.equal(counts.begin,1);
    phase='lost-final-ack';loseAck='link';assert.equal((await start(2)).ok,false);const before={...counts};const terminal=await second.evaluate(async()=>{const api=window.importTest;api.enabled=false;return(await api.recovery.recoverPendingObsidianImport('alice',api.deps('alice'))).status.status;});assert.equal(terminal,'complete');assert.equal(counts.apply,before.apply);assert.equal(counts.begin,before.begin);
    phase='owner-vault-tamper';failStatus=true;assert.equal((await start(2)).ok,false);failStatus=false;const beforeInvalid={...counts};const invalid=await second.evaluate(async()=>{
      const api=window.importTest;const key=api.recovery.obsidianImportCheckpointKey('alice');const raw=localStorage.getItem(key);localStorage.setItem(api.recovery.obsidianImportCheckpointKey('bob'),raw);let owner=false,vault=false,tamper=false;
      try{await api.recovery.recoverPendingObsidianImport('bob',api.deps('bob'));}catch{owner=true;}api.vault.setMemoryCryptoMnemonic(['accident','access','abuse','absurd','abstract','absorb','absent','above','about','able','ability','abandon']);
      try{await api.recovery.recoverPendingObsidianImport('alice',api.deps('alice'));}catch{vault=true;}api.reset();const cipher=JSON.parse(raw);cipher.ct=(cipher.ct[0]==='A'?'B':'A')+cipher.ct.slice(1);localStorage.setItem(key,JSON.stringify(cipher));
      try{await api.recovery.recoverPendingObsidianImport('alice',api.deps('alice'));}catch{tamper=true;}localStorage.setItem(key,raw);return{owner,vault,tamper};
    });assert.deepEqual(invalid,{owner:true,vault:true,tamper:true});assert.deepEqual(counts,beforeInvalid);
    phase='web-lock';await first.evaluate(()=>{window.importLockHolding=false;navigator.locks.request(window.importTest.recovery.obsidianImportCheckpointKey('alice'),async()=>{window.importLockHolding=true;await new Promise(resolve=>{window.releaseImportLock=resolve;});});});await first.waitForFunction(()=>window.importLockHolding);
    const beforeLock={...counts};assert.equal(await second.evaluate(async()=>{const api=window.importTest;try{await api.recovery.recoverPendingObsidianImport('alice',api.deps('alice'));return false;}catch{return true;}}),true);assert.deepEqual(counts,beforeLock);await first.evaluate(()=>window.releaseImportLock());
    phase='cancel-unknown';assert.equal(await second.evaluate(async()=>{const api=window.importTest;return(await api.recovery.cancelPendingObsidianImport('alice',api.deps('alice'))).status.status;}),'cancelled');assert.equal(counts.begin,beforeInvalid.begin);
    phase='raw-replacement';failStatus=true;assert.equal((await start(2)).ok,false);failStatus=false;const beforeReplace={...counts};assert.equal(await second.evaluate(async()=>{const api=window.importTest;api.replace=true;try{await api.recovery.recoverPendingObsidianImport('alice',api.deps('alice'));return false;}catch{return localStorage.getItem(api.recovery.obsidianImportCheckpointKey('alice'))==='replacement';}}),true);assert.equal(counts.begin,beforeReplace.begin);assert.equal(counts.apply,beforeReplace.apply);
    phase='bounded-150-notes';await first.evaluate(()=>localStorage.removeItem(window.importTest.recovery.obsidianImportCheckpointKey('alice')));const large=await start(150);assert.equal(large.ok,true);assert.equal(large.result.imported,150);assert.equal(large.result.linked,149);assert.equal(externalRequests,0);
    process.stdout.write(JSON.stringify({v:1,browser:'Chromium',realVaultCrypto:true,realMarkdownFiles:true,realLocalStorage:true,realWebLocks:true,wholePlanRecoveredInAnotherTab:true,stableIdsAndCiphers:true,lostCreateAck:true,lostFinalAck:true,closedGateConfirmation:true,unknownCancellation:true,wrongVaultRejected:true,transplantedOwnerRejected:true,cipherTamperRejected:true,concurrentTabRejectedBeforeNetwork:true,rawReplacementPreserved:true,unicodeNotes:150,syntheticRpc:true,externalRequests,productionMutations:0})+'\n');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'synthetic_obsidian_import_browser_failed',phase,errorType:error?.name||'Error'})+'\n');process.exitCode=1;});
