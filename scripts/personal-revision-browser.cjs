'use strict';
/** Real browser vault, journal and Web Locks; actual revision executor with a synthetic localhost database. */
const path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
process.env.GCLOUD_PROJECT='demo-mnemosyne-rules';
const admin=require('../functions/node_modules/firebase-admin');
const {executePersonalRevisionPreparation,executePersonalRevision}=require('../functions/lib/personalRevisions');
const frontend=path.resolve(__dirname,'../frontend');let phase='runtime';
async function main(){
  if(process.versions.node.split('.')[0]!=='22')throw Error();
  const {build}=require(path.join(frontend,'node_modules/esbuild')),{chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const source=`import * as revision from './src/services/personalLearnedRevision';import * as vault from './src/services/memoryCrypto';import {withClipCaptureLock} from './src/services/clipCaptureService';
    const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];vault.setMemoryCryptoMnemonic(words);
    const rpc=async(mode,value)=>{const response=await fetch('/rpc/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!response.ok)throw Error('Synthetic refusal');return response.json();};
    window.revisionTest={revision,vault,reset:()=>vault.setMemoryCryptoMnemonic(words),enabled:true,inferences:0,seals:0,replace:false,
      initial:()=>vault.buildEncryptedMemoryFields('SYNTHETIC_PRIVATE_REVISION_PREVIOUS_219','Synthetic title'),
      deps:uid=>({enabled:()=>window.revisionTest.enabled,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,
        read:()=>rpc('read',{}),encryptContent:vault.buildEncryptedMemoryFields,decryptJournal:vault.decryptMemoryEnvelope,
        encryptJournal:async value=>{window.revisionTest.seals++;return vault.encryptMemoryFields(value);},
        mutation:{uid:()=>uid,ready:vault.isMemoryCryptoReady,subscribe:vault.onMemoryCryptoChanged},
        call:async(mode,value)=>{const result=await rpc(mode,value);if(window.revisionTest.replace){window.revisionTest.replace=false;localStorage.setItem(revision.personalRevisionCheckpointKey(uid),'replacement');}return result;}}),
      capture:()=>revision.capturePersonalRevisionBaseline({uid:'alice',id:'note'},window.revisionTest.deps('alice')),
      start:async baseline=>revision.revisePersonalLearnedMemory({uid:'alice',id:'note',baseline,prepare:async guard=>{window.revisionTest.inferences++;guard();return{text:'SYNTHETIC_PRIVATE_REVISION_NEW_219',title:'New title',embedding:[.1,.2],embeddingModel:'synthetic-local',semanticClusterId:null,position:[1,2,3],importance:.6,processingMethod:'learned:revision'};}},window.revisionTest.deps('alice'))};`;
  phase='bundle';const bundled=await build({stdin:{contents:source,resolveDir:frontend,loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',plugins:[{name:'synthetic-app',setup(builder){
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'stub',namespace:'stub'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db={};export const auth={currentUser:null};export default {};',loader:'js'}));
  }}]});
  const docs=new Map([['users/alice',{}]]),stamps=new Map();let clock=1;let queue=Promise.resolve();
  const ref=p=>({path:p,id:p.split('/').pop(),collection:n=>({doc:id=>ref(p+'/'+n+'/'+id)})});
  const db={doc:ref,runTransaction:work=>{const result=queue.then(async()=>{const writes=[];const get=async r=>{assert.equal(writes.length,0);return{exists:docs.has(r.path),updateTime:admin.firestore.Timestamp.fromMillis(stamps.get(r.path)||1),data:()=>structuredClone(docs.get(r.path))};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push({r,data});},update:(r,data)=>writes.push({r,data,update:true}),set:(r,data)=>writes.push({r,data})});
    for(const {r,data,update}of writes){docs.set(r.path,update?{...docs.get(r.path),...data}:data);stamps.set(r.path,++clock);}return result;});queue=result.catch(()=>{});return result;}};
  const deps={firestore:db,now:()=>1000};let loseAck=false,failStatus=false,browser,externalRequests=0;const counts={prepare:0,status:0,apply:0,cancel:0,read:0};
  const server=http.createServer(async(request,response)=>{
    if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Synthetic revision test</title><script src="/bundle.js"></script>');return;}
    if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundled.outputFiles[0].text);return;}
    const match=/^\/rpc\/(read|prepare|status|apply|cancel)$/.exec(request.url||'');if(!match||request.method!=='POST'){response.writeHead(404);response.end();return;}
    try{let raw='';for await(const bytes of request){raw+=bytes;if(Buffer.byteLength(raw)>2_101_000)throw Error();}assert.equal(raw.includes('SYNTHETIC_PRIVATE_REVISION'),false);
      const mode=match[1];counts[mode]++;if(mode==='status'&&failStatus){response.writeHead(503);response.end('{}');return;}
      const value=JSON.parse(raw);const result=mode==='read'?docs.get('sessions/note'):mode==='prepare'?await executePersonalRevisionPreparation('alice',value,deps):await executePersonalRevision('alice',value,mode,deps);
      response.writeHead(200,{'Content-Type':'application/json'});if(mode==='apply'&&loseAck){loseAck=false;response.end('{');}else response.end(JSON.stringify(result));
    }catch{response.writeHead(400);response.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){externalRequests++;return route.abort();}return route.continue();});
    const first=await context.newPage(),second=await context.newPage();await first.goto(origin);await second.goto(origin);await first.waitForFunction(()=>window.revisionTest);await second.waitForFunction(()=>window.revisionTest);
    const initial=await first.evaluate(()=>window.revisionTest.initial());docs.set('sessions/note',{uid:'alice',teamId:null,timestamp:1,updatedAt:10,...initial,connections:['peer'],learning:{source:'text-generation'}});
    const start=()=>first.evaluate(async()=>{const api=window.revisionTest;try{return{ok:true,result:await api.start(await api.capture())};}catch{return{ok:false};}});
    phase='lost-ack';loseAck=true;assert.equal((await start()).ok,false);assert.equal(counts.apply,1);const saved=structuredClone(docs.get('sessions/note'));assert.equal([...docs.keys()].filter(p=>p.includes('/versions/')).length,1);
    const raw=await first.evaluate(()=>localStorage.getItem(window.revisionTest.revision.personalRevisionCheckpointKey('alice')));assert.ok(raw);assert.equal(raw.includes('SYNTHETIC_PRIVATE_REVISION'),false);assert.equal(raw.includes('alice'),false);
    docs.delete('sessions/note');phase='other-tab-closed-confirmation';assert.equal(await second.evaluate(async()=>{const api=window.revisionTest;api.enabled=false;return(await api.revision.recoverPendingPersonalRevision('alice',api.deps('alice'))).status;}),'committed');assert.equal(counts.apply,1);assert.equal(docs.has('sessions/note'),false);
    const decrypted=await second.evaluate(async cipher=>window.revisionTest.vault.decryptMemoryEnvelope(cipher),saved.enc);assert.equal(decrypted.text,'SYNTHETIC_PRIVATE_REVISION_NEW_219');docs.set('sessions/note',saved);
    phase='stale-draft';const baseline=await first.evaluate(()=>window.revisionTest.capture());docs.get('sessions/note').connections.push('later');stamps.set('sessions/note',++clock);
    const beforeStale={...counts};assert.equal(await first.evaluate(async baseline=>{const api=window.revisionTest;try{await api.start(baseline);return false;}catch{return true;}},baseline),true);assert.equal(counts.apply,beforeStale.apply);assert.equal(await first.evaluate(()=>window.revisionTest.inferences),1);
    phase='unconfirmed-journal';failStatus=true;assert.equal((await start()).ok,false);failStatus=false;const beforeInvalid={...counts};
    assert.deepEqual(await second.evaluate(async()=>{const api=window.revisionTest;const key=api.revision.personalRevisionCheckpointKey('alice'),raw=localStorage.getItem(key);localStorage.setItem(api.revision.personalRevisionCheckpointKey('bob'),raw);let owner=false,vault=false,tamper=false;
      try{await api.revision.recoverPendingPersonalRevision('bob',api.deps('bob'));}catch{owner=true;}
      api.vault.setMemoryCryptoMnemonic(['accident','access','abuse','absurd','abstract','absorb','absent','above','about','able','ability','abandon']);try{await api.revision.recoverPendingPersonalRevision('alice',api.deps('alice'));}catch{vault=true;}api.reset();
      const cipher=JSON.parse(raw);cipher.ct=(cipher.ct[0]==='A'?'B':'A')+cipher.ct.slice(1);localStorage.setItem(key,JSON.stringify(cipher));try{await api.revision.recoverPendingPersonalRevision('alice',api.deps('alice'));}catch{tamper=true;}localStorage.setItem(key,raw);return{owner,vault,tamper};}),{owner:true,vault:true,tamper:true});assert.deepEqual(counts,beforeInvalid);
    phase='web-lock';await first.evaluate(()=>{window.lockHeld=false;navigator.locks.request(window.revisionTest.revision.personalRevisionCheckpointKey('alice'),async()=>{window.lockHeld=true;await new Promise(resolve=>{window.releaseLock=resolve;});});});await first.waitForFunction(()=>window.lockHeld);
    assert.equal(await second.evaluate(async()=>{const api=window.revisionTest;try{await api.revision.recoverPendingPersonalRevision('alice',api.deps('alice'));return false;}catch{return true;}}),true);assert.deepEqual(counts,beforeInvalid);await first.evaluate(()=>window.releaseLock());
    phase='cancel-unknown';assert.equal(await second.evaluate(async()=>{const api=window.revisionTest;return(await api.revision.cancelPendingPersonalRevision('alice',api.deps('alice'))).status;}),'cancelled');assert.equal(counts.apply,beforeInvalid.apply);
    phase='raw-replacement';failStatus=true;assert.equal((await start()).ok,false);failStatus=false;const beforeReplacement={...counts};assert.equal(await second.evaluate(async()=>{const api=window.revisionTest;api.replace=true;try{await api.revision.recoverPendingPersonalRevision('alice',api.deps('alice'));return false;}catch{return localStorage.getItem(api.revision.personalRevisionCheckpointKey('alice'))==='replacement';}}),true);assert.equal(counts.apply,beforeReplacement.apply);
    assert.equal(externalRequests,0);process.stdout.write(JSON.stringify({v:1,browser:'Chromium',realVaultCrypto:true,realLocalStorage:true,realWebLocks:true,actualServerExecutor:true,syntheticDatabase:true,syntheticLocalSemantic:true,
      lostAck:true,anotherTabRecovery:true,closedGateConfirmation:true,parentDeletionNoResurrection:true,staleDraftRefusedBeforeInference:true,wrongOwnerRejected:true,wrongVaultRejected:true,tamperRejected:true,concurrentTabRefusedBeforeRpc:true,closedGateCancellation:true,rawReplacementPreserved:true,externalRequests,productionMutations:0})+'\n');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'synthetic_revision_browser_failed',phase,errorType:error?.name||'Error'})+'\n');process.exitCode=1;});
