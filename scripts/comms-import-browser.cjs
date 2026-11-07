'use strict';
/** Real browser vault, file cipher, IndexedDB and Web Locks. Backend executor uses a synthetic localhost DB. */
const path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
process.env.GCLOUD_PROJECT='demo-mnemosyne-rules';
const {executeCreateAttachedMemory,inspectOrCancelAttachedMemory}=require('../functions/lib/attachedMemoryCreation');
const format=require('../functions/lib/attachmentEnvelope');
const frontend=path.resolve(__dirname,'../frontend'),now=1900000000000;
const hash=b=>createHash('sha256').update(b).digest('hex');let phase='runtime';
async function main(){
  assert.equal(process.versions.node.split('.')[0],'22');
  const {build}=require(path.join(frontend,'node_modules/esbuild')),{chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const source=`import * as comms from './src/services/commsMemoryImport';import * as vault from './src/services/memoryCrypto';
    import * as upload from './src/services/attachmentUploadClient';import {uploadCheckpointDefaults} from './src/services/attachmentUploadCheckpoint';
    import {personalAttachmentKeyWrapper,openAttachment} from './src/services/attachmentCrypto';import {withClipCaptureLock} from './src/services/clipCaptureService';
    const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];vault.setMemoryCryptoMnemonic(words);
    const now=1900000000000;const rpc=async(path,input)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(!response.ok)throw Error('Synthetic refusal');return response.json();};
    function uploadDeps(uid){return{...uploadCheckpointDefaults(),uid:()=>uid,ready:vault.isMemoryCryptoReady,policy:()=> 'allow-cloud',generation:()=>0,subscribe:vault.onMemoryCryptoChanged,now:()=>now,id:()=>crypto.randomUUID(),
      prepareScope:async()=>({scope:{kind:'personal',uid},wrapper:personalAttachmentKeyWrapper}),inspect:header=>rpc('/upload/status',{header}),begin:header=>rpc('/upload/begin',{header}),complete:id=>rpc('/upload/complete',{id}),cancelPending:header=>rpc('/upload/cancel',{header}),
      post:async(_url,body,signal)=>({ok:(await fetch('/file-post',{method:'POST',body:await body.get('file').arrayBuffer(),signal})).ok})};}
    window.commsTest={comms,vault,enabled:true,inferences:0,seals:0,uploadDeps,reset:()=>vault.setMemoryCryptoMnemonic(words),
      input:attached=>{const text='SYNTHETIC_PRIVATE_COMMS_864 á漢🙂',bytes=new TextEncoder().encode(text);return{text,title:'Synthetic title',attachment:attached?{name:'Synthetic.txt',type:'text/plain',size:bytes.length,dataUrl:'data:text/plain;base64,'+btoa(String.fromCharCode(...bytes))}:null};},
      open:async(id,bytes)=>{const result=await openAttachment(new Uint8Array(bytes),{id,uid:'alice',scope:{kind:'personal',uid:'alice'}},personalAttachmentKeyWrapper,()=>{});return{metadata:result.metadata,text:new TextDecoder().decode(result.bytes)};},
      deps:uid=>{const files=uploadDeps(uid);return{enabled:()=>window.commsTest.enabled,storage:localStorage,id:()=>crypto.randomUUID(),now:()=>now,exclusive:withClipCaptureLock,policy:()=> 'allow-cloud',subscribePolicy:()=>()=>{},
        encryptJournal:async input=>{window.commsTest.seals++;return vault.encryptMemoryFields(input);},decryptJournal:vault.decryptMemoryEnvelope,encryptContent:vault.buildEncryptedMemoryFields,
        process:async()=>{window.commsTest.inferences++;return{embedding:[.1,.2],embeddingModel:'synthetic-local',importance:.6,position:[1,2,3],celestialType:'planet'};},
        prepareUpload:(input,guard)=>upload.preparePersonalAttachment(input,guard,files),validateUpload:(uid,handle,guard)=>upload.validatePreparedPersonalAttachment(uid,handle,guard,files),
        resumeUpload:(uid,handle,guard)=>upload.resumeEncryptedAttachmentUpload(uid,handle.id,files,guard,handle),forgetUpload:(uid,handle,guard)=>upload.forgetPreparedPersonalAttachment(uid,handle,guard,files),cancelUpload:(uid,handle,guard)=>upload.cancelPreparedPersonalAttachment(uid,handle,guard,files),
        call:(mode,input)=>rpc('/rpc/'+mode,input),mutation:{uid:()=>uid,ready:vault.isMemoryCryptoReady,subscribe:vault.onMemoryCryptoChanged}};}};`;
  phase='bundle';const bundled=await build({stdin:{contents:source,resolveDir:frontend,loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'import.meta.env':'{}'},plugins:[{name:'synthetic-app',setup(builder){
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'app',namespace:'fixture'}:undefined);
    builder.onResolve({filter:/config\/releaseGates$/},()=>({path:'gates',namespace:'fixture'}));
    builder.onResolve({filter:/engines\/CognitiveEngine$/},()=>({path:'semantic',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='app'?'export const db={};export const auth={currentUser:{uid:"alice"}};export default {};':args.path==='semantic'?'export const cognitiveEngine={processMemory:async()=>{throw Error("Unexpected inference");}};':
      'export const ATTACHMENT_WRITES_ENABLED=true;export const PERSONAL_MEMORY_CREATION_ENABLED=true;export const CLIP_CAPTURE_ENABLED=false;'}));
  }}]});
  const docs=new Map([['users/alice',{}],['config/attachmentSecurity',{writesEnabled:true,bucket:'synthetic-private'}]]),files=new Map();
  const ref=p=>({path:p,id:p.split('/').pop()});let queue=Promise.resolve();
  const db={doc:ref,runTransaction:work=>{const job=queue.then(async()=>{const writes=[];const get=async r=>{assert.equal(writes.length,0);return{ref:r,exists:docs.has(r.path),data:()=>structuredClone(docs.get(r.path))};};
    const result=await work({get,getAll:(...refs)=>Promise.all(refs.map(get)),create:(r,data)=>{assert.equal(docs.has(r.path),false);writes.push({r,data});},update:(r,data)=>writes.push({r,data,update:true}),set:(r,data)=>writes.push({r,data})});
    for(const {r,data,update}of writes)docs.set(r.path,update?{...docs.get(r.path),...data}:data);return result;});queue=job.catch(()=>{});return job;}};
  const deps={firestore:db,now:()=>now,teamWritesEnabled:false};let loseMemoryAck=false,loseFileAck=false,failStatus=false,filePosts=0,externalRequests=0,browser;
  const counts={apply:0,status:0,cancel:0};
  const server=http.createServer(async(request,response)=>{
    if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Synthetic Comms recovery</title><script src="/bundle.js"></script>');return;}
    if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundled.outputFiles[0].text);return;}
    try{
      const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>1_100_000)throw Error();chunks.push(chunk);}const raw=Buffer.concat(chunks);
      assert.equal(raw.includes(Buffer.from('SYNTHETIC_PRIVATE_COMMS_864')),false);
      if(request.url==='/file-post'){
        const decoded=format.decodeAttachmentHeader(raw,raw.length),record=files.get(decoded.header.id);assert.ok(record);assert.equal(record.posted,false);assert.equal(record.digest,hash(decoded.aad));record.posted=true;record.cipher=raw;filePosts++;
        response.writeHead(200);response.end('{}');return;
      }
      const input=JSON.parse(raw.toString('utf8'));
      if(request.url?.startsWith('/upload/')){
        const mode=request.url.slice(8),header=input.header?format.parseAttachmentHeader(input.header):files.get(input.id)?.header;assert.ok(header);
        const digest=hash(format.encodeAttachmentHeader(header)),bytes=format.encodeAttachmentHeader(header).length+header.cipherBytes;let record=files.get(header.id);
        if(record)assert.equal(record.digest,digest);let reply;
        if(mode==='begin'){
          if(!record){record={header,digest,bytes,status:'reserved',posted:false};files.set(header.id,record);}assert.equal(record.status,'reserved');const expiry=now+120000;
          reply={id:header.id,status:'reserved',bytes,bucket:'synthetic-private',expiresAt:expiry,url:'https://storage.googleapis.com/synthetic-private/',fields:{key:'quarantine/alice/'+header.id,'Content-Type':'application/octet-stream',policy:Buffer.from(JSON.stringify({expiration:new Date(expiry).toISOString(),conditions:[['content-length-range',bytes,bytes]]})).toString('base64'),'x-goog-signature':'synthetic'}};
        }else if(mode==='complete'){
          assert.ok(record?.posted);record.status='ready';docs.set('attachmentUploads/'+header.id,{v:1,uid:'alice',header,digest,bytes,bucket:'synthetic-private',quarantinePath:'quarantine/alice/'+header.id,publishedPath:'encrypted/'+header.id,status:'ready',expiresAt:now+900000,postExpiresAt:now+120000,storageGeneration:'1',quotaChargeBytes:2*bytes,quotaReserved:false});
          reply={id:header.id,status:'ready'};if(loseFileAck){loseFileAck=false;response.writeHead(200);response.end('{');return;}
        }else if(mode==='cancel'){
          if(!record){record={header,digest,bytes,status:'cancelled',posted:false};files.set(header.id,record);}else if(record.status!=='ready')record.status='cancelled';reply={id:header.id,digest,status:record.status};
        }else{assert.equal(mode,'status');reply={id:header.id,digest,bytes,status:record?.status||'unknown',expiresAt:record?now+900000:null,postExpiresAt:record?now+120000:null,retryAt:null};}
        response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(reply));return;
      }
      const match=/^\/rpc\/(status|apply|cancel)$/.exec(request.url||'');assert.ok(match);const mode=match[1];counts[mode]++;
      if(mode==='status'&&failStatus){response.writeHead(503);response.end('{}');return;}
      const result=mode==='apply'?await executeCreateAttachedMemory('alice',input,deps):await inspectOrCancelAttachedMemory('alice',input,mode==='cancel',deps);
      response.writeHead(200,{'Content-Type':'application/json'});if(mode==='apply'&&loseMemoryAck){loseMemoryAck=false;response.end('{');}else response.end(JSON.stringify(result));
    }catch{response.writeHead(400);response.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){externalRequests++;return route.abort();}return route.continue();});
    const first=await context.newPage(),second=await context.newPage();await first.goto(origin);await second.goto(origin);await first.waitForFunction(()=>window.commsTest);await second.waitForFunction(()=>window.commsTest);
    const start=()=>first.evaluate(async()=>{const api=window.commsTest;try{return{ok:true,result:await api.comms.importCommsMemory('alice',api.input(true),[],()=>{},api.deps('alice'))};}catch{return{ok:false};}});
    const recover=()=>second.evaluate(async()=>{const api=window.commsTest;return api.comms.recoverPendingCommsImport('alice',api.deps('alice'));});
    phase='lost-memory-ack';loseMemoryAck=true;assert.equal((await start()).ok,false);assert.equal(counts.apply,1);assert.equal(filePosts,1);
    const raw=await first.evaluate(()=>localStorage.getItem(window.commsTest.comms.commsImportCheckpointKey('alice')));assert.ok(raw);assert.equal(raw.includes('SYNTHETIC'),false);assert.equal(raw.includes('alice'),false);
    const saved=[...docs].find(([key])=>key.startsWith('sessions/'))[1],file=[...files.values()][0];docs.delete('sessions/'+saved.creationReceiptId);
    phase='cross-tab-closed-confirmation';await second.evaluate(()=>{window.commsTest.enabled=false;});assert.equal((await recover()).status,'committed');assert.equal(counts.apply,1);assert.equal(docs.has('sessions/'+saved.creationReceiptId),false);assert.equal(filePosts,1);
    assert.equal(await second.evaluate(()=>window.commsTest.inferences),0);assert.equal(await second.evaluate(()=>window.commsTest.seals),0);
    const opened=await second.evaluate(({id,bytes})=>window.commsTest.open(id,bytes),{id:file.header.id,bytes:[...file.cipher]});assert.equal(opened.text,'SYNTHETIC_PRIVATE_COMMS_864 á漢🙂');assert.equal(opened.metadata.name,'Synthetic.txt');
    assert.equal((await second.evaluate(enc=>window.commsTest.vault.decryptMemoryEnvelope(enc),saved.enc)).text,opened.text);
    phase='lost-upload-ack';loseFileAck=true;assert.equal((await start()).ok,false);const beforePosts=filePosts;
    const planned=await first.evaluate(async()=>{const api=window.commsTest;return JSON.parse((await api.vault.decryptMemoryEnvelope(JSON.parse(localStorage.getItem(api.comms.commsImportCheckpointKey('alice'))))).text).request;});
    await second.evaluate(()=>{window.commsTest.enabled=true;});assert.equal((await recover()).status,'committed');assert.equal(filePosts,beforePosts);
    assert.deepEqual(docs.get('sessions/'+planned.sessionId).enc,planned.enc);assert.equal(docs.get('sessions/'+planned.sessionId).attachments[0].url,'mnemosyne-attachment:v1:'+planned.attachmentIds[0]);
    phase='tamper-owner-vault';failStatus=true;assert.equal((await start()).ok,false);failStatus=false;const before={...counts};
    assert.deepEqual(await second.evaluate(async()=>{const api=window.commsTest,key=api.comms.commsImportCheckpointKey('alice'),raw=localStorage.getItem(key);let owner=false,vault=false,tamper=false;
      localStorage.setItem(api.comms.commsImportCheckpointKey('bob'),raw);try{await api.comms.recoverPendingCommsImport('bob',api.deps('bob'));}catch{owner=true;}
      api.vault.setMemoryCryptoMnemonic(['accident','access','abuse','absurd','abstract','absorb','absent','above','about','able','ability','abandon']);try{await api.comms.recoverPendingCommsImport('alice',api.deps('alice'));}catch{vault=true;}api.reset();
      const cipher=JSON.parse(raw);cipher.ct=(cipher.ct[0]==='A'?'B':'A')+cipher.ct.slice(1);localStorage.setItem(key,JSON.stringify(cipher));try{await api.comms.recoverPendingCommsImport('alice',api.deps('alice'));}catch{tamper=true;}localStorage.setItem(key,raw);return{owner,vault,tamper};}),{owner:true,vault:true,tamper:true});assert.deepEqual(counts,before);
    phase='encrypted-file-tamper';assert.equal(await second.evaluate(async()=>{const api=window.commsTest,journal=JSON.parse((await api.vault.decryptMemoryEnvelope(JSON.parse(localStorage.getItem(api.comms.commsImportCheckpointKey('alice'))))).text),store=api.uploadDeps('alice').journal,id=journal.upload.id;
      const original=await store.get('alice',id),bytes=original.bytes.slice(0);new Uint8Array(bytes)[bytes.byteLength-1]^=1;await store.put('alice',id,{...original,bytes});let rejected=false;try{await api.comms.recoverPendingCommsImport('alice',api.deps('alice'));}catch{rejected=true;}await store.put('alice',id,original);return rejected;}),true);assert.equal(counts.apply,before.apply);
    phase='web-lock';await first.evaluate(()=>{window.held=false;navigator.locks.request(window.commsTest.comms.commsImportCheckpointKey('alice'),async()=>{window.held=true;await new Promise(resolve=>{window.release=resolve;});});});await first.waitForFunction(()=>window.held);const beforeLock={...counts};
    assert.equal(await second.evaluate(async()=>{const api=window.commsTest;try{await api.comms.recoverPendingCommsImport('alice',api.deps('alice'));return false;}catch{return true;}}),true);assert.deepEqual(counts,beforeLock);await first.evaluate(()=>window.release());
    phase='cancel';await second.evaluate(()=>{window.commsTest.enabled=false;});assert.equal(await second.evaluate(async()=>{const api=window.commsTest;return(await api.comms.cancelPendingCommsImport('alice',api.deps('alice'))).status;}),'cancelled');assert.equal(counts.apply,before.apply);
    assert.equal(externalRequests,0);process.stdout.write(JSON.stringify({v:1,browser:'Chromium',realVaultCrypto:true,realFileEncryption:true,realIndexedDB:true,realLocalStorage:true,realWebLocks:true,actualMemoryExecutor:true,syntheticDatabase:true,syntheticUploadRpc:true,syntheticLocalSemantic:true,lostMemoryAck:true,lostFileAck:true,crossTabRecovery:true,closedGateConfirmation:true,closedGateCancellation:true,parentDeletionNoResurrection:true,stableIdsAndCiphers:true,noReencryptionOrInferenceOnRecovery:true,onePostPerFile:true,wrongOwnerRejected:true,wrongVaultRejected:true,journalTamperRejected:true,fileTamperRejected:true,concurrentTabRejected:true,externalRequests,productionMutations:0,counts,filePosts})+'\n');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'comms_import_browser_failed',phase,errorType:error?.name,compileDiagnostics:phase==='bundle'?error.errors?.map(item=>({text:item.text,file:item.location?.file,line:item.location?.line})):undefined})+'\n');process.exitCode=1;});
