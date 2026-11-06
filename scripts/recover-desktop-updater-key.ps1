<# Restore a new, restricted local DPAPI custody from an explicit Secret Manager
version. The packet is read over HTTPS into memory; no plaintext key is written.
The recovered key must sign a fresh challenge verified by the configured public
key before the encrypted local copy is committed. No cloud writes or IAM edits.
#>
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$Project,
  [Parameter(Mandatory=$true)][ValidatePattern('^[1-9][0-9]{0,17}$')][string]$SecretVersion,
  [Parameter(Mandatory=$true)][string]$KeyDirectory
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Net.Http
$recoveryRoot=Split-Path -Parent $PSScriptRoot
if (-not [IO.Path]::IsPathRooted($KeyDirectory)) {throw 'Use an absolute recovery directory.'}
$recoveryDirectory=[IO.Path]::GetFullPath($KeyDirectory).TrimEnd('\')
if ($recoveryDirectory -eq [IO.Path]::GetPathRoot($recoveryDirectory).TrimEnd('\') -or $recoveryDirectory.Equals($recoveryRoot,[StringComparison]::OrdinalIgnoreCase) -or $recoveryDirectory.StartsWith($recoveryRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) {throw 'Use a dedicated recovery directory outside the checkout.'}
$recoveryAt=[IO.Path]::GetPathRoot($recoveryDirectory)
foreach ($recoveryPart in $recoveryDirectory.Substring($recoveryAt.Length).Split('\')) {
  if (-not $recoveryPart) {continue}
  $recoveryAt=Join-Path $recoveryAt $recoveryPart
  if ((Test-Path -LiteralPath $recoveryAt) -and ((Get-Item -LiteralPath $recoveryAt -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Recovery paths must not contain links or reparse points.'}
}
if (Test-Path -LiteralPath $recoveryDirectory) {throw 'Use a new recovery directory; existing custody is preserved.'}
$recoveryNode=@(Get-Command node -CommandType Application)[0].Source
& $recoveryNode (Join-Path $recoveryRoot 'scripts/preflight-node.js') | Out-Null
if ($LASTEXITCODE -ne 0) {throw 'Node 22 is required before recovering an updater key.'}
$recoveryContractRaw=& $recoveryNode (Join-Path $recoveryRoot 'scripts/check-desktop-release-contract.cjs')
if ($LASTEXITCODE -ne 0) {throw 'The release channel contract must pass before recovery.'}
$recoveryContract=($recoveryContractRaw -join "`n")|ConvertFrom-Json
$recoveryConfig=Get-Content -LiteralPath (Join-Path $recoveryRoot 'frontend/src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json

function Get-UpdaterRecoveryCrc32c([byte[]]$Bytes) {
  [uint32]$recoveryCrc=[uint32]::MaxValue
  foreach ($recoveryByte in $Bytes) {
    $recoveryCrc=$recoveryCrc -bxor $recoveryByte
    for ($recoveryBit=0;$recoveryBit -lt 8;$recoveryBit++) {
      if ($recoveryCrc -band 1) {$recoveryCrc=($recoveryCrc -shr 1) -bxor [uint32]2197175160} else {$recoveryCrc=$recoveryCrc -shr 1}
    }
  }
  return ($recoveryCrc -bxor [uint32]::MaxValue).ToString([Globalization.CultureInfo]::InvariantCulture)
}
function Read-UpdaterRecoveryPacket($Response,[string]$ExpectedVersion,[string]$ExpectedPublicKey) {
  $recoveryBytes=$null
  try {
    if ($Response.name -cne $ExpectedVersion -or $Response.payload.data -isnot [string] -or $Response.payload.data.Length -gt 32768 -or [string]$Response.payload.dataCrc32c -notmatch '^[0-9]{1,10}$') {throw 'Invalid envelope'}
    $recoveryBytes=[Convert]::FromBase64String($Response.payload.data)
    if ($recoveryBytes.Length -eq 0 -or $recoveryBytes.Length -gt 24576 -or (Get-UpdaterRecoveryCrc32c $recoveryBytes) -cne [string]$Response.payload.dataCrc32c) {throw 'Invalid checksum'}
    $recoveryPacket=[Text.UTF8Encoding]::new($false,$true).GetString($recoveryBytes)|ConvertFrom-Json
    if (($recoveryPacket.PSObject.Properties.Name|Sort-Object) -join ',' -cne 'keyEpoch,privateKey,publicKey,v' -or $recoveryPacket.v -ne 1 -or $recoveryPacket.keyEpoch -ne 2 -or $recoveryPacket.publicKey -cne $ExpectedPublicKey -or $recoveryPacket.privateKey -isnot [string] -or $recoveryPacket.privateKey.Length -gt 16384 -or $recoveryPacket.privateKey -notmatch '^[A-Za-z0-9+/]+={0,2}$') {throw 'Invalid packet'}
    return $recoveryPacket
  } catch {throw 'Updater recovery packet refused: check version, checksum, schema and public key.'}
  finally {if ($recoveryBytes) {[Array]::Clear($recoveryBytes,0,$recoveryBytes.Length)}}
}
function Invoke-UpdaterRecoveryProcess([string]$Executable,[string[]]$Arguments,[string]$PrivateKey) {
  $recoveryProcess=[Diagnostics.Process]::new()
  $recoveryProcess.StartInfo.FileName=$Executable
  $recoveryProcess.StartInfo.Arguments=($Arguments|ForEach-Object {'"'+$_+'"'}) -join ' '
  $recoveryProcess.StartInfo.UseShellExecute=$false
  $recoveryProcess.StartInfo.CreateNoWindow=$true
  $recoveryProcess.StartInfo.RedirectStandardOutput=$true
  $recoveryProcess.StartInfo.RedirectStandardError=$true
  foreach ($recoveryName in @('TAURI_SIGNING_PRIVATE_KEY','TAURI_SIGNING_PRIVATE_KEY_PATH','TAURI_SIGNING_PRIVATE_KEY_PASSWORD')) {$recoveryProcess.StartInfo.EnvironmentVariables.Remove($recoveryName)}
  if ($PrivateKey) {
    $recoveryProcess.StartInfo.EnvironmentVariables['TAURI_SIGNING_PRIVATE_KEY']=$PrivateKey
    $recoveryProcess.StartInfo.EnvironmentVariables['TAURI_SIGNING_PRIVATE_KEY_PASSWORD']=''
  }
  try {
    if (-not $recoveryProcess.Start()) {throw 'The recovery signing check could not start.'}
    $recoveryStdout=$recoveryProcess.StandardOutput.ReadToEndAsync()
    $recoveryStderr=$recoveryProcess.StandardError.ReadToEndAsync()
    if (-not $recoveryProcess.WaitForExit(120000)) {$recoveryProcess.Kill();throw 'The recovery signing check timed out.'}
    $recoveryOutput=$recoveryStdout.GetAwaiter().GetResult();$null=$recoveryStderr.GetAwaiter().GetResult()
    if ($recoveryProcess.ExitCode -ne 0) {throw 'The recovery signing check failed.'}
    if (-not $PrivateKey) {return $recoveryOutput}
  } finally {$recoveryProcess.Dispose()}
}

$recoveryBefore=(Get-Location).Path
$recoveryToken=$null;$recoveryPacket=$null;$recoveryPrivateBytes=$null;$recoveryCheck=$null;$recoveryResponse=$null
try {
  Set-Location -LiteralPath $recoveryRoot
  # Build the independent verifier before reading the private packet.
  $recoveryVerifier=Invoke-UpdaterRecoveryProcess $recoveryNode @('-e',"process.stdout.write(require('./scripts/stage-desktop-artifacts.cjs').buildVerifier(process.cwd()))") ''
  $recoveryVerifier=$recoveryVerifier.Trim()
  if (-not [IO.Path]::IsPathRooted($recoveryVerifier) -or -not (Test-Path -LiteralPath $recoveryVerifier -PathType Leaf)) {throw 'The recovery verifier is unavailable.'}
  $recoveryGcloud=@(Get-Command gcloud.cmd -CommandType Application)[0].Source
  $recoveryProjectRaw=& $recoveryGcloud projects describe $Project '--format=value(projectNumber)' --quiet 2>$null
  if ($LASTEXITCODE -ne 0) {throw 'The explicit recovery project could not be resolved.'}
  $recoveryProjectNumber=($recoveryProjectRaw -join '').Trim()
  if ($recoveryProjectNumber -notmatch '^[0-9]{6,20}$') {throw 'The explicit recovery project number is invalid.'}
  $recoveryTokenRaw=& $recoveryGcloud auth print-access-token --quiet 2>$null
  if ($LASTEXITCODE -ne 0) {throw 'Google Cloud authentication is required for recovery.'}
  $recoveryToken=($recoveryTokenRaw -join '').Trim();$recoveryTokenRaw=$null
  if (-not $recoveryToken) {throw 'Google Cloud authentication is required for recovery.'}
  $recoveryVersionName='projects/'+$recoveryProjectNumber+'/secrets/MNEMOSYNE_DESKTOP_UPDATER_EPOCH2/versions/'+$SecretVersion
  $recoveryHandler=[Net.Http.HttpClientHandler]::new();$recoveryHandler.AllowAutoRedirect=$false
  $recoveryHttp=[Net.Http.HttpClient]::new($recoveryHandler);$recoveryHttp.Timeout=[TimeSpan]::FromSeconds(30)
  try {
    $recoveryHttp.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$recoveryToken)
    $recoveryResponse=$recoveryHttp.GetAsync('https://secretmanager.googleapis.com/v1/'+$recoveryVersionName+':access').GetAwaiter().GetResult()
    if (-not $recoveryResponse.IsSuccessStatusCode -or $recoveryResponse.Content.Headers.ContentLength -gt 65536) {throw 'Secret Manager refused recovery.'}
    $recoveryBody=$recoveryResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if ($recoveryBody.Length -gt 65536) {throw 'Secret Manager recovery response is oversized.'}
    try {$recoveryEnvelope=$recoveryBody|ConvertFrom-Json} catch {throw 'Secret Manager recovery response is invalid.'}
    $recoveryPacket=Read-UpdaterRecoveryPacket $recoveryEnvelope $recoveryVersionName $recoveryConfig.plugins.updater.pubkey
  } catch {throw 'Secret Manager recovery failed; no key has been written.'}
  finally {if ($recoveryResponse) {$recoveryResponse.Dispose()};$recoveryHttp.Dispose();$recoveryHandler.Dispose();$recoveryToken=$null;$recoveryEnvelope=$null;$recoveryBody=$null}

  New-Item -ItemType Directory -Path $recoveryDirectory | Out-Null
  $recoverySid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $recoveryAcl=Get-Acl -LiteralPath $recoveryDirectory
  $recoveryAcl.SetAccessRuleProtection($true,$false);$recoveryAcl.SetOwner($recoverySid)
  foreach ($recoveryIdentity in @($recoverySid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $recoveryAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($recoveryIdentity,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
  }
  Set-Acl -LiteralPath $recoveryDirectory -AclObject $recoveryAcl
  $recoveryApplied=Get-Acl -LiteralPath $recoveryDirectory
  if (-not $recoveryApplied.AreAccessRulesProtected) {throw 'Recovery directory inheritance was not restricted.'}
  foreach ($recoveryRule in $recoveryApplied.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($recoveryRule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $recoveryRule.IdentityReference.Value -notin @($recoverySid.Value,'S-1-5-18')) {throw 'Recovery directory has an unexpected access grant.'}
  }
  $recoveryChallenge=Join-Path $recoveryDirectory 'recovery-challenge.txt'
  [IO.File]::WriteAllText($recoveryChallenge,('Mnemosyne updater epoch 2 recovery '+[Guid]::NewGuid().ToString()),[Text.UTF8Encoding]::new($false))
  $null=Invoke-UpdaterRecoveryProcess $recoveryNode @((Join-Path $recoveryRoot 'frontend/node_modules/@tauri-apps/cli/tauri.js'),'signer','sign','--app-version',$recoveryContract.version,$recoveryChallenge) $recoveryPacket.privateKey
  $recoveryVerified=Invoke-UpdaterRecoveryProcess $recoveryVerifier @($recoveryChallenge,($recoveryChallenge+'.sig'),$recoveryPacket.publicKey,$recoveryContract.version) ''
  if (($recoveryVerified|ConvertFrom-Json).verified -ne $true) {throw 'The recovered key did not pass the configured public key verifier.'}
  $recoveryPrivateBytes=[Text.Encoding]::UTF8.GetBytes($recoveryPacket.privateKey)
  $recoveryCipher=[Security.Cryptography.ProtectedData]::Protect($recoveryPrivateBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $recoveryProtected=Join-Path $recoveryDirectory 'updater.key.dpapi'
  $recoveryStream=[IO.File]::Open($recoveryProtected,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$recoveryStream.Write($recoveryCipher,0,$recoveryCipher.Length)} finally {$recoveryStream.Dispose()}
  $recoveryCheck=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($recoveryProtected),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  if ([Convert]::ToBase64String($recoveryCheck) -cne [Convert]::ToBase64String($recoveryPrivateBytes)) {throw 'Recovered key DPAPI readback failed.'}
  [IO.File]::WriteAllText((Join-Path $recoveryDirectory 'updater.pub'),$recoveryPacket.publicKey,[Text.UTF8Encoding]::new($false))
  $recoveryDescriptor=[ordered]@{v=1;protection='Windows-DPAPI-CurrentUser';publicKey=$recoveryPacket.publicKey;protectedFile='updater.key.dpapi';createdAt=[DateTime]::UtcNow.ToString('o');recoveredFrom=$recoveryVersionName}
  [IO.File]::WriteAllText((Join-Path $recoveryDirectory 'descriptor.json'),($recoveryDescriptor|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  [pscustomobject]@{restored=$true;secretVersion=$recoveryVersionName;protection='Windows-DPAPI-CurrentUser';freshSignatureVerified=$true;dpapiReadbackVerified=$true;privateFile=$recoveryProtected;plaintextPrivateFiles=0;cloudWrites=0}|ConvertTo-Json -Compress
} finally {
  Set-Location -LiteralPath $recoveryBefore
  if ($recoveryPrivateBytes) {[Array]::Clear($recoveryPrivateBytes,0,$recoveryPrivateBytes.Length)}
  if ($recoveryCheck) {[Array]::Clear($recoveryCheck,0,$recoveryCheck.Length)}
  $recoveryPacket=$null;$recoveryToken=$null
}
