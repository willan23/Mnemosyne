'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const windows={skip:process.platform!=='win32'?'DPAPI custody requires the Windows CI job':false},actualRoot=path.resolve(__dirname,'..');
function fixture(t){
  const parent=fs.realpathSync(os.tmpdir()),sandbox=fs.mkdtempSync(path.join(parent,'mnemosyne-updater-key-')),root=path.join(sandbox,'project');fs.mkdirSync(root);
  t.after(()=>{const actual=fs.realpathSync(sandbox);assert.equal(path.dirname(actual),parent);assert(path.basename(actual).startsWith('mnemosyne-updater-key-'));assert(!fs.lstatSync(sandbox).isSymbolicLink());fs.rmSync(actual,{recursive:true,force:true});});
  const write=(relative,data)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);return file;};
  const script=write('scripts/desktop-updater-key.ps1',fs.readFileSync(path.join(actualRoot,'scripts/desktop-updater-key.ps1')));
  write('scripts/preflight-node.js',fs.readFileSync(path.join(actualRoot,'scripts/preflight-node.js')));
  write('scripts/check-tauri-version-alignment.cjs','process.exit(process.env.FAIL_ALIGNMENT ? 1 : 0);');
  write('frontend/src-tauri/tauri.conf.json',JSON.stringify({plugins:{updater:{pubkey:'synthetic-public'}}}));
  write('frontend/node_modules/@tauri-apps/cli/tauri.js',String.raw`const fs=require('node:fs'),a=process.argv.slice(2);if(a[0]==='signer'&&a[1]==='generate'){const file=a[a.indexOf('--write-keys')+1];fs.writeFileSync(file,'SYNTHETIC_PRIVATE_MATERIAL',{flag:'wx'});fs.writeFileSync(file+'.pub','synthetic-public',{flag:'wx'});console.log('SYNTHETIC_PRIVATE_MATERIAL');console.error('SYNTHETIC_PRIVATE_MATERIAL');}else{const rows=fs.existsSync(process.env.PROBE_OUT)?JSON.parse(fs.readFileSync(process.env.PROBE_OUT)):[];rows.push({args:a,privatePresent:!!process.env.TAURI_SIGNING_PRIVATE_KEY,privateWasCorrect:process.env.TAURI_SIGNING_PRIVATE_KEY==='SYNTHETIC_PRIVATE_MATERIAL',passwordEmpty:!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,pathRemoved:!process.env.TAURI_SIGNING_PRIVATE_KEY_PATH});fs.writeFileSync(process.env.PROBE_OUT,JSON.stringify(rows));process.exit(Number(process.env.PROBE_EXIT||'0'));}`);
  const key=path.join(sandbox,'private-key'),out=path.join(sandbox,'probe.json');
  const run=(action,env={})=>cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Action',action,'-KeyDirectory',key],{cwd:root,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,PROBE_OUT:out,...env},windowsHide:true,encoding:'utf8',timeout:30000});
  return{root,write,script,key,out,run};
}
function generate(f){const result=f.run('Generate');assert.equal(result.status,0,result.stderr);assert(!result.stdout.includes('SYNTHETIC_PRIVATE_MATERIAL'));assert(!result.stderr.includes('SYNTHETIC_PRIVATE_MATERIAL'));return JSON.parse(result.stdout);}

