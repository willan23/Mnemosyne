'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),yaml=require('../frontend/node_modules/js-yaml');
const workflow=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/desktop-release.yml'),'utf8')),steps=workflow.jobs['build-windows'].steps;
const stage=steps.find(row=>row.name==='Stage public download artifacts');
test('desktop release inputs are data and production uses the validated full deployment entrypoint',()=>{
  const inputs=workflow.on.workflow_dispatch.inputs;assert.equal(inputs.deploy_release.type,'boolean');assert.equal(inputs.deploy_release.default,false);assert(!inputs.deploy_hosting);
  assert.equal(inputs.version.default,JSON.parse(fs.readFileSync(path.join(root,'frontend/package.json'),'utf8')).version);
  assert.equal(workflow.permissions.contents,'read');
  assert.equal(stage.env.MNEMOSYNE_RELEASE_VERSION,'${{ inputs.version }}');assert.equal(stage.env.MNEMOSYNE_RELEASE_NOTES,'${{ inputs.notes }}');
  for(const row of steps)if(row.run){assert(!row.run.includes('${{'),'Workflow expressions must not be interpolated into executable code');assert(!/\bfirebase\s+deploy\b/.test(row.run));}
  const deploy=steps.find(row=>row.name==='Deploy the full validated release');assert(deploy);assert.equal(deploy.if,'inputs.deploy_release == true');
  assert(deploy.run.includes('.\\deploy.ps1 -Project $env:MNEMOSYNE_PROJECT_ID -ReportDirectory $report'));
  assert.equal(deploy.env.MNEMOSYNE_PROJECT_ID,'${{ secrets.FIREBASE_PROJECT_ID }}');
  for(const name of ['Install deployment dependencies','Java for deployment validation','Install the validated Firebase CLI','Authenticate to Google Cloud'])assert.equal(steps.find(row=>row.name===name).if,deploy.if);
  const build=steps.findIndex(row=>row.name==='Build Tauri (Windows)');assert.equal(steps[build].run,'npx tauri build --ci --no-bundle -- --locked');
  for(const name of ['Check the locked native dependency graph','Updater signature version binding','Updater cached bytes reject tampering','Audit the locked native dependency graph']){
    const index=steps.findIndex(row=>row.name===name);assert(index>=0&&index<build);assert(!steps[index].if);assert(!steps[index]['continue-on-error']);
  }
  const updater=JSON.parse(fs.readFileSync(path.join(root,'frontend/src-tauri/tauri.conf.json'),'utf8')).plugins.updater;
  assert.equal(updater.requireSignedVersion,true);assert.equal(updater.allowDowngrades,false);
});
test('the epoch 2 signing secret is scoped to bundling after compilation',()=>{
  const build=steps.findIndex(row=>row.name==='Build Tauri (Windows)'),bundle=steps.findIndex(row=>row.name==='Bundle and sign Tauri (Windows)');
  assert.equal(bundle,build+1);assert(!steps[build].env);assert(!workflow.jobs['build-windows'].env.TAURI_SIGNING_PRIVATE_KEY);
  assert.equal(steps[bundle].env.TAURI_SIGNING_PRIVATE_KEY,'${{ secrets.MNEMOSYNE_DESKTOP_UPDATER_EPOCH2 }}');
  assert.deepEqual(Object.keys(steps[bundle].env),['TAURI_SIGNING_PRIVATE_KEY']);
  for(const row of steps)if(row!==steps[bundle])assert(!JSON.stringify(row).includes('secrets.MNEMOSYNE_DESKTOP_UPDATER_EPOCH2'));
  assert(!JSON.stringify(workflow).includes('secrets.TAURI_SIGNING_PRIVATE_KEY'));
  assert(steps[bundle].run.includes("$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''"));
  assert(steps[bundle].run.includes('$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $null'));
  assert(steps[bundle].run.includes('npx tauri bundle --ci'));
});
function fixture(work){
  const parent=path.resolve(os.tmpdir()),folder=fs.mkdtempSync(path.join(parent,'mnemosyne-release-test-'));
  try{fs.mkdirSync(path.join(folder,'scripts'));return work(folder);}
  finally{assert.equal(path.dirname(path.resolve(folder)),parent);assert(path.basename(folder).startsWith('mnemosyne-release-test-'));fs.rmSync(folder,{recursive:true,force:true});}
}
function powershell(folder,body,environment={}){
  const file=path.join(folder,'probe.ps1');fs.writeFileSync(file,body);
  const result=spawnSync('pwsh.exe',['-NoProfile','-File',file],{cwd:folder,env:{...process.env,...environment},encoding:'utf8',timeout:15000});
  assert(!result.error,result.error?.code);return result;
}
const windows={skip:process.platform!=='win32'?'PowerShell entrypoint execution is required in the Windows CI job':false};
test('the actual bundle step refuses an absent key and exposes it only to the fixed bundler command',windows,()=>fixture(folder=>{
  const bundle=steps.find(row=>row.name==='Bundle and sign Tauri (Windows)');
  const probe=path.join(folder,'bundle-probe.cjs'),output=path.join(folder,'bundle-probe.json');
  fs.writeFileSync(probe,"const fs=require('fs');fs.writeFileSync(process.env.BUNDLE_PROBE_OUT,JSON.stringify({args:process.argv.slice(2),keyCorrect:process.env.TAURI_SIGNING_PRIVATE_KEY==='synthetic-ci-key',pathCleared:!process.env.TAURI_SIGNING_PRIVATE_KEY_PATH,passwordEmpty:!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD}));process.exit(Number(process.env.BUNDLE_PROBE_EXIT||'0'));\n");
  fs.writeFileSync(path.join(folder,'npx.cmd'),'@"'+process.execPath+'" "'+probe+'" %*\r\n');
  const environment={PATH:folder+path.delimiter+process.env.PATH,BUNDLE_PROBE_OUT:output,TAURI_SIGNING_PRIVATE_KEY:'',TAURI_SIGNING_PRIVATE_KEY_PATH:'synthetic-stale-path',TAURI_SIGNING_PRIVATE_KEY_PASSWORD:'synthetic-stale-password'};
  const absent=powershell(folder,"$ErrorActionPreference='Stop'\n"+bundle.run,environment);assert.notEqual(absent.status,0);assert(!fs.existsSync(output));
  const result=powershell(folder,"$ErrorActionPreference='Stop'\n"+bundle.run+"\nexit $LASTEXITCODE\n",{...environment,TAURI_SIGNING_PRIVATE_KEY:'synthetic-ci-key',BUNDLE_PROBE_EXIT:'42'});
  assert.equal(result.status,42,result.stderr);assert.deepEqual(JSON.parse(fs.readFileSync(output)),{args:['tauri','bundle','--ci'],keyCorrect:true,pathCleared:true,passwordEmpty:true});
  assert(!result.stdout.includes('synthetic-ci-key'));assert(!result.stderr.includes('synthetic-ci-key'));
}));
test('the Functions npm deploy entrypoint forwards explicit context to the complete release procedure',windows,()=>fixture(folder=>{
  const command=JSON.parse(fs.readFileSync(path.join(root,'functions/package.json'),'utf8')).scripts.deploy;
  assert.equal(command,'powershell -NoProfile -NonInteractive -File ../deploy.ps1');
  const functions=path.join(folder,'functions');fs.mkdirSync(functions);
  fs.writeFileSync(path.join(folder,'deploy.ps1'),"param([Parameter(Mandatory=$true)][string]$Project,[switch]$PreflightOnly)\n[pscustomobject]@{project=$Project;preflightOnly=[bool]$PreflightOnly;root=$PSScriptRoot}|ConvertTo-Json -Compress\n");
  const args=command.split(' ');const executable=args.shift();
  const result=spawnSync(executable,[...args,'-Project','demo-mnemosyne-rules','-PreflightOnly'],{cwd:functions,encoding:'utf8',timeout:15000});
  assert(!result.error,result.error?.code);assert.equal(result.status,0);
  const output=JSON.parse(result.stdout.trim());assert.equal(output.project,'demo-mnemosyne-rules');assert.equal(output.preflightOnly,true);assert.equal(path.resolve(output.root),folder);
  const missing=spawnSync(executable,args,{cwd:functions,encoding:'utf8',timeout:15000});
  assert(!missing.error,missing.error?.code);assert.notEqual(missing.status,0);assert(!missing.stdout.includes('preflightOnly'));
}));

