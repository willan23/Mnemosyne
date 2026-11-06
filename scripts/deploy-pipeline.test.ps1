$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'deploy-pipeline.ps1')
$taskRoot=[System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$taskFixture=Join-Path ([System.IO.Path]::GetTempPath()) ('mnemosyne-deploy-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskFixture | Out-Null
function Assert-True($Condition,$Message) {if (-not $Condition) {throw $Message}}
$script:taskCalls=@()
$script:taskFail=$null
$taskRunner={
  param($Executable,$Arguments,$Step)
  $script:taskCalls+=@([pscustomobject]@{tool=$Executable;arguments=@($Arguments);step=$Step;cwd=(Get-Location).Path})
  if ($Step -eq $script:taskFail) {return [int]41}
  return [int]0
}
try {
  $taskBefore=(Get-Location).Path
  $taskOut=Join-Path $taskFixture 'success'
  Invoke-MnemosyneDeployment -Project demo-mnemosyne-rules -Root $taskRoot -ReportDirectory $taskOut -Runner $taskRunner
  $taskSteps=@($script:taskCalls | ForEach-Object {$_.step})
  Assert-True ($taskSteps.Count -eq 26) 'Every preflight and component must execute.'
  Assert-True ($taskSteps[0] -eq 'node22' -and $taskSteps[1] -eq 'runtime-entrypoints' -and $taskSteps[2] -eq 'release-gates') 'Retired runtimes must be checked before rollout gates and remote calls.'
  $taskTeamEpochs=@($script:taskCalls | Where-Object {$_.step -eq 'team-epochs'})
  Assert-True ($taskTeamEpochs.Count -eq 1 -and $taskTeamEpochs[0].tool -eq 'node' -and ($taskTeamEpochs[0].arguments -join ' ') -eq 'scripts/backfill-team-epochs.js --project=demo-mnemosyne-rules --require-complete') 'Verify team epoch cutover without applying the migration.'
  Assert-True ([Array]::IndexOf($taskSteps,'team-epochs') -gt [Array]::IndexOf($taskSteps,'functions-build') -and [Array]::IndexOf($taskSteps,'team-epochs') -lt [Array]::IndexOf($taskSteps,'publish-firestore:indexes')) 'Verify team epochs before publication.'
  $taskDesktop=@($script:taskCalls | Where-Object {$_.step -eq 'desktop-artifacts'})
  Assert-True ($taskDesktop.Count -eq 1 -and $taskDesktop[0].arguments[0] -eq 'scripts/stage-desktop-artifacts.cjs' -and $taskDesktop[0].arguments[1] -eq '--verify-only') 'Desktop artifact verification must execute without staging.'
  Assert-True ([Array]::IndexOf($taskSteps,'desktop-artifacts') -gt [Array]::IndexOf($taskSteps,'frontend-build') -and [Array]::IndexOf($taskSteps,'desktop-artifacts') -lt [Array]::IndexOf($taskSteps,'publish-hosting')) 'Verify the copied dist before publication.'
  $taskAndroid=@($script:taskCalls | Where-Object {$_.step -eq 'android-artifacts'})
  Assert-True ($taskAndroid.Count -eq 1 -and $taskAndroid[0].arguments[0] -eq 'scripts/android-release-artifact.cjs' -and $taskAndroid[0].arguments[1] -eq '--verify-only') 'Verify the approved Android APK without staging during deployment.'
  Assert-True ([Array]::IndexOf($taskSteps,'android-artifacts') -gt [Array]::IndexOf($taskSteps,'frontend-build') -and [Array]::IndexOf($taskSteps,'android-artifacts') -lt [Array]::IndexOf($taskSteps,'publish-firestore:indexes')) 'Verify Android before the first publication command.'
  $taskIdentity=@($script:taskCalls | Where-Object {$_.step -eq 'frontend-build-identity'})
  Assert-True ($taskIdentity.Count -eq 1 -and $taskIdentity[0].tool -eq 'node' -and $taskIdentity[0].arguments[0] -eq 'scripts/check-build-version-identity.cjs') 'The actual manifest and bundle checker must run.'
  Assert-True ([Array]::IndexOf($taskSteps,'frontend-build-identity') -gt [Array]::IndexOf($taskSteps,'frontend-tests') -and [Array]::IndexOf($taskSteps,'frontend-build-identity') -lt [Array]::IndexOf($taskSteps,'publish-firestore:indexes')) 'Verify build identity after tests and before any publication.'
  $taskResult=Get-Content -LiteralPath (Join-Path $taskOut 'deployment-result.json') -Raw | ConvertFrom-Json
  Assert-True ($taskResult.publicationCommandsCompleted -eq $true -and $taskResult.runtimeSmokeVerified -eq $false -and $taskResult.releaseComplete -eq $false) 'Command success cannot claim smoke or full release.'
  Assert-True ((Get-Location).Path -eq $taskBefore) 'Working directory was not restored.'
  $taskPublished=@($script:taskCalls | Where-Object {$_.tool -eq 'firebase.cmd'})
  Assert-True ($taskPublished.Count -eq 5) 'Full publication must include indexes.'
  foreach ($taskCall in $taskPublished) {
    $taskIndex=[Array]::IndexOf($taskCall.arguments,'--project')
    Assert-True ($taskIndex -ge 0 -and $taskCall.arguments[$taskIndex+1] -eq 'demo-mnemosyne-rules') 'Implicit Firebase project detected.'
    Assert-True ($taskCall.arguments -contains '--non-interactive') 'Interactive CLI detected.'
  }
  foreach ($taskStep in $taskSteps) {
    $script:taskCalls=@(); $script:taskFail=$taskStep
    $taskOut=Join-Path $taskFixture ('failure-'+[Guid]::NewGuid().ToString('N'))
    $taskThrew=$false
    try {Invoke-MnemosyneDeployment -Project demo-mnemosyne-rules -Root $taskRoot -ReportDirectory $taskOut -Runner $taskRunner} catch {$taskThrew=$true}
    Assert-True $taskThrew 'Failed stage was ignored.'
    Assert-True ($script:taskCalls[-1].step -eq $taskStep) 'A later command ran after failure.'
    Assert-True ($script:taskCalls.Count -eq ([Array]::IndexOf($taskSteps,$taskStep)+1)) 'Sequence repeated or skipped a stage.'
    $taskResult=Get-Content -LiteralPath (Join-Path $taskOut 'deployment-result.json') -Raw | ConvertFrom-Json
    Assert-True ($taskResult.failedStep -eq $taskStep -and $taskResult.failedExitCode -eq 41 -and $taskResult.publicationCommandsCompleted -eq $false) 'Failure report is incorrect.'
    $taskSuccessfulPublishes=@($script:taskCalls | Where-Object {$_.tool -eq 'firebase.cmd' -and $_.step -ne $taskStep})
    Assert-True (@($taskResult.acknowledgedComponents).Count -eq $taskSuccessfulPublishes.Count) 'Partial publication was lost.'
    if ($taskStep -like 'publish-*') {Assert-True ($taskResult.publicationAttempts[-1].status -eq 'uncertain') 'Failed publish cannot prove absence of a remote change.'}
    Assert-True ((Get-Location).Path -eq $taskBefore) 'Working directory was not restored after failure.'
  }
  $script:taskCalls=@(); $script:taskFail=$null
  Invoke-MnemosyneDeployment -Project demo-mnemosyne-rules -Root $taskRoot -ReportDirectory (Join-Path $taskFixture 'preflight') -PreflightOnly -Runner $taskRunner
  Assert-True (@($script:taskCalls | Where-Object {$_.tool -eq 'firebase.cmd'}).Count -eq 0) 'Preflight published components.'
  foreach ($taskProject in @('bad/path','--project other','')) {
    $script:taskCalls=@(); $taskThrew=$false
    try {Invoke-MnemosyneDeployment -Project $taskProject -Root $taskRoot -ReportDirectory (Join-Path $taskFixture 'invalid') -Runner $taskRunner} catch {$taskThrew=$true}
    Assert-True ($taskThrew -and $script:taskCalls.Count -eq 0) 'Invalid context reached commands.'
  }
  Write-Host 'DEPLOY_SEQUENCE_ASSERTIONS_PASSED'
} finally {
  $taskAbsolute=[System.IO.Path]::GetFullPath($taskFixture)
  if ([System.IO.Path]::GetDirectoryName($taskAbsolute).TrimEnd('\') -ne [System.IO.Path]::GetTempPath().TrimEnd('\') -or [System.IO.Path]::GetFileName($taskAbsolute) -notlike 'mnemosyne-deploy-test-*') {throw 'Fixture cleanup outside intended directory.'}
  Remove-Item -LiteralPath $taskAbsolute -Recurse -Force
}