test('generates only inside a new restricted directory, verifies DPAPI roundtrip and removes the plaintext key',windows,t=>{
  const f=fixture(t),result=generate(f);assert.equal(result.protection,'Windows-DPAPI-CurrentUser');assert.equal(result.plaintextPrivateFileRetained,false);
  assert(!fs.existsSync(path.join(f.key,'updater.key.pending')));assert(fs.existsSync(path.join(f.key,'updater.pub')));
  const cipher=fs.readFileSync(path.join(f.key,'updater.key.dpapi'));assert(!cipher.includes(Buffer.from('SYNTHETIC_PRIVATE_MATERIAL')));
  const before=crypto.createHash('sha256').update(cipher).digest('hex');assert.notEqual(f.run('Generate').status,0);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(f.key,'updater.key.dpapi'))).digest('hex'),before);
});
test('decrypts only for the fixed build/bundle command and sends no private value in arguments',windows,t=>{
  const f=fixture(t);generate(f);
  for(const action of ['Build','Bundle']){if(fs.existsSync(f.out))fs.unlinkSync(f.out);const result=f.run(action,{TAURI_SIGNING_PRIVATE_KEY:'synthetic-previous-key',TAURI_SIGNING_PRIVATE_KEY_PATH:'synthetic-previous-path'});assert.equal(result.status,0,result.stderr);const rows=JSON.parse(fs.readFileSync(f.out,'utf8'));assert.equal(rows.length,action==='Build'?2:1);if(action==='Build'){assert(!rows[0].privatePresent);assert.deepEqual(rows[0].args,['build','--ci','--no-bundle','--','--locked']);}const probe=rows.at(-1);assert(probe.privateWasCorrect&&probe.passwordEmpty&&probe.pathRemoved);assert.deepEqual(probe.args,['bundle','--ci']);assert(!JSON.stringify(probe.args).includes('SYNTHETIC_PRIVATE_MATERIAL'));}
});
test('refuses a public key mismatch, invalid DPAPI data and an unaligned runtime before invoking signing',windows,t=>{
  const f=fixture(t);generate(f);f.write('frontend/src-tauri/tauri.conf.json',JSON.stringify({plugins:{updater:{pubkey:'other-public'}}}));assert.notEqual(f.run('Bundle').status,0);assert(!fs.existsSync(f.out));
  f.write('frontend/src-tauri/tauri.conf.json',JSON.stringify({plugins:{updater:{pubkey:'synthetic-public'}}}));assert.notEqual(f.run('Bundle',{FAIL_ALIGNMENT:'1'}).status,0);assert(!fs.existsSync(f.out));
  fs.writeFileSync(path.join(f.key,'updater.key.dpapi'),Buffer.from('damaged-cipher'));assert.notEqual(f.run('Bundle').status,0);assert(!fs.existsSync(f.out));
});
test('propagates the native exit code and restores the caller environment and working directory',windows,t=>{
  const f=fixture(t);generate(f);
  const outer=f.write('outer.ps1',String.raw`$before=(Get-Location).Path
$env:TAURI_SIGNING_PRIVATE_KEY='previous-fixture'
$env:TAURI_SIGNING_PRIVATE_KEY_PATH='previous-path-fixture'
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD='previous-password-fixture'
& $env:KEY_SCRIPT -Action Bundle -KeyDirectory $env:KEY_DIRECTORY
$code=$LASTEXITCODE
[pscustomobject]@{code=$code;keyRestored=($env:TAURI_SIGNING_PRIVATE_KEY -eq 'previous-fixture');pathRestored=($env:TAURI_SIGNING_PRIVATE_KEY_PATH -eq 'previous-path-fixture');passwordRestored=($env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -eq 'previous-password-fixture');cwdRestored=((Get-Location).Path -eq $before)}|ConvertTo-Json -Compress`);
  const result=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',outer],{cwd:f.root,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,KEY_SCRIPT:f.script,KEY_DIRECTORY:f.key,PROBE_OUT:f.out,PROBE_EXIT:'42'},windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{code:42,keyRestored:true,pathRestored:true,passwordRestored:true,cwdRestored:true});
});
test('refuses junctions and relative key directories',windows,t=>{
  const f=fixture(t),destination=path.join(path.dirname(f.root),'target'),link=path.join(path.dirname(f.root),'linked');fs.mkdirSync(destination);fs.symlinkSync(destination,link,'junction');
  for(const key of [link,'relative-key',path.join(f.root,'unsafe-key')]){const result=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',f.script,'-Action','Generate','-KeyDirectory',key],{cwd:f.root,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH},windowsHide:true,encoding:'utf8',timeout:30000});assert.notEqual(result.status,0);}
  assert.deepEqual(fs.readdirSync(destination),[]);
});
