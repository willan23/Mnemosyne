'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),script=path.join(root,'scripts/recover-desktop-updater-key.ps1');
const windows={skip:process.platform!=='win32'?'PowerShell recovery requires Windows':false};
function sandbox(t){const parent=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(parent,'mnemosyne-updater-recovery-'));t.after(()=>{assert.equal(path.dirname(fs.realpathSync(dir)),parent);assert(!fs.lstatSync(dir).isSymbolicLink());fs.rmSync(dir,{recursive:true,force:true});});return dir;}
function ps(file,env={}){return cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',file],{env:{...process.env,...env},windowsHide:true,encoding:'utf8',timeout:30000});}
function packetProbe(t,body){const dir=sandbox(t),file=path.join(dir,'packet.ps1');fs.writeFileSync(file,String.raw`$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseFile($env:RECOVERY_SCRIPT,[ref]$null,[ref]$null)
foreach($name in @('Get-UpdaterRecoveryCrc32c','Read-UpdaterRecoveryPacket')) {
  $fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name},$true)
  if(-not $fn){throw 'Missing recovery parser'}
  . ([scriptblock]::Create($fn.Extent.Text))
}
`+body);return ps(file,{RECOVERY_SCRIPT:script});}
test('recovery verifies the standard CRC32C vector and accepts only the exact version, key and schema',windows,t=>{
  const result=packetProbe(t,String.raw`if((Get-UpdaterRecoveryCrc32c ([Text.Encoding]::UTF8.GetBytes('123456789'))) -cne '3808858755'){throw 'CRC32C vector mismatch'}
$packet=@{v=1;keyEpoch=2;publicKey='synthetic-public';privateKey='U1lOVEhFVElDX1BSSVZBVEU='}|ConvertTo-Json -Compress
$bytes=[Text.Encoding]::UTF8.GetBytes($packet)
$response=[pscustomobject]@{name='projects/123456/secrets/MNEMOSYNE_DESKTOP_UPDATER_EPOCH2/versions/1';payload=[pscustomobject]@{data=[Convert]::ToBase64String($bytes);dataCrc32c=(Get-UpdaterRecoveryCrc32c $bytes)}}
$parsed=Read-UpdaterRecoveryPacket $response $response.name 'synthetic-public'
if($parsed.privateKey -cne 'U1lOVEhFVElDX1BSSVZBVEU='){throw 'Private packet changed'}
[pscustomobject]@{accepted=$true;crcVector=$true}|ConvertTo-Json -Compress
`);assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{accepted:true,crcVector:true});assert(!result.stdout.includes('U1lOVEhFVElDX1BSSVZBVEU='));
});
test('recovery rejects corrupt payloads, checksum, schema, public key, epoch and version without echoing payloads',windows,t=>{
  const result=packetProbe(t,String.raw`$count=0
foreach($kind in @('version','checksum','base64','utf8','schema','key','epoch','private','oversized')) {
  $packet=@{v=1;keyEpoch=2;publicKey='synthetic-public';privateKey='U1lOVEhFVElDX1BSSVZBVEU='}
  if($kind -eq 'schema'){$packet.unexpected='forbidden'}
  if($kind -eq 'key'){$packet.publicKey='wrong-public'}
  if($kind -eq 'epoch'){$packet.keyEpoch=1}
  if($kind -eq 'private'){$packet.privateKey='../private-file'}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($packet|ConvertTo-Json -Compress))
  if($kind -eq 'utf8'){$bytes=[byte[]]@(255,255)}
  $response=[pscustomobject]@{name='projects/123456/secrets/MNEMOSYNE_DESKTOP_UPDATER_EPOCH2/versions/1';payload=[pscustomobject]@{data=[Convert]::ToBase64String($bytes);dataCrc32c=(Get-UpdaterRecoveryCrc32c $bytes)}}
  if($kind -eq 'checksum'){$response.payload.dataCrc32c='0'}
  if($kind -eq 'version'){$response.name='projects/123456/secrets/MNEMOSYNE_DESKTOP_UPDATER_EPOCH2/versions/2'}
  if($kind -eq 'base64'){$response.payload.data='not base64'}
  if($kind -eq 'oversized'){$response.payload.data='A'*32769}
  try{$null=Read-UpdaterRecoveryPacket $response 'projects/123456/secrets/MNEMOSYNE_DESKTOP_UPDATER_EPOCH2/versions/1' 'synthetic-public';throw 'Unexpected parser success'}
  catch {if($_.Exception.Message -cne 'Updater recovery packet refused: check version, checksum, schema and public key.'){throw};$count++}
}
[pscustomobject]@{refusals=$count}|ConvertTo-Json -Compress
`);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).refusals,9);assert(!result.stdout.includes('U1lOVEhFVElDX1BSSVZBVEU='));assert(!result.stderr.includes('U1lOVEhFVElDX1BSSVZBVEU='));
});
test('recovery refuses implicit versions, invalid projects, existing, linked and checkout directories before authentication',windows,t=>{
  const dir=sandbox(t),target=path.join(dir,'existing'),link=path.join(dir,'linked');fs.mkdirSync(target);fs.symlinkSync(target,link,'junction');
  for(const [project,version,directory]of [['mnemosyne-one','latest',path.join(dir,'new')],['../other','1',path.join(dir,'new')],['mnemosyne-one','1',target],['mnemosyne-one','1',link],['mnemosyne-one','1','relative'],['mnemosyne-one','1',path.join(root,'unsafe-recovery')]]){
    const result=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Project',project,'-SecretVersion',version,'-KeyDirectory',directory],{env:{...process.env,PATH:'C:\\Windows\\System32;C:\\Windows\\System32\\WindowsPowerShell\\v1.0'},windowsHide:true,encoding:'utf8',timeout:30000});
    assert.notEqual(result.status,0);assert(!result.stderr.includes('Get-Command'));assert(!result.stderr.includes('gcloud'));assert(!fs.existsSync(path.join(dir,'new')));
  }
  assert.deepEqual(fs.readdirSync(target),[]);
});
test('the recovery signer receives private material only through the child environment and suppresses both output streams',windows,t=>{
  const dir=sandbox(t),probe=path.join(dir,'child.cjs'),out=path.join(dir,'probe.json'),file=path.join(dir,'process.ps1');
  fs.writeFileSync(probe,"const fs=require('fs');fs.writeFileSync(process.env.RECOVERY_PROBE,JSON.stringify({correct:process.env.TAURI_SIGNING_PRIVATE_KEY==='synthetic-private',pathRemoved:!process.env.TAURI_SIGNING_PRIVATE_KEY_PATH,passwordEmpty:!process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,args:process.argv.slice(2)}));console.log('synthetic-private');console.error('synthetic-private');");
  fs.writeFileSync(file,String.raw`$ErrorActionPreference='Stop'
$ast=[Management.Automation.Language.Parser]::ParseFile($env:RECOVERY_SCRIPT,[ref]$null,[ref]$null)
$fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-UpdaterRecoveryProcess'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$env:TAURI_SIGNING_PRIVATE_KEY='previous-private';$env:TAURI_SIGNING_PRIVATE_KEY_PATH='previous-path';$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD='previous-password'
$null=Invoke-UpdaterRecoveryProcess $env:RECOVERY_NODE @($env:RECOVERY_CHILD,'public-argument') 'synthetic-private'
if($env:TAURI_SIGNING_PRIVATE_KEY -cne 'previous-private' -or $env:TAURI_SIGNING_PRIVATE_KEY_PATH -cne 'previous-path' -or $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -cne 'previous-password'){throw 'Caller environment changed'}
Write-Output 'ok'
`);const result=ps(file,{RECOVERY_SCRIPT:script,RECOVERY_NODE:process.execPath,RECOVERY_CHILD:probe,RECOVERY_PROBE:out});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'ok');assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(fs.readFileSync(out)),{correct:true,pathRemoved:true,passwordEmpty:true,args:['public-argument']});
});
