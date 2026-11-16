<# Local Windows custody for an updater key. Private bytes stay outside Git and are
protected with DPAPI CurrentUser. CI uses its own protected secret injection.
Generate never overwrites a key. Build/Bundle restore the caller's environment.
#>
param(
  [Parameter(Mandatory=$true)][ValidateSet('Generate','Build','Bundle')][string]$Action,
  [Parameter(Mandatory=$true)][string]$KeyDirectory
)
$ErrorActionPreference='Stop'
# Use the module belonging to this host, even when PSModulePath was inherited from another PowerShell edition.
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$taskRoot=Split-Path -Parent $PSScriptRoot
if (-not [System.IO.Path]::IsPathRooted($KeyDirectory)) {throw 'Use an absolute private key directory.'}
$taskKeyRoot=[System.IO.Path]::GetFullPath($KeyDirectory).TrimEnd('\')
if ($taskKeyRoot -eq [System.IO.Path]::GetPathRoot($taskKeyRoot).TrimEnd('\')) {throw 'A dedicated private key directory is required.'}
if ($taskKeyRoot.Equals($taskRoot,[StringComparison]::OrdinalIgnoreCase) -or $taskKeyRoot.StartsWith($taskRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) {throw 'Store updater private material outside the checkout.'}
function Assert-RegularSigningPath([string]$Path) {
  $taskAt=[System.IO.Path]::GetPathRoot($Path)
  foreach ($taskPart in $Path.Substring($taskAt.Length).Split('\')) {
    if (-not $taskPart) {continue}
    $taskAt=Join-Path $taskAt $taskPart
    if (Test-Path -LiteralPath $taskAt) {
      if ((Get-Item -LiteralPath $taskAt -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {throw 'Signing paths must not contain links or reparse points.'}
    }
  }
}
Assert-RegularSigningPath $taskKeyRoot
& node (Join-Path $taskRoot 'scripts/preflight-node.js') | Out-Null
if ($LASTEXITCODE -ne 0) {throw 'Node 22 is required before handling an updater key.'}
Add-Type -AssemblyName System.Security
$taskProtected=Join-Path $taskKeyRoot 'updater.key.dpapi'
$taskDescriptor=Join-Path $taskKeyRoot 'descriptor.json'
$taskRaw=Join-Path $taskKeyRoot 'updater.key.pending'
$taskPublic=Join-Path $taskKeyRoot 'updater.pub'
$taskCli=Join-Path $taskRoot 'frontend/node_modules/@tauri-apps/cli/tauri.js'
if ($Action -eq 'Generate') {
  if (Test-Path -LiteralPath $taskKeyRoot) {throw 'Use a new private directory; existing keys are preserved.'}
  New-Item -ItemType Directory -Path $taskKeyRoot | Out-Null
  $taskSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $taskAcl=Get-Acl -LiteralPath $taskKeyRoot
  $taskAcl.SetAccessRuleProtection($true,$false)
  $taskAcl.SetOwner($taskSid)
  foreach ($taskIdentity in @($taskSid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $taskRule=[Security.AccessControl.FileSystemAccessRule]::new($taskIdentity,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
    $taskAcl.AddAccessRule($taskRule)
  }
  Set-Acl -LiteralPath $taskKeyRoot -AclObject $taskAcl
  $taskApplied=Get-Acl -LiteralPath $taskKeyRoot
  if (-not $taskApplied.AreAccessRulesProtected) {throw 'The private key directory must have restricted inheritance.'}
  foreach ($taskRule in $taskApplied.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if ($taskRule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $taskRule.IdentityReference.Value -notin @($taskSid.Value,'S-1-5-18')) {throw 'The private key directory has an unexpected access grant.'}
  }
  $taskBytes=$null; $taskCheck=$null
  try {
    # --ci creates a key with an empty CLI password. DPAPI protects its stored bytes.
    # The CLI may print private material; discard both output streams here.
    $taskGenerator=[Diagnostics.Process]::new()
    $taskGenerator.StartInfo.FileName=@(Get-Command node -CommandType Application)[0].Source
    $taskGenerator.StartInfo.Arguments='"'+$taskCli+'" signer generate --ci --write-keys "'+$taskRaw+'"'
    $taskGenerator.StartInfo.UseShellExecute=$false
    $taskGenerator.StartInfo.CreateNoWindow=$true
    $taskGenerator.StartInfo.RedirectStandardOutput=$true
    $taskGenerator.StartInfo.RedirectStandardError=$true
    foreach ($taskName in @('TAURI_SIGNING_PRIVATE_KEY','TAURI_SIGNING_PRIVATE_KEY_PATH','TAURI_SIGNING_PRIVATE_KEY_PASSWORD')) {$taskGenerator.StartInfo.EnvironmentVariables.Remove($taskName)}
    try {
      if (-not $taskGenerator.Start()) {throw 'Updater key generation failed.'}
      $taskOutput=$taskGenerator.StandardOutput.ReadToEndAsync()
      $taskErrors=$taskGenerator.StandardError.ReadToEndAsync()
      $taskGenerator.WaitForExit()
      $null=$taskOutput.GetAwaiter().GetResult(); $null=$taskErrors.GetAwaiter().GetResult()
      if ($taskGenerator.ExitCode -ne 0) {throw 'Updater key generation failed.'}
    } finally {$taskGenerator.Dispose()}
    if (-not (Test-Path -LiteralPath $taskRaw -PathType Leaf) -or -not (Test-Path -LiteralPath ($taskRaw+'.pub') -PathType Leaf)) {throw 'Updater key generation failed.'}
    $taskBytes=[IO.File]::ReadAllBytes($taskRaw)
    $taskCipher=[Security.Cryptography.ProtectedData]::Protect($taskBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $taskStream=[IO.File]::Open($taskProtected,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$taskStream.Write($taskCipher,0,$taskCipher.Length)} finally {$taskStream.Dispose()}
    $taskCheck=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskProtected),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    if ([Convert]::ToBase64String($taskCheck) -cne [Convert]::ToBase64String($taskBytes)) {throw 'Protected updater key readback failed.'}
    Move-Item -LiteralPath ($taskRaw+'.pub') -Destination $taskPublic
    $taskPublicText=[IO.File]::ReadAllText($taskPublic).Trim()
    if (-not $taskPublicText) {throw 'The generated public key is missing.'}
    $taskMetadata=[ordered]@{v=1;protection='Windows-DPAPI-CurrentUser';publicKey=$taskPublicText;protectedFile='updater.key.dpapi';createdAt=[DateTime]::UtcNow.ToString('o')}
    [IO.File]::WriteAllText($taskDescriptor,($taskMetadata|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  } finally {
    if ($taskBytes) {[Array]::Clear($taskBytes,0,$taskBytes.Length)}
    if ($taskCheck) {[Array]::Clear($taskCheck,0,$taskCheck.Length)}
    if (Test-Path -LiteralPath $taskRaw -PathType Leaf) {Remove-Item -LiteralPath $taskRaw -Force}
  }
  [pscustomobject]@{generated=$true;protection='Windows-DPAPI-CurrentUser';privateFile=$taskProtected;publicFile=$taskPublic;plaintextPrivateFileRetained=$false;productionMutations=0}|ConvertTo-Json -Compress
  exit 0
}
foreach ($taskFile in @($taskProtected,$taskDescriptor,$taskPublic)) {Assert-RegularSigningPath $taskFile;if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf) -or (Get-Item -LiteralPath $taskFile).Length -gt 16384) {throw 'Protected updater key files are incomplete or oversized.'}}
$taskMetadata=Get-Content -LiteralPath $taskDescriptor -Raw | ConvertFrom-Json
$taskConfig=Get-Content -LiteralPath (Join-Path $taskRoot 'frontend/src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
if ($taskMetadata.v -ne 1 -or $taskMetadata.protection -cne 'Windows-DPAPI-CurrentUser' -or $taskMetadata.protectedFile -cne 'updater.key.dpapi' -or $taskMetadata.publicKey -cne [IO.File]::ReadAllText($taskPublic).Trim() -or $taskConfig.plugins.updater.pubkey -cne $taskMetadata.publicKey) {throw 'The protected key does not match the configured updater public key.'}
& node (Join-Path $taskRoot 'scripts/check-tauri-version-alignment.cjs') | Out-Null
if ($LASTEXITCODE -ne 0) {throw 'Tauri versions must align before signing.'}
$taskNames=@('TAURI_SIGNING_PRIVATE_KEY','TAURI_SIGNING_PRIVATE_KEY_PATH','TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
$taskPrevious=@{}
foreach ($taskName in $taskNames) {$taskPrevious[$taskName]=[Environment]::GetEnvironmentVariable($taskName,'Process')}
$taskBytes=$null; $taskBefore=(Get-Location).Path; $taskCode=1
try {
  Set-Location -LiteralPath (Join-Path $taskRoot 'frontend')
  foreach ($taskName in $taskNames) {[Environment]::SetEnvironmentVariable($taskName,$null,'Process')}
  if ($Action -eq 'Build') {
    # Compilation and frontend scripts do not need access to the signing key.
    & node $taskCli build --ci --no-bundle -- --locked
    $taskCode=$LASTEXITCODE
  }
  if ($Action -eq 'Bundle' -or $taskCode -eq 0) {
    $taskBytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskProtected),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $env:TAURI_SIGNING_PRIVATE_KEY=[Text.Encoding]::UTF8.GetString($taskBytes).Trim()
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''
    & node $taskCli bundle --ci
    $taskCode=$LASTEXITCODE
  }
} finally {
  Set-Location -LiteralPath $taskBefore
  foreach ($taskName in $taskNames) {[Environment]::SetEnvironmentVariable($taskName,$taskPrevious[$taskName],'Process')}
  if ($taskBytes) {[Array]::Clear($taskBytes,0,$taskBytes.Length)}
}
exit $taskCode
