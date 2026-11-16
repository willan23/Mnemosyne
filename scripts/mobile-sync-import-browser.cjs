'use strict';
/** Chromium runs the real client, ECDH/AES-GCM, vault, localStorage and Web Locks against a synthetic localhost RPC. */
const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const frontend=path.resolve(__dirname,'../frontend');
const {parseSyncImportBatch,parseSyncImportStatusInput,parseSyncImportPreparation,canonicalSyncState}=require('../functions/lib/mobileSyncImportContract');
let phase='runtime';
async function main() {
  if(process.versions.node.split('.')[0]!=='22')throw Error('node22_required');
  const {build}=require(path.join(frontend,'node_modules/esbuild'));const {chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const source=`import * as sync from './src/services/mobileSyncImport';
    import * as vault from './src/services/memoryCrypto';import {withClipCaptureLock} from './src/services/clipCaptureService';
    import {canonicalSyncState} from '../functions/src/mobileSyncImportContract';
    const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
    vault.setMemoryCryptoMnemonic(words);
    const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalSyncState(value)))),n=>n.toString(16).padStart(2,'0')).join('');
    const base64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/g,'');
    window.syncTest={sync,vault,reset:()=>vault.setMemoryCryptoMnemonic(words),
      make:async count=>{const recipient=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);
        const sender=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);
        const privateKey=await crypto.subtle.exportKey('jwk',recipient.privateKey);const publicKey=await crypto.subtle.exportKey('jwk',recipient.publicKey);
        const senderPublic=await crypto.subtle.exportKey('jwk',sender.publicKey);const shared=await crypto.subtle.deriveKey({name:'ECDH',public:recipient.publicKey},sender.privateKey,{name:'AES-GCM',length:256},false,['encrypt']);
        const payload={version:1,ownerUid:'alice',source:'desktop',exportedAt:100,memories:Array.from({length:count},(_,i)=>({id:'synthetic-'+i,text:'SYNTHETIC_SYNC_PRIVATE_TEXT_492 '+i+' memória 😀',title:'SYNTHETIC_SYNC_PRIVATE_TITLE_492',timestamp:10,updatedAt:20}))};
        const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},shared,new TextEncoder().encode(JSON.stringify(payload)));
        return {privateKey,device:{deviceId:'phone',ownerUid:'alice',status:'active',publicKeyJwk:publicKey,desktopPublicKeyJwk:senderPublic},
          envelope:{id:crypto.randomUUID(),ownerUid:'alice',deviceId:'phone',direction:'desktop-to-mobile',payloadType:'memory-snapshot',status:'queued',senderPublicKeyJwk:senderPublic,
            encryptedPayload:{iv:base64(iv),data:base64(new Uint8Array(encrypted))},memoryCount:count,tombstoneIds:[],expiresAt:Date.now()+100000}};},
      deps:(uid,fixture)=>({enabled:()=>true,storage:localStorage,exclusive:withClipCaptureLock,
        list:async()=>[{id:fixture.envelope.id,data:fixture.envelope}],read:async()=>{const r=await fetch('/source/'+fixture.envelope.id);return r.json();},
        device:async()=>fixture.device,observeDevice:()=>()=>{},verifyPrivate:sync.verifySyncImportPrivateKey,decrypt:sync.decryptSyncImportEnvelope,
        prepare:vault.buildEncryptedMemoryFields,resolve:vault.decryptMemoryEnvelope,encryptJournal:vault.encryptMemoryFields,decryptJournal:vault.decryptMemoryEnvelope,digest,
        mutation:{uid:()=>uid,ready:vault.isMemoryCryptoReady,subscribe:vault.onMemoryCryptoChanged},
        call:async(mode,request)=>{const r=await fetch('/rpc/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});if(!r.ok)throw Error('Synthetic refusal');return r.json();}})};`;
  phase='bundle';const bundled=await build({stdin:{contents:source,resolveDir:frontend,loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',plugins:[{name:'synthetic-app',setup(builder){
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'stub',namespace:'stub'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const db={};export const auth={currentUser:null};export default {};',loader:'js'}));
  }}]});
  const envelopes=new Map();const receipts=new Map();const plans=[];let loseAck=true;let externalRequests=0;let plaintextRequests=0;let browser;
  const counts={status:0,prepare:0,apply:0};
  const server=http.createServer(async(request,response)=>{
    if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Synthetic sync test</title><script src="/bundle.js"></script>');return;}
    if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundled.outputFiles[0].text);return;}
    if(request.url.startsWith('/source/')){const data=envelopes.get(request.url.slice(8));response.writeHead(data?200:404,{'Content-Type':'application/json'});response.end(JSON.stringify(data??{}));return;}
    const match=/^\/rpc\/(status|prepare|apply)$/.exec(request.url||'');if(!match||request.method!=='POST'){response.writeHead(404);response.end();return;}
    try {
      let raw='';for await(const bytes of request){raw+=bytes;if(raw.length>4000000)throw Error();}
      if(raw.includes('SYNTHETIC_SYNC_PRIVATE_TEXT_492')||raw.includes('SYNTHETIC_SYNC_PRIVATE_TITLE_492'))plaintextRequests++;
      const mode=match[1];counts[mode]++;const input=mode==='apply'?parseSyncImportBatch(JSON.parse(raw)):mode==='prepare'?parseSyncImportPreparation(JSON.parse(raw)):parseSyncImportStatusInput(JSON.parse(raw));
      const envelope=envelopes.get(input.envelopeId);if(!envelope)throw Error();
      const digest=createHash('sha256').update(canonicalSyncState(envelope.encryptedPayload)).digest('hex');if(digest!==input.payloadDigest)throw Error();
      let state=receipts.get(input.envelopeId)||{envelopeId:input.envelopeId,payloadDigest:digest,cursor:0,memoryCount:envelope.memoryCount,imported:0,conflicts:0,status:'unknown'};
      let reply=state;
      if(mode==='prepare')reply={status:state,targets:input.sessionIds.map(sessionId=>({sessionId,exists:false,stateHash:null,metadataHash:null,revision:null,timestamp:null,deleted:false,enc:null}))};
      if(mode==='apply'){
        if(input.cursor!==state.cursor||input.changes.some(change=>change.action!=='create'))throw Error();
        plans.push(input);state={...state,cursor:state.cursor+input.changes.length,imported:state.imported+input.changes.length,status:state.cursor+input.changes.length===envelope.memoryCount?'complete':'pending'};
        receipts.set(input.envelopeId,state);if(state.status==='complete')envelope.status='pulled';reply=state;
        if(loseAck){loseAck=false;response.writeHead(200,{'Content-Type':'application/json'});response.end('{');return;}
      }
      response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(reply));
    }catch{response.writeHead(400);response.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    phase='browser-launch';browser=await chromium.launch({headless:true});const context=await browser.newContext();
    await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();externalRequests++;return route.abort();});
    const first=await context.newPage();await first.goto(origin);await first.waitForFunction(()=>Boolean(window.syncTest));
    phase='ecdh-and-lost-partial-ack';const fixture=await first.evaluate(()=>window.syncTest.make(13));envelopes.set(fixture.envelope.id,fixture.envelope);
    const staged=await first.evaluate(async fixture=>{const api=window.syncTest;let failed=false;try{await api.sync.importPersonalMobileSync('alice','phone','desktop-to-mobile',fixture.privateKey,api.deps('alice',fixture));}catch{failed=true;}
      const raw=localStorage.getItem(api.sync.mobileSyncImportCheckpointKey('alice','phone','desktop-to-mobile'));
      return {failed,persisted:Boolean(raw),encrypted:raw?api.vault.isEncryptedMemoryEnvelope(JSON.parse(raw)):false,plaintextAbsent:raw?!raw.includes('SYNTHETIC_SYNC_PRIVATE')&&!raw.includes(fixture.envelope.id):false};},fixture);
    assert.equal(Object.values(staged).every(value=>value===true),true);assert.equal(receipts.get(fixture.envelope.id).cursor,10);
    phase='cross-tab-resume';const second=await context.newPage();await second.goto(origin);await second.waitForFunction(()=>Boolean(window.syncTest));
    const resumed=await second.evaluate(async fixture=>{const api=window.syncTest;const result=await api.sync.importPersonalMobileSync('alice','phone','desktop-to-mobile',fixture.privateKey,api.deps('alice',fixture));
      return result.importedMemories===13&&result.pulledEnvelopes===1&&!localStorage.getItem(api.sync.mobileSyncImportCheckpointKey('alice','phone','desktop-to-mobile'));},fixture);
    assert.equal(resumed,true);assert.deepEqual(plans.map(plan=>plan.cursor),[0,10]);
    phase='local-at-rest-round-trip';const decrypted=await second.evaluate(async cipher=>{const fields=await window.syncTest.vault.decryptMemoryEnvelope(cipher);return fields.text==='SYNTHETIC_SYNC_PRIVATE_TEXT_492 0 memória 😀'&&fields.title==='SYNTHETIC_SYNC_PRIVATE_TITLE_492';},plans[0].changes[0].enc);assert.equal(decrypted,true);
    phase='tampered-cipher-and-wrong-device-key';const rejected=await second.evaluate(async fixture=>{const api=window.syncTest;let tamper=false;let wrong=false;
      try{await api.sync.decryptSyncImportEnvelope({...fixture.envelope,encryptedPayload:{...fixture.envelope.encryptedPayload,data:(fixture.envelope.encryptedPayload.data[0]==='A'?'B':'A')+fixture.envelope.encryptedPayload.data.slice(1)}},fixture.privateKey,()=>{});}catch{tamper=true;}
      try{await api.sync.verifySyncImportPrivateKey(fixture.privateKey,fixture.device.desktopPublicKeyJwk,()=>{});}catch{wrong=true;}return tamper&&wrong;},fixture);assert.equal(rejected,true);
    phase='lost-final-ack';const final=await first.evaluate(()=>window.syncTest.make(1));envelopes.set(final.envelope.id,final.envelope);loseAck=true;
    const failed=await first.evaluate(async fixture=>{try{const api=window.syncTest;await api.sync.importPersonalMobileSync('alice','phone','desktop-to-mobile',fixture.privateKey,api.deps('alice',fixture));return false;}catch{return true;}},final);assert.equal(failed,true);
    phase='checkpoint-owner-and-vault-binding';const beforeInvalid={...counts};
    const binding=await second.evaluate(async fixture=>{const api=window.syncTest;const key=api.sync.mobileSyncImportCheckpointKey('alice','phone','desktop-to-mobile');const other=api.sync.mobileSyncImportCheckpointKey('bob','phone','desktop-to-mobile');localStorage.setItem(other,localStorage.getItem(key));let owner=false;let vault=false;
      try{await api.sync.importPersonalMobileSync('bob','phone','desktop-to-mobile',fixture.privateKey,api.deps('bob',fixture));}catch{owner=true;}localStorage.removeItem(other);
      api.vault.setMemoryCryptoMnemonic(['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','zoo']);
      try{await api.sync.importPersonalMobileSync('alice','phone','desktop-to-mobile',fixture.privateKey,api.deps('alice',fixture));}catch{vault=true;}api.reset();return owner&&vault;},final);
    assert.equal(binding,true);assert.deepEqual(counts,beforeInvalid);
    phase='confirm-after-device-revocation';const beforeRecovery=counts.apply;
    const confirmed=await second.evaluate(async fixture=>{const api=window.syncTest;const deps=api.deps('alice',fixture);deps.enabled=()=>false;deps.device=async()=>{throw Error('Synthetic revoked');};deps.decrypt=async()=>{throw Error('Must not decrypt again');};
      const result=await api.sync.confirmPendingMobileSyncImport('alice','phone','desktop-to-mobile',deps);return result.status==='complete'&&result.imported===1&&!localStorage.getItem(api.sync.mobileSyncImportCheckpointKey('alice','phone','desktop-to-mobile'));},final);
    assert.equal(confirmed,true);assert.equal(counts.apply,beforeRecovery);
    phase='cross-tab-lock';await first.evaluate(()=>{window.syncLockHolding=false;navigator.locks.request(window.syncTest.sync.mobileSyncImportCheckpointKey('alice','phone','desktop-to-mobile'),async()=>{window.syncLockHolding=true;await new Promise(resolve=>{window.releaseSyncLock=resolve;});});});
    await first.waitForFunction(()=>window.syncLockHolding===true);const beforeLock={...counts};
    const busy=await second.evaluate(async fixture=>{try{const api=window.syncTest;await api.sync.importPersonalMobileSync('alice','phone','desktop-to-mobile',fixture.privateKey,api.deps('alice',fixture));return false;}catch{return true;}},final);
    assert.equal(busy,true);assert.deepEqual(counts,beforeLock);await first.evaluate(()=>window.releaseSyncLock());
    assert.equal(externalRequests,0);assert.equal(plaintextRequests,0);assert.equal(counts.apply,3);
    process.stdout.write(JSON.stringify({v:1,browser:'Chromium',realEcdh:true,realVaultCrypto:true,realLocalStorage:true,realWebLocks:true,lostPartialAckResumedInAnotherTab:true,lostFinalAckConfirmedAfterRevocation:true,closedWritingGateImportConfirmation:true,transplantedOwnerRejected:true,wrongVaultRejected:true,concurrentTabRejectedBeforeNetwork:true,cipherTamperRejected:true,plaintextRequests,externalRequests,productionMutations:0})+'\n');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'synthetic_mobile_sync_browser_failed',phase,errorType:error?.name||'Error'})+'\n');process.exitCode=1;});
