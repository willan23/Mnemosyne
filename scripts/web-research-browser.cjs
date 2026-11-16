'use strict';
/** Actual research/save services and browser vault/storage/locks; localhost providers/Auth/RPC fixtures. */
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');
const frontend=path.resolve(__dirname,'../frontend');const {parseAttachedMemoryInput,canonicalAttachedMemoryJson}=require('../functions/lib/attachedMemoryContract');let phase='runtime';
async function main(){
  if(process.versions.node!=='22.23.3')throw Error('node22_required');const {build}=require(path.join(frontend,'node_modules/esbuild'));const {chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const source=`import * as research from './src/services/webResearchService';import * as saved from './src/services/webResearchMemory';import * as recovery from './src/services/attachedMemoryRecovery';
    import * as vault from './src/services/memoryCrypto';import {withAiGenerationContext} from './src/services/aiGenerationContext';import {getLocalAiConfig} from './src/services/localAiConfig';
    const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];vault.setMemoryCryptoMnemonic(words);window.researchActor='alice';
    const policy=value=>{localStorage.setItem('mnemosyne_local_ai_config',JSON.stringify({memoryPermission:value}));window.dispatchEvent(new Event('mnemosyne:local-ai-config'));};policy('allow-cloud');
    const subscribe=changed=>{const stop=vault.onMemoryCryptoChanged(changed);window.addEventListener('research-actor',changed);window.addEventListener('mnemosyne:local-ai-config',changed);
      return()=>{stop();window.removeEventListener('research-actor',changed);window.removeEventListener('mnemosyne:local-ai-config',changed);};};
    const scope=()=>({uid:()=>window.researchActor,ready:vault.isMemoryCryptoReady,policy:()=>getLocalAiConfig().memoryPermission,generation:()=>0,team:async()=>null,subscribe});
    const creation=()=>({storage:localStorage,uid:()=>window.researchActor,ready:vault.isMemoryCryptoReady,policy:()=>getLocalAiConfig().memoryPermission,generation:()=>0,id:()=>crypto.randomUUID(),subscribe,
      exclusive:async(name,work)=>navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>{if(!lock)throw Error('busy');return work();}),
      prepare:async proposal=>({teamId:null,keyEpoch:null,keyId:null,enc:(await vault.buildEncryptedMemoryFields(proposal.text,proposal.title)).enc}),encrypt:vault.encryptMemoryFields,decrypt:vault.decryptMemoryEnvelope,forgetUploads:async()=>{throw Error('unexpected uploads');},
      ...Object.fromEntries(['create','status','cancel'].map(mode=>[mode,async request=>{const reply=await fetch('/rpc/'+mode,{method:'POST',body:JSON.stringify(request)});if(!reply.ok)throw Error('fixture refusal');return reply.json();}]))});
    window.researchTest={research,saved,recovery,vault,policy,creation,scope,reset:()=>vault.setMemoryCryptoMnemonic(words),
      run:request=>withAiGenerationContext({uid:'alice'},context=>research.runWebResearch(request,{context}),scope()),
      save:result=>saved.saveWebResearchMemory({uid:'alice',result,sessions:[{id:'own',uid:'alice',teamId:null,text:'Synthetic own'},{id:'team',uid:'alice',teamId:'crew',text:'Synthetic team'}]},
        {context:scope(),enabled:recovery.assertPersonalMemoryCreationEnabled,pending:recovery.hasPendingAttachedMemoryCreation,semantic:async(_text,candidates)=>{if(candidates.length!==1||candidates[0].id!=='own')throw Error('invalid candidates');return{embedding:[1],embeddingModel:'synthetic-local'};},
          create:(proposal,_deps,guard)=>recovery.createPersonalMemory(proposal,creation(),guard),now:()=>1900000000000})};`;
  phase='bundle';const bundled=await build({stdin:{contents:source,resolveDir:frontend,loader:'ts'},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'import.meta.env':JSON.stringify({PROD:false,VITE_ENABLE_WEB_RESEARCH_BACKEND:'true',VITE_WEB_RESEARCH_ENDPOINT:'/research'})},plugins:[{name:'synthetic-app',setup(builder){
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'app',namespace:'fixture'}:undefined);
    builder.onResolve({filter:/config\/releaseGates$/},()=>({path:'gates',namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='gates'?fs.readFileSync(path.join(frontend,'src/config/releaseGates.ts'),'utf8').replace('PERSONAL_MEMORY_CREATION_ENABLED = false','PERSONAL_MEMORY_CREATION_ENABLED = true'):
      'export const db={};export const storage={};export const auth={get currentUser(){const uid=window.researchActor;return uid?{uid,getIdToken:async()=>{window.researchTokenHook?.();return "synthetic.jwt";}}:null;}};export default {};'}));
  }}]});
  const receipts=new Map();const researchRequests=[];const counts={research:0,create:0,status:0,cancel:0};let loseAck=true;let badLink=false;let deferResearch=false;let releaseResearch;let seenResearch;let externalRequests=0;let browser;
  const server=http.createServer(async(request,response)=>{
    if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Synthetic research test</title><script src="/bundle.js"></script>');return;}
    if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundled.outputFiles[0].text);return;}
    try{let raw='';for await(const bytes of request){raw+=bytes;if(Buffer.byteLength(raw)>500000)throw Error();}
      if(request.url==='/research'){
        assert.equal(request.headers.authorization,'Bearer synthetic.jwt');const input=JSON.parse(raw);counts.research++;researchRequests.push(input);
        if(deferResearch){seenResearch?.();await new Promise(resolve=>{releaseResearch=resolve;});}
        const value={query:input.query,mode:input.mode,summary:'SYNTHETIC_RESEARCH_BODY_811 á漢🙂',main_ideas:['Synthetic idea'],key_concepts:['synthetic'],suggested_memories:[],local_comparisons:[],
          sources:[{title:'Synthetic source',url:badLink?'javascript:alert(1)':'https://example.org/source',summary:'Synthetic source summary',snippet:'Synthetic snippet',status:'read'}]};
        response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(value));return;
      }
      const match=/^\/rpc\/(create|status|cancel)$/.exec(request.url||'');if(!match){response.writeHead(404);response.end();return;}
      assert.equal(raw.includes('SYNTHETIC_RESEARCH_BODY_811'),false);const input=parseAttachedMemoryInput(JSON.parse(raw));assert.deepEqual(input.attachmentIds,[]);assert.equal(input.teamId,null);
      assert.deepEqual(input.metadata.webResearch,{mode:'private-local',savedAt:1900000000000});const digest=createHash('sha256').update(canonicalAttachedMemoryJson(input)).digest('hex');const mode=match[1];counts[mode]++;
      let record=receipts.get(input.sessionId);if(record)assert.equal(record.digest,digest);
      if(!record&&mode!=='status'){record={input,sessionId:input.sessionId,digest,status:mode==='create'?'committed':'cancelled',createdAt:1900000000000};receipts.set(input.sessionId,record);}
      const value=record?{sessionId:record.sessionId,digest:record.digest,status:record.status,createdAt:record.createdAt}:{sessionId:input.sessionId,digest,status:'unknown',createdAt:null};
      response.writeHead(200,{'Content-Type':'application/json'});if(mode==='create'&&loseAck){loseAck=false;response.end('{');return;}response.end(JSON.stringify(value));
    }catch{response.writeHead(400);response.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;const key='mnemosyne:attached-memory-creation:v1:alice';
  try{
    phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){externalRequests++;return route.abort();}return route.continue();});
    const first=await context.newPage();await first.goto(origin);await first.waitForFunction(()=>window.researchTest);
    phase='private-local';const research=await first.evaluate(async()=>{const api=window.researchTest;return api.run({query:'Synthetic query',mode:'private-local',context:['Synthetic memory that must remain local']});});assert.deepEqual(researchRequests[0].context,[]);
    phase='lost-save-ack';assert.equal(await first.evaluate(async result=>{const api=window.researchTest;api.policy('never-cloud');try{await api.save(result);return false;}catch{return true;}},research),true);
    assert.equal(receipts.size,1);const committed=[...receipts.values()][0];assert.equal(counts.create,1);const raw=await first.evaluate(key=>localStorage.getItem(key),key);assert.ok(raw);assert.equal(raw.includes(research.summary),false);
    phase='another-tab';const second=await context.newPage();await second.goto(origin);await second.waitForFunction(()=>window.researchTest);
    assert.equal(await second.evaluate(async()=>{const api=window.researchTest;api.policy('never-cloud');return(await api.recovery.recoverAttachedMemoryCreation('alice',api.creation())).status;}),'committed');
    assert.equal(counts.create,1);assert.equal(await second.evaluate(key=>localStorage.getItem(key),key),null);
    const memory=await second.evaluate(async enc=>window.researchTest.vault.decryptMemoryEnvelope(enc),committed.input.enc);assert.ok(memory.text.includes(research.summary));assert.ok(memory.text.includes('https://example.org/source'));
    phase='auth-away-back';const before=counts.research;assert.equal(await first.evaluate(async()=>{const api=window.researchTest;api.policy('allow-cloud');window.researchTokenHook=()=>{window.researchActor='bob';window.dispatchEvent(new Event('research-actor'));window.researchActor='alice';window.dispatchEvent(new Event('research-actor'));};
      try{await api.run({query:'Synthetic late query',mode:'contextual',context:['Synthetic selected memory']});return false;}catch{return true;}finally{window.researchTokenHook=null;}}),true);assert.equal(counts.research,before);
    phase='invalid-source';badLink=true;assert.equal(await first.evaluate(async()=>{try{await window.researchTest.run({query:'Synthetic query',mode:'public'});return false;}catch{return true;}}),true);badLink=false;
    phase='late-response';deferResearch=true;const seen=new Promise(resolve=>{seenResearch=resolve;});await first.evaluate(()=>{window.researchLate='pending';window.researchTest.run({query:'Synthetic late response',mode:'public'}).then(()=>{window.researchLate='returned';},()=>{window.researchLate='rejected';});});
    await Promise.race([seen,new Promise((_resolve,reject)=>setTimeout(()=>reject(Error('missing request')),5000))]);
    await first.evaluate(()=>{window.researchTest.vault.setMemoryCryptoMnemonic(null);window.researchTest.reset();});releaseResearch();await first.waitForFunction(()=>window.researchLate!=='pending');assert.equal(await first.evaluate(()=>window.researchLate),'rejected');
    assert.equal(externalRequests,0);process.stdout.write(JSON.stringify({v:1,browser:'Chromium',realResearchService:true,realSaveService:true,realVaultCrypto:true,realLocalStorage:true,realWebLocks:true,
      privateLocalContextStripped:true,neverCloudEncryptedSave:true,lostSaveAck:true,stableRequestAndCipher:true,crossTabReceiptRecovery:true,sourceMetadataPreserved:true,authAwayBackStopsBeforeRpc:true,unsafeSourceRejected:true,
      vaultAwayBackRejectsLateResearch:true,syntheticAuth:true,syntheticProvider:true,syntheticRpc:true,externalRequests,productionMutations:0,counts})+'\n');
  }finally{releaseResearch?.();if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'web_research_browser_failed',phase,errorType:error?.name,compileDiagnostics:phase==='bundle'?error.errors?.map(item=>({text:item.text,file:item.location?.file,line:item.location?.line})):undefined})+'\n');process.exitCode=1;});
