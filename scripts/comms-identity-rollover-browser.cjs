'use strict';
/** Actual controller/recovery UI/crypto/storage/locks; Auth and executor database are synthetic localhost boundaries. */
const path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{generateKeyPairSync}=require('node:crypto');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend');let phase='runtime';
async function main(){
  assert.equal(process.versions.node.split('.')[0],'22');
  const{build}=require(path.join(frontend,'node_modules/esbuild')),{chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const admin=require(path.join(root,'functions/node_modules/firebase-admin'));
  const{executeCommsIdentityCall}=require(path.join(root,'functions/lib/commsIdentityRollovers'));
  const{parseCommsIdentityCommand}=require(path.join(root,'functions/lib/commsIdentityContract'));
  const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
  const actual=path.join(frontend,'src/services/commsIdentityRollover.ts').replaceAll('\\','/');
  const wrapper=`import * as actual from ${JSON.stringify(actual)};export * from ${JSON.stringify(actual)};
    import * as c from './src/utils/crypto';import * as v from './src/services/memoryCrypto';import {withClipCaptureLock} from './src/services/clipCaptureService';
    const deps=()=>({enabled:()=>window.__rollover.enabled,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,prepare:async(...args)=>{window.__rollover.generations++;return c.createEncryptedIdentityCandidate(...args);},open:c.openEncryptedIdentity,retire:c.clearVolatileIdentities,encrypt:v.encryptMemoryFields,decrypt:v.decryptMemoryEnvelope,
      call:async(mode,value)=>{const response=await fetch('/rpc/'+mode,{method:'POST',headers:{'content-type':'application/json','x-synthetic-actor':window.__rollover.uid},body:JSON.stringify(value)});if(!response.ok)throw Error('Synthetic RPC unavailable');return response.json();},
      observeStorage:(uid,changed)=>{const listener=e=>{if(e.key===null||e.key==='mnemosyne_identity_vault_'+uid||e.key===actual.commsIdentityRolloverKey(uid))changed();};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);}});
    export const regenerateCommsIdentity=(uid,words,guard)=>actual.regenerateCommsIdentity(uid,words,guard,deps());
    export const recoverCommsIdentityRollover=(uid,words,guard)=>actual.recoverCommsIdentityRollover(uid,words,guard,deps());
    export const cancelCommsIdentityRollover=(uid,words,guard)=>actual.cancelCommsIdentityRollover(uid,words,guard,deps());
    export const inspectCommsIdentityConflict=(uid,words,guard)=>actual.inspectCommsIdentityConflict(uid,words,guard,deps());
    export const republishCommsIdentityConflict=(uid,words,preview,guard)=>actual.republishCommsIdentityConflict(uid,words,preview,guard,deps());
    export const loadRetainedCommsIdentities=(uid,words,guard)=>actual.loadRetainedCommsIdentities(uid,words,guard,deps());`;
  const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {CommsIdentityRolloverPanel} from './src/components/CommsIdentityRolloverPanel';
    import * as r from './src/services/commsIdentityRollover';import * as v from './src/services/memoryCrypto';import * as c from './src/utils/crypto';
    const words=${JSON.stringify(words)};v.setMemoryCryptoMnemonic(words);const ui=createRoot(document.getElementById('root'));let active=true;
    const render=()=>ui.render(React.createElement(CommsIdentityRolloverPanel,{mnemonic:words,active}));render();
    window.rolloverTest={r,v,c,words,render,active:value=>{active=value;render();},user:uid=>{window.__rollover.uid=uid;for(const cb of window.__rollover.listeners)cb({uid});},
      seed:async()=>{const uid=window.__rollover.uid,identity=await c.getOrCreateIdentity(uid,words);const response=await fetch('/seed',{method:'POST',headers:{'content-type':'application/json','x-synthetic-actor':uid},body:JSON.stringify({publicKeyPem:identity.pemPublic})});if(!response.ok)throw Error();window.__oldMessage=await c.rsaEncrypt('Synthetic historic Comms message',identity.publicKey);return identity.pemPublic;},
      start:async()=>{try{await r.regenerateCommsIdentity(window.__rollover.uid,words);return true;}catch{return false;}},recover:async()=>{try{return(await r.recoverCommsIdentityRollover(window.__rollover.uid,words)).result.status;}catch{return false;}},
      historic:async()=>{const identities=await r.loadRetainedCommsIdentities(window.__rollover.uid,words);for(const identity of identities){try{return await c.rsaDecrypt(window.__oldMessage,identity.privateKey);}catch{}}return null;}};`;
  phase='bundle';const bundled=await build({stdin:{contents:source,resolveDir:frontend,loader:'tsx'},jsx:'automatic',bundle:true,format:'iife',platform:'browser',write:false,logLevel:'silent',define:{'import.meta.env':'{}'},plugins:[{name:'localhost-boundaries',setup(builder){
    builder.onResolve({filter:/\/services\/commsIdentityRollover$/},()=>({path:'rollover',namespace:'fixture'}));
    builder.onResolve({filter:/\/config\/releaseGates$/},args=>args.importer.endsWith('CommsIdentityRolloverPanel.tsx')?{path:'gates',namespace:'fixture'}:undefined);
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'app',namespace:'fixture'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'ts',resolveDir:frontend,contents:args.path==='gates'?'export const COMMS_IDENTITY_ROLLOVERS_ENABLED=true;':args.path==='rollover'?wrapper:
      `window.__rollover={uid:'alice',listeners:new Set(),enabled:true,generations:0};export const db={};export const storage={};export const auth={get currentUser(){return{uid:window.__rollover.uid};},onAuthStateChanged(cb){window.__rollover.listeners.add(cb);return()=>window.__rollover.listeners.delete(cb);}};export default {};`}));
  }}]});
  const docs=new Map(),versions=new Map();let stamp=0,queue=Promise.resolve(),applyCalls=0,loseAck=true,denyApply=false,holdStatus=false,statusHeld=false,releaseStatus;
  const ref=p=>({path:p,id:p.split('/').pop()});
  const firestore={doc:ref,runTransaction:work=>{const run=queue.then(async()=>{const writes=[];const get=async r=>{assert.equal(writes.length,0);return{exists:docs.has(r.path),data:()=>docs.get(r.path),updateTime:admin.firestore.Timestamp.fromMillis(versions.get(r.path)||0)};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push({r,data});},set:(r,data)=>writes.push({r,data}),update:(r,data)=>writes.push({r,data,merge:true})});
    for(const{r,data,merge}of writes){const materialized=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v instanceof admin.firestore.FieldValue?admin.firestore.Timestamp.fromMillis(1000+stamp):v]));docs.set(r.path,merge?{...docs.get(r.path),...materialized}:materialized);versions.set(r.path,++stamp);}return result;
  });queue=run.catch(()=>{});return run;}};
  const deps={firestore,now:()=>Date.now()};let browser,externalRequests=0;
  const server=http.createServer(async(request,response)=>{
    try{
      if(request.url==='/'){response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>');return;}
      if(request.url==='/bundle.js'){response.writeHead(200,{'content-type':'application/javascript; charset=utf-8'});response.end(bundled.outputFiles[0].text);return;}
      if(request.method!=='POST'){response.writeHead(404);response.end();return;}
      let body='';for await(const part of request){body+=part;if(body.length>10000)throw Error('Oversize request');}
      assert.ok(!body.includes('privateKey')&&!body.includes('privateJwk')&&!body.includes('abandon')&&!body.includes('oldVaultRaw'));
      const input=JSON.parse(body),uid=request.headers['x-synthetic-actor'];let result;
      if(request.url==='/seed'){for(const collection of ['users','publicProfiles']){docs.set(collection+'/'+uid,{uid,publicKeyPem:input.publicKeyPem,displayName:'Synthetic '+uid});versions.set(collection+'/'+uid,++stamp);}result={ok:true};}
      else{const mode=request.url?.slice('/rpc/'.length);if(!['prepare','apply','status','cancel'].includes(mode))throw Error('Unknown RPC');const command=parseCommsIdentityCommand(mode,input);if(command.actorUid!==uid)throw Error('Synthetic token swap');if(mode==='apply'){applyCalls++;if(denyApply)throw Error('Synthetic unavailable');}
        result=await executeCommsIdentityCall(uid,mode,input,deps);
        if(mode==='apply'&&loseAck){loseAck=false;response.writeHead(503);response.end();return;}
        if(mode==='status'&&holdStatus){statusHeld=true;await new Promise(resolve=>releaseStatus=resolve);holdStatus=false;}
      }
      response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(result));
    }catch{response.writeHead(409);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){externalRequests++;return route.abort();}return route.continue();});
    const first=await context.newPage(),second=await context.newPage();for(const page of[first,second]){await page.goto(origin);await page.waitForFunction(()=>window.rolloverTest);}
    phase='lost-ack';const oldPem=await first.evaluate(()=>window.rolloverTest.seed()),oldRaw=await first.evaluate(()=>localStorage.getItem('mnemosyne_identity_vault_alice'));
    assert.equal(await first.evaluate(()=>window.rolloverTest.start()),false);assert.equal(await first.evaluate(()=>localStorage.getItem('mnemosyne_identity_vault_alice')),oldRaw);
    const pending=await first.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice')));assert.ok(pending&&!pending.includes('privateJwk')&&!pending.includes(oldRaw));
    assert.notEqual(docs.get('users/alice').publicKeyPem,oldPem);assert.equal(docs.get('users/alice').publicKeyPem,docs.get('publicProfiles/alice').publicKeyPem);
    phase='cross-tab-lock';await first.evaluate(()=>{window.__held=false;navigator.locks.request('mnemosyne:comms-identity:v1:alice',async()=>{window.__held=true;await new Promise(resolve=>window.__releaseLock=resolve);});});await first.waitForFunction(()=>window.__held);assert.equal(await second.evaluate(()=>window.rolloverTest.recover()),false);await first.evaluate(()=>window.__releaseLock());
    phase='locked-ui';await second.evaluate(()=>{window.__rollover.enabled=false;window.rolloverTest.v.setMemoryCryptoMnemonic(null);});await second.getByRole('button',{name:'Recuperar identidade Comms'}).waitFor();assert.equal(await second.getByRole('button',{name:'Recuperar identidade Comms'}).isDisabled(),true);
    await second.evaluate(()=>window.rolloverTest.v.setMemoryCryptoMnemonic([...window.rolloverTest.words].reverse()));assert.equal(await second.evaluate(()=>window.rolloverTest.recover()),false);assert.equal(await second.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice'))),pending);
    phase='ui-recovery-closed-gate';await second.evaluate(()=>window.rolloverTest.v.setMemoryCryptoMnemonic(window.rolloverTest.words));await second.getByRole('button',{name:'Recuperar identidade Comms'}).click();await second.getByRole('status').filter({hasText:'Troca de identidade confirmada'}).waitFor();
    assert.equal(applyCalls,1);assert.equal(await first.evaluate(()=>window.__rollover.generations),1);assert.equal(await second.evaluate(()=>window.__rollover.generations),0);
    assert.equal(await second.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice'))),null);assert.notEqual(await second.evaluate(()=>localStorage.getItem('mnemosyne_identity_vault_alice')),oldRaw);
    phase='historic-rsa-message';assert.equal(await first.evaluate(()=>window.rolloverTest.historic()),'Synthetic historic Comms message');
    phase='bound-token-swaps';const swapBefore=JSON.stringify([...docs]),swapApplies=applyCalls;
    for(const mode of ['prepare','apply','status','cancel']){const request=mode==='prepare'?{}:await first.evaluate(async()=>{const raw=[...Array(localStorage.length)].map((_,index)=>localStorage.key(index)).find(key=>key.startsWith(window.rolloverTest.r.commsIdentityHistoryPrefix('alice')));return JSON.parse((await window.rolloverTest.v.decryptMemoryEnvelope(JSON.parse(localStorage.getItem(raw)))).text).request;});
      assert.equal(await first.evaluate(async({mode,request})=>(await fetch('/rpc/'+mode,{method:'POST',headers:{'content-type':'application/json','x-synthetic-actor':'bob'},body:JSON.stringify({actorUid:'alice',request})})).ok,{mode,request}),false);
    }assert.equal(JSON.stringify([...docs]),swapBefore);assert.equal(applyCalls,swapApplies);
    phase='superseded-candidate';loseAck=true;assert.equal(await first.evaluate(()=>window.rolloverTest.start()),false);const superseded=await first.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice'))),retainedPem=docs.get('users/alice').publicKeyPem;
    const remotePem=`-----BEGIN PUBLIC KEY-----\n${generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'der'}).toString('base64')}\n-----END PUBLIC KEY-----`;
    for(const path of ['users/alice','publicProfiles/alice']){docs.get(path).publicKeyPem=remotePem;versions.set(path,++stamp);}
    await second.reload();await second.waitForFunction(()=>window.rolloverTest);await second.getByRole('button',{name:'Recuperar identidade Comms'}).click();await second.getByRole('button',{name:'Verificar conflito de identidade'}).click();const republish=second.getByRole('button',{name:'Confirmar publicação da identidade conservada'});await republish.waitFor();
    assert.equal(docs.get('users/alice').publicKeyPem,remotePem);assert.equal(await second.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice'))),superseded);
    second.once('dialog',dialog=>dialog.dismiss());await republish.click();assert.equal(docs.get('users/alice').publicKeyPem,remotePem);
    phase='stale-conflict-preview';docs.get('publicProfiles/alice').displayName='Synthetic remote metadata change';versions.set('publicProfiles/alice',++stamp);const staleApplies=applyCalls;
    second.once('dialog',dialog=>dialog.accept());await republish.click();await second.getByRole('status').filter({hasText:'verifica novamente'}).waitFor();assert.equal(applyCalls,staleApplies);assert.equal(await second.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice'))),superseded);
    phase='explicit-republish-lost-ack';await second.getByRole('button',{name:'Verificar conflito de identidade'}).click();await republish.waitFor();loseAck=true;second.once('dialog',dialog=>dialog.accept());await republish.click();await second.getByRole('status').filter({hasText:'verifica novamente'}).waitFor();
    const v2Raw=await second.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice')));assert.ok(v2Raw&&v2Raw!==superseded);assert.equal(docs.get('users/alice').publicKeyPem,retainedPem);const republishApplies=applyCalls;
    await second.reload();await second.waitForFunction(()=>window.rolloverTest);await second.evaluate(()=>window.__rollover.enabled=false);await second.getByRole('button',{name:'Recuperar identidade Comms'}).click();await second.getByRole('status').filter({hasText:'Troca de identidade confirmada'}).waitFor();assert.equal(applyCalls,republishApplies);
    assert.equal(await second.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice'))),null);assert.equal(await second.evaluate(()=>window.__rollover.generations),0);
    assert.equal(await first.evaluate(()=>window.rolloverTest.historic()),'Synthetic historic Comms message');
    phase='unknown-cancel-confirm';denyApply=true;assert.equal(await first.evaluate(()=>window.rolloverTest.start()),false);const beforeCancel=await first.evaluate(()=>localStorage.getItem('mnemosyne_identity_vault_alice'));
    second.once('dialog',dialog=>dialog.dismiss());await second.getByRole('button',{name:'Cancelar troca de identidade'}).click();assert.ok(await second.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice'))));
    second.once('dialog',dialog=>dialog.accept());await second.getByRole('button',{name:'Cancelar troca de identidade'}).click();await second.getByRole('status').filter({hasText:'Troca pendente cancelada'}).waitFor();assert.equal(await second.evaluate(()=>localStorage.getItem('mnemosyne_identity_vault_alice')),beforeCancel);
    phase='late-ui-context';assert.equal(await first.evaluate(()=>window.rolloverTest.start()),false);holdStatus=true;statusHeld=false;await second.getByRole('button',{name:'Recuperar identidade Comms'}).click();for(let n=0;n<100&&!statusHeld;n++)await second.waitForTimeout(20);assert.equal(statusHeld,true);
    await second.evaluate(()=>{window.rolloverTest.user('bob');window.rolloverTest.user('alice');});releaseStatus();await second.waitForTimeout(150);assert.equal(await second.evaluate(()=>localStorage.getItem('mnemosyne_identity_vault_alice')),beforeCancel);assert.ok(await second.evaluate(()=>localStorage.getItem(window.rolloverTest.r.commsIdentityRolloverKey('alice'))));assert.equal(await second.getByText('Não foi possível confirmar a troca.',{exact:false}).count(),0);
    assert.equal(externalRequests,0);process.stdout.write(JSON.stringify({v:1,browser:'Chromium',actualControllerAndRecoveryPanel:true,actualBackendExecutor:true,syntheticAuthRpcAndDatabase:true,realRsaAesStorageWebLocks:true,oldPrimaryRetainedAfterLostAck:true,recoverAcrossTabsWithoutGenerationOrApply:true,recoveryWithGateClosed:true,allFourIdentityEndpointsTokenSwapRefused:true,supersededPreviewAfterReloadReadOnly:true,staleReviewedBaselineRefusedWithoutApply:true,explicitRepublishRequiresConfirmation:true,republishLostAckReloadSameCipherWithGateClosed:true,retainedCandidateNotRegeneratedDuringRepublish:true,lockedPanelDisabled:true,wrongCofferPreservesJournal:true,cancelRequiresConfirmation:true,terminalCancelRetainsCiphertexts:true,historicRsaMessageReadable:true,lateAccountAbaRefused:true,applyCalls,externalRequests,providerCalls:0,productionMutations:0})+'\n');
  }finally{if(releaseStatus)releaseStatus();if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'comms_rollover_browser_failed',phase,errorType:error?.name,compileDiagnostics:phase==='bundle'?error.errors?.map(item=>({text:item.text,file:item.location?.file,line:item.location?.line})):undefined})+'\n');process.exitCode=1;});
