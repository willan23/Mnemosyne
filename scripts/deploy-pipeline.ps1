# The public entrypoint uses the real runner. Tests inject a runner into this library only.
function Invoke-MnemosyneDeployment {
  param(
    [Parameter(Mandatory=$true)][string]$Project,
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][string]$ReportDirectory,
    [switch]$PreflightOnly,
    [scriptblock]$Runner
  )
  $ErrorActionPreference='Stop'
  if ($Project -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' -or -not [System.IO.Path]::IsPathRooted($Root) -or -not [System.IO.Path]::IsPathRooted($ReportDirectory)) { throw 'Invalid deployment context.' }
  if (Test-Path -LiteralPath $ReportDirectory) { throw 'Use a new report directory; existing evidence is preserved.' }
  if (-not $Runner) {
    $Runner = {
      param($Executable,$Arguments,$Step)
      & $Executable @Arguments | Out-Host
      return [int]$LASTEXITCODE
    }
  }
  New-Item -ItemType Directory -Path $ReportDirectory -ErrorAction Stop | Out-Null
  $report=[ordered]@{v=1;projectId=$Project;startedAt=[DateTime]::UtcNow.ToString('o');completedSteps=@();failedStep=$null;failedExitCode=$null;acknowledgedComponents=@();publicationAttempts=@();publicationCommandsCompleted=$false;runtimeSmokeVerified=$false;releaseComplete=$false;preflightOnly=[bool]$PreflightOnly}
  $gateFirst=Join-Path $ReportDirectory 'release-gates.json'
  $gateFinal=Join-Path $ReportDirectory 'release-gates-final.json'
  $secrets=Join-Path $ReportDirectory 'function-secrets.json'
  $stages=@(
    @{Id='node22';Tool='node';Arguments=@('scripts/preflight-node.js')},
    @{Id='runtime-entrypoints';Tool='node';Arguments=@('scripts/runtime-entrypoints.cjs','--out',(Join-Path $ReportDirectory 'runtime-entrypoints.json'))},
    @{Id='release-gates';Tool='node';Arguments=@('scripts/release-gates-preflight.js','--out',$gateFirst)},
    @{Id='java21';Tool='node';Arguments=@('scripts/preflight-java.js')},
    @{Id='functions-build';Tool='npm.cmd';Arguments=@('--prefix','functions','run','build')},
    @{Id='secrets';Tool='node';Arguments=@('scripts/function-secrets.js','preflight','--project',$Project,'--out',$secrets)},
    @{Id='personal-scope';Tool='node';Arguments=@('scripts/backfill-personal-scope.js',"--project=$Project",'--require-complete')},
    @{Id='team-epochs';Tool='node';Arguments=@('scripts/backfill-team-epochs.js',"--project=$Project",'--require-complete')},
    @{Id='invite-inbox';Tool='node';Arguments=@('scripts/backfill-team-invite-inbox.js',"--project=$Project",'--require-complete')},
    @{Id='attachment-references';Tool='node';Arguments=@('scripts/audit-attachment-references.js',"--project=$Project",'--require-clean')},
    @{Id='frontend-lint';Tool='npm.cmd';Arguments=@('--prefix','frontend','run','lint')},
    @{Id='frontend-build';Tool='npm.cmd';Arguments=@('--prefix','frontend','run','build')},
    @{Id='frontend-tests';Tool='npm.cmd';Arguments=@('--prefix','frontend','run','test','--','--run')},
    @{Id='frontend-build-identity';Tool='node';Arguments=@('scripts/check-build-version-identity.cjs')},
    @{Id='functions-tests';Tool='npm.cmd';Arguments=@('--prefix','functions','test')},
    @{Id='rules-tests';Tool='node';Arguments=@('scripts/run-rules-tests.js')},
    @{Id='functions-audit';Tool='npm.cmd';Arguments=@('--prefix','functions','audit','--omit=dev','--audit-level=high')},
    @{Id='frontend-audit';Tool='npm.cmd';Arguments=@('--prefix','frontend','audit','--omit=dev','--audit-level=high')},
    @{Id='desktop-artifacts';Tool='node';Arguments=@('scripts/stage-desktop-artifacts.cjs','--verify-only')},
    @{Id='android-artifacts';Tool='node';Arguments=@('scripts/android-release-artifact.cjs','--verify-only')},
    @{Id='release-gates-final';Tool='node';Arguments=@('scripts/release-gates-preflight.js','--out',$gateFinal,'--baseline',$gateFirst)}
  )
  if (-not $PreflightOnly) {
    foreach ($component in @('firestore:indexes','firestore:rules','storage','functions','hosting')) {
      $stages+=@{Id="publish-$component";Tool='firebase.cmd';Arguments=@('deploy','--only',$component,'--project',$Project,'--non-interactive');Component=$component}
    }
  }
  Push-Location -LiteralPath $Root
  try {
    foreach ($stage in $stages) {
      $report.failedStep=$stage.Id
      Write-Host "Mnemosyne: $($stage.Id)" -ForegroundColor Cyan
      if ($stage.Component) {$report.publicationAttempts+=@([ordered]@{component=$stage.Component;status='uncertain'})}
      $code=& $Runner $stage.Tool $stage.Arguments $stage.Id
      if ($code -isnot [int] -or $code -ne 0) {$report.failedExitCode=if ($code -is [int]) {$code} else {$null}; throw 'Deployment step failed; later stages were not started.'}
      $report.completedSteps+=@($stage.Id)
      if ($stage.Component) {$report.acknowledgedComponents+=@($stage.Component); $report.publicationAttempts[-1].status='cli_acknowledged'}
      $report.failedStep=$null
    }
    $report.publicationCommandsCompleted=(-not $PreflightOnly)
    if ($PreflightOnly) {Write-Host 'Preflight commands completed; nothing published.' -ForegroundColor Green}
    else {Write-Host 'Publication commands completed. Runtime smokes and full product release verification are still required.' -ForegroundColor Green}
  } finally {
    $report.finishedAt=[DateTime]::UtcNow.ToString('o')
    $reportPath=Join-Path $ReportDirectory 'deployment-result.json'
    [System.IO.File]::WriteAllText($reportPath,($report | ConvertTo-Json -Depth 8),[System.Text.UTF8Encoding]::new($false))
    Pop-Location
  }
}
