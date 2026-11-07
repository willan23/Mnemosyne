'use strict';
/** Actual compositor/hook, AES, IndexedDB and Web Locks. Auth/team/AI boundaries are synthetic and localhost only. */
const path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const frontend=path.resolve(__dirname,'../frontend');let phase='runtime';
async function main(){
  assert.equal(process.versions.node.split('.')[0],'22');
  const {build}=require(path.join(frontend,'node_modules/esbuild')),{chromium}=require(path.join(frontend,'node_modules/@playwright/test'));
  const actual=JSON.stringify(path.join(frontend,'src/services/cognitiveDraft.ts')),vaultPath=JSON.stringify(path.join(frontend,'src/services/memoryCrypto.ts'));
  const draftFixture=`export * from ${actual};import * as actual from ${actual};import * as vault from ${vaultPath};
    import {cognitiveDraftStore} from ${JSON.stringify(path.join(frontend,'src/services/cognitiveDraftStore.ts'))};
    import {withClipCaptureLock} from ${JSON.stringify(path.join(frontend,'src/services/clipCaptureService.ts'))};
    function deps(){const fixture=window.__draftFixture;return{store:cognitiveDraftStore,uid:()=>fixture.uid,ready:vault.isMemoryCryptoReady,generation:()=>fixture.teamGeneration,
      subscribe:callback=>{fixture.listeners.add(callback);const stop=vault.onMemoryCryptoChanged(callback);return()=>{fixture.listeners.delete(callback);stop();};},
      team:async id=>{const response=await fetch('/team/'+id);if(!response.ok)throw Error('Synthetic team failure');return response.json();},encrypt:vault.encryptMemoryFields,decrypt:vault.decryptMemoryEnvelope,id:()=>crypto.randomUUID(),exclusive:withClipCaptureLock};}
    export const loadCognitiveDraft=(uid,guard)=>actual.loadCognitiveDraft(uid,guard,deps());
    export const saveCognitiveDraft=(uid,value,expected,guard)=>actual.saveCognitiveDraft(uid,value,expected,guard,deps());
    export const discardCognitiveDraft=(uid,guard)=>actual.discardCognitiveDraft(uid,guard,deps());
    window.__draftOperations={loadCognitiveDraft,saveCognitiveDraft,discardCognitiveDraft,store:cognitiveDraftStore};`;
  const fixtureModules={
    '/contexts/UIContext':'export const useUI=()=>({isCommandPaletteOpen:false});',
    '/hooks/useSubscription':'export const useSubscription=()=>({canCreateMemory:()=>true,getRemainingMemories:()=>20,isLoading:false});',
    '/hooks/useMyTeams':'export const useMyTeams=()=>window.__draftFixture.teams;',
    '/utils/translations':'export const useTranslation=()=>({t:key=>key});',
    '/services/aiGenerationService':'export const generateTextFromPrompt=async()=>{throw Error("Unexpected provider");};export const generateImageFromPrompt=generateTextFromPrompt;',
  };
  const words=['abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident'];
  const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {CognitiveInput} from './src/components/CognitiveInput';
    import * as vault from './src/services/memoryCrypto';import {clearCognitiveDraft} from './src/services/cognitiveDraftStore';import {dispatchOpenCapture} from './src/utils/desktopCapture';
    const words=${JSON.stringify(words)};vault.setMemoryCryptoMnemonic(words);let root=null;
    function Composer(){React.useEffect(()=>{dispatchOpenCapture();},[]);return React.createElement(CognitiveInput);}
    window.openActualCapture=dispatchOpenCapture;
    window.draftTest={vault,reset:()=>vault.setMemoryCryptoMnemonic(words),
      mount:()=>{root=createRoot(document.getElementById('editor'));root.render(React.createElement(Composer));},unmount:()=>{root.unmount();root=null;},
      setTeams:teams=>{window.__draftFixture.teams=teams;if(root)root.render(React.createElement(Composer));},
      setUser:uid=>{window.__draftFixture.uid=uid;for(const callback of window.__draftFixture.listeners)callback(uid?{uid}:null);},
      clear:uid=>clearCognitiveDraft(uid,()=>{}),operations:()=>window.__draftOperations};`;
  phase='bundle';const bundled=await build({stdin:{contents:source,resolveDir:frontend,loader:'tsx'},bundle:true,format:'iife',platform:'browser',write:false,logLevel:'silent',define:{'import.meta.env':'{}'},plugins:[{name:'synthetic-boundaries',setup(builder){
    builder.onResolve({filter:/firebase$/},args=>path.resolve(args.resolveDir,args.path)===path.join(frontend,'src/firebase')?{path:'app',namespace:'fixture'}:undefined);
    builder.onResolve({filter:/services\/cognitiveDraft$/},()=>({path:'draft',namespace:'fixture'}));
    builder.onResolve({filter:/RecoveryPanel$/},args=>({path:'recovery:'+args.path.split('/').pop(),namespace:'fixture'}));
    builder.onResolve({filter:/contexts\/UIContext$|hooks\/useSubscription$|hooks\/useMyTeams$|utils\/translations$|services\/aiGenerationService$/},args=>{
      const key=Object.keys(fixtureModules).find(key=>args.path.endsWith(key));return key?{path:key,namespace:'fixture'}:undefined;});
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'ts',resolveDir:frontend,contents:args.path==='draft'?draftFixture:args.path==='app'?
      `window.__draftFixture={uid:'alice',teamGeneration:0,teams:[],listeners:new Set()};export const db={};export const storage={};export const auth={get currentUser(){return window.__draftFixture.uid?{uid:window.__draftFixture.uid}:null;},onAuthStateChanged(callback){window.__draftFixture.listeners.add(callback);return()=>window.__draftFixture.listeners.delete(callback);}};export default {};`:
      args.path.startsWith('recovery:')?`export const ${args.path.slice(9)}=()=>null;`:fixtureModules[args.path]}));
  }}]});
  let browser,externalRequests=0;const teamKey='22222222-2222-4222-8222-222222222222';
  const team={id:'crew',ownerUid:'alice',memberUids:['alice','bob'],wrappedKeys:{alice:{v:1}},activeKeyEpoch:1,activeKeyId:teamKey,keyRotationStatus:'active'};
  const server=http.createServer((request,response)=>{
    if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end('<!doctype html><meta charset="utf-8"><title>Synthetic encrypted draft</title><div id="editor"></div><script src="/bundle.js"></script>');}
    else if(request.url==='/bundle.js'){response.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});response.end(bundled.outputFiles[0].text);}
    else if(request.url==='/team/crew'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(team));}
    else{response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const id='11111111-1111-4111-8111-111111111111',baseline={sessionId:id,stateHash:'a'.repeat(64),stateDigest:'b'.repeat(64),revision:9};
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0WQAAAAASUVORK5CYII=';
  try{
    phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){externalRequests++;return route.abort();}return route.continue();});
    const first=await context.newPage(),second=await context.newPage();for(const page of [first,second]){page.on('pageerror',error=>process.stderr.write(JSON.stringify({phase:'synthetic-page-error',type:error.name,syntaxDiagnostic:error.name==='SyntaxError'?error.message.slice(0,400):undefined})+'\n'));await page.goto(origin);await page.waitForFunction(()=>window.draftTest);}
    phase='seed';await first.evaluate(async({id,baseline,png})=>{const api=window.draftTest;await api.operations().saveCognitiveDraft('alice',{v:1,uid:'alice',scope:{kind:'personal'},text:'SYNTHETIC_PRIVATE_DRAFT_791 á漢🙂',
      generation:{id,uid:'alice',personalRevisionBaseline:baseline},image:{mediaType:'image/png',provider:'synthetic-local',dataUrl:'data:image/png;base64,'+png},imagePrompt:'SYNTHETIC_PRIVATE_IMAGE_PROMPT_791'},null,()=>{});sessionStorage.setItem('mnemosyne.flow.draft','LEGACY_UNOWNED_PRIVATE_791');api.mount();}, {id,baseline,png});
    await first.getByRole('textbox').waitFor();await first.waitForFunction(()=>document.querySelector('textarea')?.value.includes('SYNTHETIC_PRIVATE_DRAFT_791'));
    assert.equal(await first.getByAltText('Imagem gerada pela IA').count(),1);assert.equal(await first.getByText('LEGACY_UNOWNED_PRIVATE_791',{exact:true}).count(),0);
    phase='legacy-confirmation';await first.getByRole('button',{name:'Eliminar rascunho antigo',exact:true}).click();
    assert.equal(await first.evaluate(()=>sessionStorage.getItem('mnemosyne.flow.draft')),'LEGACY_UNOWNED_PRIVATE_791');
    first.once('dialog',dialog=>dialog.accept());await first.getByRole('button',{name:'Eliminar rascunho antigo',exact:true}).click();
    assert.equal(await first.evaluate(()=>sessionStorage.getItem('mnemosyne.flow.draft')),null);
    phase='edit-close-reload';await first.getByRole('textbox').fill('SYNTHETIC_PRIVATE_REVISED_DRAFT_791');await first.getByRole('button',{name:'Recolher captura'}).click();
    await first.waitForFunction(async()=>{const result=await window.draftTest.operations().loadCognitiveDraft('alice',()=>{});return result.draft.text==='SYNTHETIC_PRIVATE_REVISED_DRAFT_791';});
    const saved=await first.evaluate(()=>window.draftTest.operations().loadCognitiveDraft('alice',()=>{}));assert.deepEqual(saved.draft.generation.personalRevisionBaseline,baseline);assert.equal(saved.raw.includes('SYNTHETIC'),false);assert.equal(saved.raw.includes('data:image'),false);
    await first.reload();await first.waitForFunction(()=>window.draftTest);await first.evaluate(()=>{window.draftTest.mount();window.openActualCapture();});await first.waitForFunction(()=>document.querySelector('textarea')?.value==='SYNTHETIC_PRIVATE_REVISED_DRAFT_791');
    phase='lock';await first.evaluate(()=>window.draftTest.vault.setMemoryCryptoMnemonic(null));await first.waitForFunction(()=>document.querySelector('textarea')?.value==='');assert.equal(await first.getByAltText('Imagem gerada pela IA').count(),0);
    phase='wrong-vault';await first.evaluate(words=>window.draftTest.vault.setMemoryCryptoMnemonic(words.reverse()),words);await first.getByRole('status').filter({hasText:'Não foi possível abrir o rascunho'}).waitFor();assert.equal(await first.getByRole('textbox').inputValue(),'');
    await first.evaluate(()=>window.draftTest.reset());await first.waitForFunction(()=>document.querySelector('textarea')?.value==='SYNTHETIC_PRIVATE_REVISED_DRAFT_791');
    phase='account-isolation';await first.evaluate(()=>window.draftTest.setUser('bob'));await first.waitForFunction(()=>document.querySelector('textarea')?.value==='');assert.equal(await first.getByAltText('Imagem gerada pela IA').count(),0);await first.waitForFunction(()=>!document.querySelector('textarea')?.disabled);
    await first.evaluate(()=>window.draftTest.setUser('alice'));await first.waitForFunction(()=>document.querySelector('textarea')?.value==='SYNTHETIC_PRIVATE_REVISED_DRAFT_791');
    phase='cross-tab-cas';const own=await first.evaluate(()=>window.draftTest.operations().loadCognitiveDraft('alice',()=>{}));
    await second.evaluate(async raw=>{const api=window.draftTest,loaded=await api.operations().loadCognitiveDraft('alice',()=>{});await api.operations().saveCognitiveDraft('alice',{...loaded.draft,text:'Synthetic other tab body'},raw,()=>{});},own.raw);
    assert.equal(await first.evaluate(async saved=>{const api=window.draftTest;try{await api.operations().saveCognitiveDraft('alice',saved.draft,saved.raw,()=>{});return false;}catch{return true;}},own),true);
    phase='team-access';await second.evaluate(async({teamKey,id})=>{const api=window.draftTest,old=await api.operations().loadCognitiveDraft('alice',()=>{});await api.operations().saveCognitiveDraft('alice',{v:1,uid:'alice',scope:{kind:'team',teamId:'crew',keyEpoch:1,keyId:teamKey},text:'SYNTHETIC_PRIVATE_TEAM_DRAFT_791',generation:{id,uid:'alice',teamId:'crew'},image:null,imagePrompt:''},old.raw,()=>{});},{teamKey,id});
    team.activeKeyEpoch=2;assert.equal(await first.evaluate(async()=>{try{await window.draftTest.operations().loadCognitiveDraft('alice',()=>{});return false;}catch{return true;}}),true);team.activeKeyEpoch=1;team.memberUids=['bob'];
    assert.equal(await first.evaluate(async()=>{try{await window.draftTest.operations().loadCognitiveDraft('alice',()=>{});return false;}catch{return true;}}),true);team.memberUids=['alice','bob'];
    phase='team-ui';await first.evaluate(team=>{window.draftTest.unmount();window.draftTest.setTeams([team]);window.draftTest.mount();},team);
    await first.waitForFunction(()=>document.querySelector('textarea')?.value==='SYNTHETIC_PRIVATE_TEAM_DRAFT_791');team.memberUids=['bob'];
    await first.evaluate(()=>window.draftTest.setTeams([]));await first.waitForFunction(()=>document.querySelector('textarea')?.value==='');await first.getByRole('status').filter({hasText:'Não foi possível abrir o rascunho'}).waitFor();
    team.memberUids=['alice','bob'];
    phase='web-lock';await first.evaluate(()=>{window.held=false;navigator.locks.request('mnemosyne:cognitive-draft:v1:alice',async()=>{window.held=true;await new Promise(resolve=>window.release=resolve);});});await first.waitForFunction(()=>window.held);
    assert.equal(await second.evaluate(async()=>{try{await window.draftTest.operations().loadCognitiveDraft('alice',()=>{});return false;}catch{return true;}}),true);await first.evaluate(()=>window.release());
    phase='account-cleanup';await first.evaluate(async()=>{const api=window.draftTest,record=await api.operations().store.get('alice');await api.operations().store.compareExchange('bob',null,{...record,uid:'bob'},()=>{});await api.clear('alice');});
    assert.deepEqual(await second.evaluate(async()=>({alice:await window.draftTest.operations().store.get('alice')!==undefined,bob:await window.draftTest.operations().store.get('bob')!==undefined})),{alice:false,bob:true});
    assert.equal(externalRequests,0);process.stdout.write(JSON.stringify({v:1,browser:'Chromium',actualCompositor:true,actualDraftHook:true,realVaultCrypto:true,realIndexedDB:true,realWebLocks:true,encryptedTextAndImageAndBaseline:true,closeAndReloadPreservesRevisionDraft:true,legacyUnownedNotPublished:true,legacyRemovalRequiresConfirmation:true,wrongVaultPreserved:true,lockedPlaintextAndImageHidden:true,accountPlaintextAndImageIsolation:true,crossTabCasRefused:true,teamEpochRefused:true,revokedTeamRefused:true,concurrentTabRefused:true,uidExactAccountCleanup:true,syntheticAuthAndTeam:true,providerCalls:0,externalRequests,productionMutations:0})+'\n');
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:'cognitive_draft_browser_failed',phase,errorType:error?.name,compileDiagnostics:phase==='bundle'?error.errors?.map(item=>({text:item.text,file:item.location?.file,line:item.location?.line})):undefined})+'\n');process.exitCode=1;});