test('both manual publication entrypoints require the same five-job CI and full root release',()=>{
  const deploy=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/deploy.yml'),'utf8'));
  assert.equal(deploy.on.workflow_dispatch.inputs.version.default,JSON.parse(fs.readFileSync(path.join(root,'frontend/package.json'),'utf8')).version);
  assert.equal(deploy.permissions.contents,'read');assert.deepEqual(Object.keys(deploy.jobs),['release']);
  assert.equal(deploy.jobs.release.uses,'./.github/workflows/desktop-release.yml');assert.equal(deploy.jobs.release.secrets,'inherit');
  assert.equal(deploy.jobs.release.with.deploy_release,true);assert.equal(deploy.jobs.release.with.version,'${{ inputs.version }}');assert.equal(deploy.jobs.release.with.notes,'${{ inputs.notes }}');
  assert.equal(deploy.on.workflow_dispatch.inputs.android_release_asset_id.required,true);
  assert.equal(deploy.jobs.release.with.android_release_asset_id,'${{ inputs.android_release_asset_id }}');
  assert(!deploy.jobs.release.steps);assert(!deploy.jobs.release.if);
  assert.equal(workflow.on.workflow_call.inputs.version.type,'string');assert.equal(workflow.on.workflow_call.inputs.version.required,true);
  assert.equal(workflow.on.workflow_call.inputs.deploy_release.type,'boolean');assert.equal(workflow.on.workflow_call.inputs.deploy_release.default,false);
  assert.equal(workflow.jobs.validate.uses,'./.github/workflows/ci.yml');assert.equal(workflow.jobs.validate.secrets,'inherit');assert(!workflow.jobs.validate.if);
  assert.equal(workflow.jobs['build-windows'].needs,'validate');assert(!workflow.jobs['build-windows'].if);
  const ci=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'));assert(Object.hasOwn(ci.on,'workflow_call'));
  assert.equal(Object.keys(ci.jobs).length,5);for(const job of Object.values(ci.jobs))assert(!job.if);
  for(const name of ['VITE_FIREBASE_API_KEY','VITE_FIREBASE_PROJECT_ID','VITE_FIREBASE_APP_ID','VITE_STRIPE_PUBLISHABLE_KEY'])assert.equal(workflow.jobs['build-windows'].env[name],'${{ secrets.'+name+' }}');
  assert.equal(steps.find(row=>row.name==='Upload Windows installers').with.name,'mnemosyne-windows-${{ inputs.version }}');
});

