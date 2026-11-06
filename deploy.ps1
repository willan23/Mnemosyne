<#
Full Firebase publication, after completion of the phases 0-6 audit.
Use -PreflightOnly for validation without publication. Every failed step stops the sequence.
#>
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$Project,
  [switch]$PreflightOnly,
  [string]$ReportDirectory=(Join-Path $env:TEMP ('mnemosyne-deploy-'+[Guid]::NewGuid().ToString('N')))
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'scripts/deploy-pipeline.ps1')
try {
  Invoke-MnemosyneDeployment -Project $Project -Root $PSScriptRoot -ReportDirectory $ReportDirectory -PreflightOnly:$PreflightOnly
} catch {
  Write-Error 'Mnemosyne deployment stopped. Inspect deployment-result.json when present; no subsequent stage was started.' -ErrorAction Continue
  exit 1
}
