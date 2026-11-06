'use strict';

// Synthetic loopback pilot. Production crypto, recovery, Web Locks and UI;
// Auth, callable transport, documents and receipts are fixtures, never production.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const frontend = path.resolve(__dirname, '../frontend');
const { canonicalSyncState } = require('../functions/lib/mobileSyncImportContract');
const { parseAgentReversalCommand, agentReversalRequestBytes } = require('../functions/lib/agentReversalContract');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const proposalId = crypto.randomUUID(), oldId = crypto.randomUUID(), activeId = crypto.randomUUID();
let phase = 'bundle', fixture, browser, server, origin, externalRequests = 0;
const cases = [];
function reset() { fixture = { current: null, sourceEnc: null, team: false, receipt: null, calls: [], commits: 0, stamp: 1, failStatus: false, loseAck: false, hold: null, held: false }; }
function preparation() {
  const f = fixture, team = f.team;
  return { baseline: { proposalId, sessionId: 'synthetic-note', teamId: team ? 'synthetic-team' : null, authorUid: 'alice', ownerUid: 'alice',
    originalDigest: 'a'.repeat(64), originalRevision: 1002, revision: 1002, reversalEpoch: 0,
    stateHash: hash(canonicalSyncState([f.current, f.stamp])), stateDigest: hash(canonicalSyncState(f.current)),
    versionId: 'memory-edit-' + proposalId, versionHash: hash(canonicalSyncState(f.sourceEnc)),
    teamStateHash: team ? 'e'.repeat(64) : null, epochStateHash: team ? 'f'.repeat(64) : null,
    keyEpoch: team ? 2 : null, keyId: team ? activeId : null, currentKeyEpoch: team ? 1 : null, currentKeyId: team ? oldId : null,
    sourceKeyEpoch: team ? 1 : null, sourceKeyId: team ? oldId : null }, currentEnc: f.current.enc, sourceEnc: f.sourceEnc,
    currentMetadata: { tags: ['changed'], color: '#112233' }, sourceMetadata: { tags: ['original'], category: null },
    currentLearning: null, sourceLearning: null, currentLearningPresent: false, sourceLearningPresent: false, deleted: f.current.deletedAt != null };
}
async function rpc(mode, raw) {
  const command = parseAgentReversalCommand(mode, raw);
  assert.equal(command.expectedUid, 'alice');
  const text = JSON.stringify(command);
  assert.equal(text.includes('SYNTHETIC_ARCHIVE'), false); assert.equal(text.includes('SYNTHETIC_APPLIED'), false);
  fixture.calls.push({ mode, request: structuredClone(command.request) });
  if (mode === 'prepare') return preparation();
  const request = command.request, digest = hash(agentReversalRequestBytes(request));
  const unknown = { operationId: request.operationId, proposalId, sessionId: 'synthetic-note', teamId: request.baseline.teamId, digest, status: 'unknown', revision: null, createdAt: null };
  if (mode === 'status') { if (fixture.failStatus) throw Error('Synthetic status unavailable'); return fixture.receipt ?? unknown; }
  if (fixture.receipt) { assert.equal(fixture.receipt.digest, digest); return fixture.receipt; }
  if (mode === 'cancel') return fixture.receipt = { ...unknown, status: 'cancelled', createdAt: 2000 };
  assert.equal(command.confirmed, true); assert.equal(command.reviewDigest, digest);
  assert.equal(canonicalSyncState(request.baseline), canonicalSyncState(preparation().baseline));
  if (fixture.hold) { fixture.held = true; await fixture.hold; }
  fixture.commits++;
  fixture.receipt = { ...unknown, status: 'committed', revision: 2000, createdAt: 2000 };
  fixture.current = { ...fixture.current, enc: request.enc, tags: ['original'], category: null, updatedAt: 2000,
    ...(fixture.team ? { keyEpoch: 2, keyId: activeId } : {}) };
  delete fixture.current.color; delete fixture.current.deletedAt; fixture.stamp++;
  if (fixture.loseAck) throw Error('Synthetic acknowledgement lost');
  return fixture.receipt;
}
async function main() {
  if (process.versions.node.split('.')[0] !== '22') throw Error('Node 22 required');
  const { build } = require(path.join(frontend, 'node_modules/esbuild'));
  const { chromium } = require(path.join(frontend, 'node_modules/@playwright/test'));
  const words = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];
  const source = `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AgentReversalPanel} from './src/components/AgentReversalPanel';
    import * as reversal from './src/services/agentReversalRecovery';
    import * as vault from './src/services/memoryCrypto'; import * as teamVault from './src/services/teamVault';
    import {withClipCaptureLock} from './src/services/clipCaptureService';
    import {useUniverseStore} from './src/store/universeStore';
    import {auth,setActor,subscribeActor} from './src/firebase';
    import {setPilotWrites} from './src/config/releaseGates';
    const words=${JSON.stringify(words)},proposalId=${JSON.stringify(proposalId)},oldId=${JSON.stringify(oldId)},activeId=${JSON.stringify(activeId)};
    vault.setMemoryCryptoMnemonic(words);useUniverseStore.setState({language:'en'});
    let root=null,selection=null,team=false,oldKey,activeKey,generation=0,enabled=true,preview=null;
    const listeners=new Set();
    const send=async(path,body)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error('Synthetic transport unavailable');return response.json();};
    const deps={crypto:{enabled:()=>enabled,storage:localStorage,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock,
      read:()=>send('/read',{}),key:async(base,prior,guard)=>{guard();return team?((prior?base.priorKeyEpoch:base.keyEpoch)===1?oldKey:activeKey):null;},
      encryptJournal:vault.encryptMemoryFields,decryptJournal:vault.decryptMemoryEnvelope,encryptPersonal:vault.buildEncryptedMemoryFields,decryptPersonal:vault.decryptMemoryEnvelope,
      encryptTeam:teamVault.encryptTeamMemoryFields,decryptTeam:teamVault.decryptTeamMemoryEnvelope,generation:()=>generation,
      call:async()=>{throw Error('Ordinary editor unavailable');},observe:(_uid,changed)=>{listeners.add(changed);return()=>listeners.delete(changed);},
      mutation:{uid:()=>auth.currentUser?.uid??null,ready:vault.isMemoryCryptoReady,subscribe:changed=>{const a=subscribeActor(changed),b=vault.onMemoryCryptoChanged(changed);return()=>{a();b();};}}},
      recipherPersonal:vault.recipherMemoryEnvelope,recipherTeam:teamVault.recipherTeamMemoryEnvelope,call:(mode,command)=>send('/rpc/'+mode,command)};
    window.pilotDeps=deps;window.pilotStorageChanges=0;
    window.addEventListener('storage',event=>{if(event.key===reversal.agentReversalCheckpointKey('alice'))window.pilotStorageChanges++;});
    const render=()=>root?.render(React.createElement(AgentReversalPanel,{key:auth.currentUser?.uid+':'+selection,uid:auth.currentUser?.uid??'alice',proposalId:selection,onChanged:()=>{},onClose:()=>root.render(null)}));
    window.pilot={
      mount:id=>{selection=id;if(!root)root=createRoot(document.getElementById('root'));render();},
      seed:async(useTeam=false)=>{team=useTeam;enabled=true;setPilotWrites(true);preview=null;
        oldKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);activeKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
        const applied={text:'SYNTHETIC_APPLIED',title:'Applied title'},archive={text:'<script>window.syntheticExecuted=true</script> SYNTHETIC_ARCHIVE',title:'Archived title'};
        const context={teamId:'synthetic-team',keyEpoch:1,keyId:oldId};
        const sourceEnc=team?await teamVault.encryptTeamMemoryFields(oldKey,archive,context):(await vault.buildEncryptedMemoryFields(archive.text,archive.title)).enc;
        const fields=team?{text:'',title:null,enc:await teamVault.encryptTeamMemoryFields(oldKey,applied,context)}:await vault.buildEncryptedMemoryFields(applied.text,applied.title);
        await send('/seed',{team,sourceEnc,current:{uid:'alice',teamId:team?'synthetic-team':null,timestamp:1,updatedAt:1002,...fields,tags:['changed'],color:'#112233',lastVersionId:'memory-edit-'+proposalId,...(team?{keyEpoch:1,keyId:oldId}:{})}});},
      preview:async()=>preview=await reversal.previewAgentReversal('alice',proposalId,()=>{},deps),
      confirm:async()=>{try{return{ok:true,result:await reversal.confirmAgentReversal('alice',preview,()=>{},deps)};}catch{return{ok:false};}},
      recover:async()=>{try{const value=await reversal.recoverAgentReversal('alice',()=>{},deps);if(value.state==='review')preview=value.preview;return{ok:true,value};}catch{return{ok:false};}},
      cancel:async()=>{try{return{ok:true,result:await reversal.cancelAgentReversal('alice',()=>{},deps)};}catch{return{ok:false};}},
      raw:()=>localStorage.getItem(reversal.agentReversalCheckpointKey('alice')),
      enabled:value=>{enabled=value;setPilotWrites(value);},vaultABA:()=>{vault.setMemoryCryptoMnemonic(null);vault.setMemoryCryptoMnemonic(words);},
      decrypt:async()=>{const current=await send('/read',{});return team?teamVault.decryptTeamMemoryEnvelope(activeKey,current.enc,{teamId:'synthetic-team',keyEpoch:2,keyId:activeId},{strictPayload:true}):vault.decryptMemoryEnvelope(current.enc);},
      oldKeyRefused:async()=>{try{const current=await send('/read',{});await teamVault.decryptTeamMemoryEnvelope(oldKey,current.enc,{teamId:'synthetic-team',keyEpoch:1,keyId:oldId},{strictPayload:true});return false;}catch{return true;}},
      lock:async()=>{window.pilotLockHeld=false;window.pilotLockPromise=withClipCaptureLock(reversal.agentReversalCheckpointKey('alice'),async()=>{window.pilotLockHeld=true;await new Promise(resolve=>window.pilotReleaseLock=resolve);});},
      injectStorageABA:async()=>{const key=reversal.agentReversalCheckpointKey('alice'),raw=localStorage.getItem(key);localStorage.setItem(key,'synthetic foreign change');localStorage.setItem(key,raw);},
      info:()=>({webLocks:!!navigator.locks,crypto:!!crypto.subtle,listeners:listeners.size,executed:window.syntheticExecuted===true}),proposalId
    };`;
  const appFixture = `const listeners=new Set();export const auth={currentUser:{uid:'alice'}};export const db={},storage={};export default{};export const setActor=uid=>{auth.currentUser=uid?{uid}:null;listeners.forEach(callback=>callback());};export const subscribeActor=callback=>{listeners.add(callback);return()=>listeners.delete(callback);};`;
  const adapter = `import * as actual from '${path.join(frontend, 'src/services/agentReversalRecovery.ts').split(path.sep).join('/')}';export * from '${path.join(frontend, 'src/services/agentReversalRecovery.ts').split(path.sep).join('/')}';
    export const previewAgentReversal=(...args)=>actual.previewAgentReversal(...args,window.pilotDeps);
    export const confirmAgentReversal=(...args)=>actual.confirmAgentReversal(...args,window.pilotDeps);
    export const recoverAgentReversal=(...args)=>actual.recoverAgentReversal(...args,window.pilotDeps);
    export const cancelAgentReversal=(...args)=>actual.cancelAgentReversal(...args,window.pilotDeps);`;
  const gateSource = fs.readFileSync(path.join(frontend, 'src/config/releaseGates.ts'), 'utf8')
    .replace('export const TEAM_WRITES_ENABLED = false', 'export let TEAM_WRITES_ENABLED = true')
    .replace('export const PERSONAL_REVISION_WRITES_ENABLED = false', 'export let PERSONAL_REVISION_WRITES_ENABLED = true') +
    ';export function setPilotWrites(value){TEAM_WRITES_ENABLED=value;PERSONAL_REVISION_WRITES_ENABLED=value;}';
  const bundled = await build({stdin:{contents:source,resolveDir:frontend,loader:'tsx'},jsx:'automatic',bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'import.meta.env':'{}'},plugins:[{name:'synthetic-boundaries',setup(builder){
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'app',namespace:'fixture'}:undefined);
    builder.onResolve({filter:/^firebase\/auth$/},()=>({path:'auth',namespace:'fixture'}));
    builder.onResolve({filter:/releaseGates$/},()=>({path:'gates',namespace:'fixture'}));
    builder.onResolve({filter:/agentReversalRecovery$/},args=>args.importer.endsWith('AgentReversalPanel.tsx')?{path:'adapter',namespace:'fixture'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'ts',resolveDir:frontend,contents:args.path==='app'?appFixture:args.path==='auth'?`import{auth,subscribeActor}from'./src/firebase';export const onAuthStateChanged=(_auth,callback)=>{queueMicrotask(()=>callback(auth.currentUser));return subscribeActor(()=>callback(auth.currentUser));};`:args.path==='gates'?gateSource:adapter}));
  }}]});
  reset();
  server = http.createServer(async (request,response)=>{
    const json=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
    if(request.method==='GET'&&request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Synthetic agent reversal</title><div id="root"></div><script src="/bundle.js"></script>');return;}
    if(request.method==='GET'&&request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript'});response.end(bundled.outputFiles[0].text);return;}
    if(request.method!=='POST'){json(404,{});return;}
    try{let bytes=0;const chunks=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>2*1024*1024)throw Error('Synthetic request too large');chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString());
      if(request.url==='/seed'){reset();fixture.team=body.team;fixture.current=body.current;fixture.sourceEnc=body.sourceEnc;json(200,{});}
      else if(request.url==='/read')json(200,fixture.current);
      else if(/^\/rpc\/(prepare|apply|status|cancel)$/.test(request.url))json(200,await rpc(request.url.slice(5),body));
      else json(404,{});
    }catch{json(503,{error:'synthetic_failure'});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();externalRequests++;return route.abort();});
  const open=async()=>{const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>window.pilot);return page;};
  const a=await open(),b=await open();
  const mount=(page,id=proposalId)=>page.evaluate(value=>window.pilot.mount(value),id);
  const pending=page=>page.evaluate(()=>window.pilot.raw());
  const button=page=>page.getByRole('button',{name:'Confirm reversal of this change',exact:true});
  phase='manual-ui-real-cipher';await a.evaluate(()=>window.pilot.seed());await mount(a);await button(a).waitFor();
  assert.equal(fixture.commits,0);assert.equal(await pending(a),null);assert.equal(await a.getByText('<script>window.syntheticExecuted=true</script> SYNTHETIC_ARCHIVE',{exact:true}).count(),1);
  assert.equal((await a.evaluate(()=>window.pilot.info())).executed,false);await button(a).click();await a.getByText('Previous version restored and result confirmed.',{exact:true}).waitFor();
  assert.equal(fixture.commits,1);assert.equal(await pending(a),null);assert.equal((await a.evaluate(()=>window.pilot.decrypt())).text.includes('SYNTHETIC_ARCHIVE'),true);cases.push(phase);

  phase='reload-unknown-no-auto-apply';await a.reload();await a.waitForFunction(()=>window.pilot);await a.evaluate(()=>window.pilot.seed());
  const preview=await a.evaluate(()=>window.pilot.preview());fixture.failStatus=true;
  assert.equal((await a.evaluate(()=>window.pilot.confirm())).ok,false);const checkpoint=await pending(a);assert.ok(checkpoint);assert.equal(checkpoint.includes('SYNTHETIC_'),false);assert.equal(checkpoint.includes('baseline'),false);fixture.failStatus=false;
  await a.reload();await a.waitForFunction(()=>window.pilot);await mount(a,null);await a.getByRole('button',{name:'Recover reversal',exact:true}).click();await button(a).waitFor();
  assert.equal(fixture.commits,0);assert.equal(await pending(a),checkpoint);
  const status=fixture.calls.filter(row=>row.mode==='status').at(-1).request;assert.equal(agentReversalRequestBytes(status),agentReversalRequestBytes(preview.request));
  await button(a).click();await a.getByText('Previous version restored and result confirmed.',{exact:true}).waitFor();assert.equal(fixture.commits,1);assert.equal(await pending(a),null);cases.push(phase);

  phase='lost-ack-closed-writes-status-only';await a.reload();await a.waitForFunction(()=>window.pilot);await a.evaluate(()=>window.pilot.seed());await a.evaluate(()=>window.pilot.preview());fixture.loseAck=true;
  assert.equal((await a.evaluate(()=>window.pilot.confirm())).ok,false);assert.equal(fixture.commits,1);assert.ok(await pending(a));
  await a.reload();await a.waitForFunction(()=>window.pilot);await a.evaluate(()=>window.pilot.enabled(false));await mount(a,null);const beforeCalls=fixture.calls.length;
  await a.getByRole('button',{name:'Recover reversal',exact:true}).click();await a.getByText('Previous version restored and result confirmed.',{exact:true}).waitFor();
  assert.deepEqual(fixture.calls.slice(beforeCalls).map(row=>row.mode),['status','status']);assert.equal(fixture.commits,1);assert.equal(await pending(a),null);cases.push(phase);

  phase='two-tabs-real-web-lock';await a.reload();await a.waitForFunction(()=>window.pilot);await a.evaluate(()=>window.pilot.seed());await a.evaluate(()=>window.pilot.preview());fixture.failStatus=true;
  await a.evaluate(()=>window.pilot.confirm());fixture.failStatus=false;const protectedRaw=await pending(a);
  await a.evaluate(()=>window.pilot.lock());await a.waitForFunction(()=>window.pilotLockHeld);const calls=fixture.calls.length;
  assert.equal((await b.evaluate(()=>window.pilot.recover())).ok,false);assert.equal(fixture.calls.length,calls);assert.equal(await pending(a),protectedRaw);
  await a.evaluate(async()=>{window.pilotReleaseLock();await window.pilotLockPromise;});assert.equal((await b.evaluate(()=>window.pilot.cancel())).ok,true);assert.equal(await pending(a),null);assert.equal(fixture.commits,0);cases.push(phase);

  phase='foreign-storage-aba-latched';await a.reload();await a.waitForFunction(()=>window.pilot);await a.evaluate(()=>window.pilot.seed());await a.evaluate(()=>window.pilot.preview());fixture.failStatus=true;
  await a.evaluate(()=>window.pilot.confirm());fixture.failStatus=false;const abaRaw=await pending(a);
  let release;fixture.hold=new Promise(resolve=>release=resolve);
  const confirming=a.evaluate(()=>window.pilot.confirm());await a.waitForFunction(()=>window.pilot.raw()!==null);
  // Wait for the synthetic RPC to be admitted, with a finite deadline and no arbitrary sleeps.
  await new Promise((resolve,reject)=>{const until=Date.now()+5000;const tick=()=>{if(fixture.held)return resolve();if(Date.now()>until)return reject(Error('Synthetic hold unavailable'));setTimeout(tick,10);};tick();});
  const storageChanges=await a.evaluate(()=>window.pilotStorageChanges);
  await b.evaluate(()=>window.pilot.injectStorageABA());await a.waitForFunction(count=>window.pilotStorageChanges>=count+2,storageChanges);
  release();assert.equal((await confirming).ok,false);assert.equal(await pending(a),abaRaw);assert.equal(fixture.commits,1);
  fixture.hold=null;assert.equal((await a.evaluate(()=>window.pilot.recover())).ok,true);assert.equal(await pending(a),null);assert.equal(fixture.commits,1);cases.push(phase);

  phase='team-old-epoch-to-active-real-aes';await a.reload();await a.waitForFunction(()=>window.pilot);await a.evaluate(()=>window.pilot.seed(true));await a.evaluate(()=>window.pilot.preview());
  assert.equal((await a.evaluate(()=>window.pilot.confirm())).ok,true);assert.equal(fixture.current.keyEpoch,2);assert.equal(fixture.current.keyId,activeId);
  assert.equal((await a.evaluate(()=>window.pilot.decrypt())).text.includes('SYNTHETIC_ARCHIVE'),true);assert.equal(await a.evaluate(()=>window.pilot.oldKeyRefused()),true);assert.equal(await pending(a),null);cases.push(phase);

  phase='vault-transition-retires-review';await a.reload();await a.waitForFunction(()=>window.pilot);await a.evaluate(()=>window.pilot.seed());await mount(a);await button(a).waitFor();await a.evaluate(()=>window.pilot.vaultABA());
  await button(a).waitFor({state:'detached'});assert.equal(await a.getByText('<script>window.syntheticExecuted=true</script> SYNTHETIC_ARCHIVE',{exact:true}).count(),0);assert.equal(fixture.commits,0);cases.push(phase);
  assert.equal(externalRequests,0);assert.equal((await a.evaluate(()=>window.pilot.info())).webLocks,true);
  process.stdout.write(JSON.stringify({v:1,complete:true,cases,externalRequests,productionMutations:0,applicationDeploys:0,realUserData:false,realBrowser:true,realWebLocks:true,realWebCrypto:true,authAndServer:'synthetic-loopback-fixtures',nativeDevicesVerified:false})+String.fromCharCode(10));
}
main().catch(()=>{process.stderr.write(JSON.stringify({v:1,complete:false,phase,cases,error:'synthetic_agent_reversal_pilot_failed'})+String.fromCharCode(10));process.exitCode=1;}).finally(async()=>{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}});
