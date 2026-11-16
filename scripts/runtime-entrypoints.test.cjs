'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),test=require('node:test'),cp=require('node:child_process');
const {inspect,args,RETIRED_PATHS}=require('./runtime-entrypoints.cjs'),root=path.resolve(__dirname,'..');
const canonical=()=>Object.fromEntries(['package.json','functions/package.json'].map(name=>[name,JSON.parse(fs.readFileSync(path.join(root,name),'utf8'))]));
function fixture(work){const parent=path.resolve(os.tmpdir()),folder=fs.mkdtempSync(path.join(parent,'mnemosyne-runtime-entrypoints-'));
  fs.mkdirSync(path.join(folder,'functions'));for(const[name,body]of Object.entries(canonical()))fs.writeFileSync(path.join(folder,name),JSON.stringify(body));
  try{return work(folder);}finally{const target=path.resolve(folder);assert.equal(path.dirname(target),parent);assert(path.basename(target).startsWith('mnemosyne-runtime-entrypoints-'));fs.rmSync(target,{recursive:true,force:true});}}
function patch(folder,name,change){const file=path.join(folder,name),body=JSON.parse(fs.readFileSync(file,'utf8'));change(body);fs.writeFileSync(file,JSON.stringify(body));}

test('current public entrypoints contain no retired runtime or implicit Firebase command',()=>{
  const report=inspect(root);assert.equal(report.passed,true);assert.equal(report.sources.length,2);assert.equal(report.retiredPaths.length,8);assert.equal(report.productionMutations,0);
});
test('renamed dangerous aliases still fail and reports never echo command contents',()=>{
  for(const command of ['cd backend && python main.py','python backend/main.py','node frontend/migrate-memories.js','firebase functions:shell','firebase emulators:start --only functions','npx --yes firebase-tools emulators:start','firebase functions:log','firebase deploy --project mnemosyne-one']){
    fixture(folder=>{patch(folder,'functions/package.json',body=>{body.scripts['renamed-command']=command+' SYNTHETIC-PRIVATE-MARKER';});const report=inspect(folder);assert.equal(report.passed,false);assert(report.findings.some(row=>row.script==='renamed-command'));assert(!JSON.stringify(report).includes('SYNTHETIC-PRIVATE-MARKER'));});
  }
});
test('obsolete aliases refuse even if their implementation is replaced with another command',()=>{
  for(const[file,name]of [['package.json','backend'],['package.json','backend:install'],['functions/package.json','serve'],['functions/package.json','shell'],['functions/package.json','start'],['functions/package.json','logs']])fixture(folder=>{
    patch(folder,file,body=>{body.scripts[name]='node --version';});assert.equal(inspect(folder).passed,false);
  });
});
test('restored retired runtimes fail without being executed or reading their contents',()=>{
  for(const retired of RETIRED_PATHS)fixture(folder=>{const file=path.join(folder,retired);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'throw new Error("SYNTHETIC-MUST-NOT-EXECUTE")');const report=inspect(folder);assert.equal(report.passed,false);assert(report.findings.some(row=>row.file===retired));assert(!JSON.stringify(report).includes('SYNTHETIC-MUST'));});
});
test('public deploy aliases must remain bound to the validated PowerShell entrypoint',()=>{
  for(const[file,name]of [['package.json','deploy'],['package.json','deploy:all'],['functions/package.json','deploy']])fixture(folder=>{patch(folder,file,body=>{body.scripts[name]='firebase deploy';});assert(inspect(folder).findings.some(row=>row.reason==='unreviewed_publication_entrypoint'));});
});
test('CLI rejects alternate roots and existing output, keeping prior evidence intact',()=>fixture(folder=>{
  for(const value of [['--root',folder],['--out','relative.json'],['--out',folder,'--out',folder]])assert.throws(()=>args(value));assert.deepEqual(args([]),{});
  const file=path.join(folder,'report.json'),run=()=>cp.spawnSync(process.execPath,[path.join(root,'scripts/runtime-entrypoints.cjs'),'--out',file],{encoding:'utf8',timeout:10000,windowsHide:true});
  const first=run();assert.equal(first.status,0);const bytes=fs.readFileSync(file);assert.equal(JSON.parse(bytes).passed,true);assert.equal(run().status,1);assert.deepEqual(fs.readFileSync(file),bytes);
}));
test('removed npm aliases fail before opening a Python runtime, Functions shell or log reader',()=>{
  for(const[relative,name]of [['','backend'],['','backend:install'],['functions','serve'],['functions','shell'],['functions','start'],['functions','logs']]){
    // These arguments are fixed test literals; no user input is interpolated into the Windows npm.cmd shell.
    assert(/^[a-z:-]+$/.test(name));const result=cp.spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run',name],{cwd:path.join(root,relative),encoding:'utf8',env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH},shell:process.platform==='win32',timeout:15000,windowsHide:true});
    assert(!result.error,result.error?.code);assert.notEqual(result.status,0);assert.match(result.stderr,/Missing script/i);
  }
});
test('every npm publication wrapper rejects a missing explicit project without prompting',{
  skip:process.platform==='win32'?false:'PowerShell argument binding is verified in the Windows job',
},()=>{
  const packages=canonical();
  for(const[file,name]of [['package.json','deploy'],['package.json','deploy:all'],['functions/package.json','deploy']]){
    const command=packages[file].scripts[name].split(' '),executable=command.shift();assert(command.includes('-NonInteractive'));
    const result=cp.spawnSync(executable,command,{cwd:path.join(root,file==='package.json'?'':'functions'),encoding:'utf8',timeout:15000,windowsHide:true});
    assert(!result.error,result.error?.code);assert.notEqual(result.status,0);assert(!result.stdout.includes('Mnemosyne:'));assert.match(result.stderr,/Project/);
  }
});