test('full release retrieves the pinned Android asset before building or authenticating to Firebase',()=>{
  const fetch=steps.find(row=>row.name==='Retrieve approved Android APK');
  assert(fetch);
  assert.equal(fetch.if,'inputs.deploy_release == true');
  assert.equal(fetch.env.MNEMOSYNE_ANDROID_RELEASE_ASSET_ID,'${{ inputs.android_release_asset_id }}');
  assert.equal(fetch.env.GH_TOKEN,'${{ secrets.GITHUB_TOKEN }}');
  assert.equal(fetch.run.trim(),'node scripts/android-release-artifact.cjs --fetch $env:MNEMOSYNE_ANDROID_RELEASE_ASSET_ID');
  assert(!fetch['continue-on-error']);
  assert(steps.indexOf(fetch)<steps.findIndex(row=>row.name==='Build Tauri (Windows)'));
  assert(steps.indexOf(fetch)<steps.findIndex(row=>row.name==='Authenticate to Google Cloud'));
  for(const row of steps)if(row!==fetch)assert(!row.env?.GH_TOKEN);
  assert.equal(workflow.on.workflow_call.inputs.android_release_asset_id.type,'string');
  assert.equal(workflow.on.workflow_dispatch.inputs.android_release_asset_id.type,'string');
  const ci=yaml.load(fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'));
  const windows=Object.values(ci.jobs).find(job=>job['runs-on']==='windows-latest');
  const checks=windows.steps.find(row=>row.name==='Android build commands, version and failure boundaries');
  assert(checks.run.includes('scripts/android-release-artifact.test.cjs'));
  assert(!checks.if&&!checks['continue-on-error']);
});
for(const [name,notes,version]of [
  ['quote statement','"; Write-Output "SYNTHETIC_INPUT_EXECUTED"; #','1.0.8'],
  ['subexpression','$(Write-Output "SYNTHETIC_INPUT_EXECUTED")','1.0.8'],
  ['Unicode and newline','Correção sintética: memória 🧠\nSegunda linha com ` e "aspas".','1.0.8'],
  ['version statement','Synthetic notes','1.0.8"; Write-Output "SYNTHETIC_INPUT_EXECUTED"; #'],
])test('actual workflow preserves literal '+name+' input',windows,()=>fixture(folder=>{
  fs.writeFileSync(path.join(folder,'scripts/publish-desktop.ps1'),"param([string]$Version,[string]$Notes)\nif($Version -cne $env:EXPECTED_RELEASE_VERSION -or $Notes -cne $env:EXPECTED_RELEASE_NOTES){throw 'Argument changed'}\n[pscustomobject]@{literalArguments=$true;notesLength=$Notes.Length} | ConvertTo-Json -Compress\n");
  const result=powershell(folder,stage.run,{MNEMOSYNE_RELEASE_VERSION:version,MNEMOSYNE_RELEASE_NOTES:notes,EXPECTED_RELEASE_VERSION:version,EXPECTED_RELEASE_NOTES:notes});
  assert.equal(result.status,0);const lines=result.stdout.trim().split(/\r?\n/);assert.equal(lines.length,1);assert.equal(JSON.parse(lines[0]).literalArguments,true);
}));
test('the legacy hosting switch stops before local staging or a publisher command',windows,()=>fixture(folder=>{
  const copy=path.join(folder,'scripts/publish-desktop.ps1');fs.copyFileSync(path.join(root,'scripts/publish-desktop.ps1'),copy);
  const body="$ErrorActionPreference='Stop'\nfunction New-Item {throw 'Unexpected staging'}\nfunction Copy-Item {throw 'Unexpected staging'}\nfunction firebase {throw 'Unexpected publication'}\ntry { & $env:SCRIPT_UNDER_TEST -Version '1.0.8' -DeployHosting;throw 'Unexpected success' } catch {if($_.Exception.Message -notlike 'Use deploy.ps1 -Project*'){throw};[pscustomobject]@{blockedBeforeStaging=$true}|ConvertTo-Json -Compress}\n";
  const result=powershell(folder,body,{SCRIPT_UNDER_TEST:copy});assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout.trim()).blockedBeforeStaging,true);
}));
test('invalid versions are rejected before the staging body',windows,()=>fixture(folder=>{
  const copy=path.join(folder,'scripts/publish-desktop.ps1');fs.copyFileSync(path.join(root,'scripts/publish-desktop.ps1'),copy);
  const body="$ErrorActionPreference='Stop'\nfunction New-Item {throw 'Unexpected staging'}\nfunction Copy-Item {throw 'Unexpected staging'}\ntry { & $env:SCRIPT_UNDER_TEST -Version '../invalid';throw 'Unexpected success' } catch {if($_.Exception.Message -like '*Unexpected*'){throw};[pscustomobject]@{invalidVersionBlocked=$true}|ConvertTo-Json -Compress}\n";
  const result=powershell(folder,body,{SCRIPT_UNDER_TEST:copy});assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout.trim()).invalidVersionBlocked,true);
}));
