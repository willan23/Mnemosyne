'use strict';
/** Real vault crypto, localStorage and Web Locks. RPC fixtures run on localhost only. */
const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');
const frontend=path.resolve(__dirname,'../frontend');
const {parseAttachedMemoryInput,canonicalAttachedMemoryJson}=require('../functions/lib/attachedMemoryContract');
let phase='runtime';
async function main(){
  if(process.versions.node.split('.')[0]!=='22')throw Error('node22_required');
  const {build}=require(path.join(frontend,'node_modules/esbuild'));const {chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const source=`import * as recovery from './src/services/attachedMemoryRecovery';import * as vault from './src/services/memoryCrypto';
    const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];vault.setMemoryCryptoMnemonic(words);
    window.creationTest={recovery,vault,uid:'alice',replace:false,reset:()=>vault.setMemoryCryptoMnemonic(words),seals:0,
      deps:()=>({storage:localStorage,uid:()=>window.creationTest.uid,ready:vault.isMemoryCryptoReady,policy:()=> 'never-cloud',generation:()=>0,id:()=>crypto.randomUUID(),
        subscribe:vault.onMemoryCryptoChanged,exclusive:async(name,work)=>navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>{if(!lock)throw Error('busy');return work();}),
        prepare:async proposal=>({teamId:null,keyEpoch:null,keyId:null,enc:(await vault.buildEncryptedMemoryFields(proposal.text,proposal.title)).enc}),
        encrypt:async fields=>{window.creationTest.seals++;return vault.encryptMemoryFields(fields);},decrypt:vault.decryptMemoryEnvelope,
        forgetUploads:async()=>{throw Error('Unexpected upload cleanup');},
        ...Object.fromEntries(['create','status','cancel'].map(mode=>[mode,async request=>{
          const reply=await fetch('/rpc/'+window.creationTest.uid+'/'+mode,{method:'POST',body:JSON.stringify(request)});if(!reply.ok)throw Error('synthetic refusal');
          const result=await reply.json();if(window.creationTest.replace){window.creationTest.replace=false;localStorage.setItem('mnemosyne:attached-memory-creation:v1:alice','replacement');}return result;
        }]))})};`;
  phase='bundle';const bundled=await build({stdin:{contents:source,resolveDir:frontend,loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,logLevel:'silent',define:{'import.meta.env':'{}'},plugins:[{name:'synthetic-app',setup(builder){
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'app',namespace:'fixture'}:undefined);
    builder.onResolve({filter:/config\/releaseGates$/},()=>({path:'gates',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='gates'?
      'export const ATTACHMENT_WRITES_ENABLED=false;export const PERSONAL_MEMORY_CREATION_ENABLED=true;export const TEAM_WRITES_ENABLED=false;':
      'export const db={};export const auth={currentUser:{uid:"alice"}};export default {};'}));
  }}]});
  const receipts=new Map();const requests=[];const counts={create:0,status:0,cancel:0};let loseAck=true;let failStatus=false;let dropCreate=false;let externalRequests=0;let browser;
  const server=http.createServer(async(request,response)=>{
    if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Synthetic creation test</title><script src="/bundle.js"></script>');return;}
    if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundled.outputFiles[0].text);return;}
    const match=/^\/rpc\/(alice|bob)\/(create|status|cancel)$/.exec(request.url||'');if(!match||request.method!=='POST'){response.writeHead(404);response.end();return;}
    try{
      let raw='';for await(const bytes of request){raw+=bytes;if(Buffer.byteLength(raw)>500000)throw Error();}
      assert.equal(raw.includes('SYNTHETIC_PRIVATE_PERSONAL_721'),false);const input=parseAttachedMemoryInput(JSON.parse(raw));assert.equal(input.teamId,null);assert.deepEqual(input.attachmentIds,[]);
      const digest=createHash('sha256').update(canonicalAttachedMemoryJson(input)).digest('hex');const mode=match[2];counts[mode]++;requests.push({mode,input});
      const receipt=receipts.get(input.sessionId);if(receipt&&(receipt.uid!==match[1]||receipt.digest!==digest))throw Error();
      if((mode==='status'&&failStatus)||(mode==='create'&&dropCreate)){response.writeHead(503);response.end('{}');return;}
      let result=receipt;
      if(!result&&mode!=='status'){result={uid:match[1],sessionId:input.sessionId,digest,status:mode==='create'?'committed':'cancelled',createdAt:1900000000000};receipts.set(input.sessionId,result);}
      if(mode==='create'&&result?.status!=='committed')throw Error();
      response.writeHead(200,{'Content-Type':'application/json'});
      if(mode==='create'&&loseAck){loseAck=false;response.end('{');return;}
      response.end(JSON.stringify(result?{sessionId:result.sessionId,digest:result.digest,status:result.status,createdAt:result.createdAt}:{sessionId:input.sessionId,digest,status:'unknown',createdAt:null}));
    }catch{response.writeHead(400);response.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;const checkpoint='mnemosyne:attached-memory-creation:v1:alice';
  try{
    phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){externalRequests++;return route.abort();}return route.continue();});
    const first=await context.newPage();await first.goto(origin);await first.waitForFunction(()=>window.creationTest);
    const start=()=>first.evaluate(async()=>{const api=window.creationTest;try{const result=await api.recovery.createPersonalMemory({uid:'alice',text:'SYNTHETIC_PRIVATE_PERSONAL_721 á漢🙂',title:'Synthetic title',metadata:{connections:[],tags:['synthetic']}},api.deps());return{ok:true,result};}catch{return{ok:false};}});
    phase='lost-ack';assert.equal((await start()).ok,false);assert.equal(receipts.size,1);const original=requests.find(item=>item.mode==='create').input;
    const raw=await first.evaluate(key=>localStorage.getItem(key),checkpoint);assert.ok(raw);assert.equal(raw.includes('SYNTHETIC_PRIVATE_PERSONAL_721'),false);assert.equal(raw.includes(original.sessionId),false);
    assert.equal((await start()).ok,false);assert.equal(counts.create,1);
    phase='second-tab';const second=await context.newPage();await second.goto(origin);await second.waitForFunction(()=>window.creationTest);
    const recovered=await second.evaluate(async()=>{const api=window.creationTest;return api.recovery.recoverAttachedMemoryCreation('alice',api.deps());});assert.equal(recovered.sessionId,original.sessionId);assert.equal(recovered.status,'committed');assert.equal(counts.create,1);
    assert.equal(await second.evaluate(()=>window.creationTest.seals),0);assert.equal(await second.evaluate(key=>localStorage.getItem(key),checkpoint),null);
    const decoded=await second.evaluate(async enc=>window.creationTest.vault.decryptMemoryEnvelope(enc),original.enc);assert.equal(decoded.text,'SYNTHETIC_PRIVATE_PERSONAL_721 á漢🙂');assert.equal(decoded.title,'Synthetic title');
    phase='pending-unknown';dropCreate=true;assert.equal((await start()).ok,false);dropCreate=false;const pendingRaw=await first.evaluate(key=>localStorage.getItem(key),checkpoint);const beforeInvalid={...counts};
    const invalid=await second.evaluate(async()=>{
      const api=window.creationTest;const key='mnemosyne:attached-memory-creation:v1:alice';const raw=localStorage.getItem(key);let owner=false,vault=false,tamper=false;
      localStorage.setItem('mnemosyne:attached-memory-creation:v1:bob',raw);api.uid='bob';try{await api.recovery.recoverAttachedMemoryCreation('bob',api.deps());}catch{owner=true;}api.uid='alice';
      api.vault.setMemoryCryptoMnemonic(['accident','access','abuse','absurd','abstract','absorb','absent','above','about','able','ability','abandon']);try{await api.recovery.recoverAttachedMemoryCreation('alice',api.deps());}catch{vault=true;}api.reset();
      const damaged=JSON.parse(raw);damaged.ct=(damaged.ct[0]==='A'?'B':'A')+damaged.ct.slice(1);localStorage.setItem(key,JSON.stringify(damaged));try{await api.recovery.recoverAttachedMemoryCreation('alice',api.deps());}catch{tamper=true;}localStorage.setItem(key,raw);return{owner,vault,tamper};
    });assert.deepEqual(invalid,{owner:true,vault:true,tamper:true});assert.deepEqual(counts,beforeInvalid);
    phase='web-lock';await first.evaluate(key=>{window.lockHeld=false;navigator.locks.request(key,async()=>{window.lockHeld=true;await new Promise(resolve=>{window.releaseLock=resolve;});});},checkpoint);await first.waitForFunction(()=>window.lockHeld);
    assert.equal(await second.evaluate(async()=>{const api=window.creationTest;try{await api.recovery.recoverAttachedMemoryCreation('alice',api.deps());return false;}catch{return true;}}),true);assert.deepEqual(counts,beforeInvalid);await first.evaluate(()=>window.releaseLock());
    phase='cancel';assert.equal(await second.evaluate(async()=>{const api=window.creationTest;return(await api.recovery.cancelPendingAttachedMemoryCreation('alice',api.deps())).status;}),'cancelled');
    assert.equal(await second.evaluate(key=>localStorage.getItem(key),checkpoint),null);
    phase='terminal-confirmation';failStatus=true;assert.equal((await start()).ok,false);failStatus=false;assert.ok(await first.evaluate(key=>localStorage.getItem(key),checkpoint));const beforeRecovery=counts.create;
    assert.equal(await second.evaluate(async()=>{const api=window.creationTest;return(await api.recovery.recoverAttachedMemoryCreation('alice',api.deps())).status;}),'committed');assert.equal(counts.create,beforeRecovery);
    phase='journal-replacement';failStatus=true;assert.equal((await start()).ok,false);failStatus=false;
    assert.equal(await second.evaluate(async()=>{const api=window.creationTest;api.replace=true;try{await api.recovery.recoverAttachedMemoryCreation('alice',api.deps());return false;}catch{return localStorage.getItem('mnemosyne:attached-memory-creation:v1:alice')==='replacement';}}),true);
    assert.ok(pendingRaw);assert.equal(externalRequests,0);
    process.stdout.write(JSON.stringify({v:1,browser:'Chromium',realVaultCrypto:true,realLocalStorage:true,realWebLocks:true,neverCloudCiphertextSync:true,closedAttachmentGate:true,lostAck:true,stableIdAndCipher:true,crossTabRecovery:true,noReencryptionOnRecovery:true,wrongVaultRejected:true,wrongOwnerRejected:true,cipherTamperRejected:true,concurrentTabRejectedBeforeRpc:true,cancelUnknown:true,terminalConfirmationFailureRetainsJournal:true,rawReplacementPreserved:true,syntheticRpc:true,externalRequests,productionMutations:0,counts})+'\n');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'personal_creation_browser_failed',phase,errorType:error?.name,compileDiagnostics:phase==='bundle'?error.errors?.map(item=>({text:item.text,file:item.location?.file,line:item.location?.line})):undefined})+'\n');process.exitCode=1;});
