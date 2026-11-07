'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {verifyClosedCommsP2PRules}=require('./comms-p2p-legacy-rules'),{args}=require('./reconcile-comms-p2p-legacy');
const source=fs.readFileSync(path.resolve(__dirname,'../firestore.rules'),'utf8'),sha=crypto.createHash('sha256').update(source).digest('hex'),project='demo-mnemosyne-rules',prefix=`projects/${project}`,release={name:`${prefix}/releases/cloud.firestore`,rulesetName:`${prefix}/rulesets/synthetic-v1`,updateTime:'2026-10-12T00:00:00Z'};
function client(change=()=>{}){let calls=0;return{request:async request=>{assert.match(request.url,/^https:\/\/firebaserules\.googleapis\.com\/v1\//);assert.equal(request.retry,false);calls++;let data=request.url.endsWith('/cloud.firestore')?{...release}:{name:release.rulesetName,source:{files:[{name:'firestore.rules',content:source}]}};data=change(data,calls)??data;return{data};},get calls(){return calls;}};}
test('published rules verification binds exact source, project, release and stable before/after observation',async()=>{
  const c=client();assert.deepEqual(await verifyClosedCommsP2PRules(c,project,source,sha),{projectId:project,rulesSha256:sha,rulesetName:release.rulesetName,releaseUpdateTime:release.updateTime});assert.equal(c.calls,3);
});
test('source mismatch/open root/foreign ruleset/release change are refused without writes',async()=>{
  for(const change of[(data,call)=>call===1?{...data,rulesetName:'projects/foreign-project/rulesets/x'}:data,(data,call)=>call===2?{...data,source:{files:[{content:'rules were replaced'}]}}:data,(data,call)=>call===3?{...data,updateTime:'2026-10-12T00:00:01Z'}:data])await assert.rejects(verifyClosedCommsP2PRules(client(change),project,source,sha));
  const c=client();await assert.rejects(verifyClosedCommsP2PRules(c,project,source,'0'.repeat(64)));const open=source.replace('match /p2pRooms/{roomId} {','match /differentRooms/{roomId} {');await assert.rejects(verifyClosedCommsP2PRules(c,project,open,crypto.createHash('sha256').update(open).digest('hex')));assert.equal(c.calls,0);
});
test('CLI rejects invalid/duplicate/ambiguous contexts and defaults to read-only inventory',()=>{
  const out=path.resolve(__dirname,'synthetic-do-not-create.json');assert.equal(args([`--project=${project}`,`--out=${out}`]).mode,'inventory');
  for(const values of[[],[`--project=${project}`,'--out=relative'],[`--project=${project}`,`--out=${out}`,'--mode=cutover'],[`--project=${project}`,`--out=${out}`,`--out=${out}`],[`--project=${project}`,`--out=${out}`,'--apply']])assert.throws(()=>args(values));
  const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'mnemosyne-p2p-policy-test-')),preload=path.join(fixture,'closed-gate.cjs');
  try{
    fs.writeFileSync(preload,`require(${JSON.stringify(path.resolve(__dirname,'../functions/lib/commsP2PLegacy'))}).COMMS_P2P_LEGACY_RECONCILIATION_ENABLED=false;`);
    const run=spawnSync(process.execPath,['--require',preload,path.join(__dirname,'reconcile-comms-p2p-legacy.js'),`--project=${project}`,`--out=${out}`,'--mode=cutover','--cutover-id=11111111-1111-4111-8111-111111111111',`--expected-rules-sha256=${sha}`],{encoding:'utf8'});assert.equal(run.status,2);assert.match(run.stderr,/gate de lançamento/);assert.equal(fs.existsSync(out),false);
  }finally{
    assert.equal(path.dirname(path.resolve(fixture)),path.resolve(os.tmpdir()));assert.ok(path.basename(fixture).startsWith('mnemosyne-p2p-policy-test-'));
    fs.unlinkSync(preload);fs.rmdirSync(fixture);
  }
});
